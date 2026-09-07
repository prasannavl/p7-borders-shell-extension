import GLib from "gi://GLib";

export class WindowTracker extends Map {
  constructor(manager) {
    super();
    this._manager = manager;
    this._idleId = 0;
  }

  set(metaWindow, record) {
    this.remove(metaWindow);
    return super.set(metaWindow, record);
  }

  delete(metaWindow) {
    return !!this.remove(metaWindow);
  }

  clear() {
    this._cancelQueue();
    const error = this.removeAll(this.keys());
    if (error) throw error;
  }

  isViable(metaWindow) {
    const record = this.get(metaWindow);
    if (!record || record.failed) return false;
    return record.pending
      ? [...record.pending.objects].every(isLiveObject)
      : this._manager.isLiveWindowData(record);
  }

  addPending(metaWindow, entries, track = null) {
    const existing = this.get(metaWindow);
    if (existing) {
      // A failed disconnect leaves its pending record retryable. Reconciliation
      // can explicitly queue it again without duplicating signal ownership.
      if (track && existing.pending && existing.failed) {
        existing.pending.track = track;
        existing.failed = false;
        existing.queued = true;
        this._queueNext();
      }
      return true;
    }

    // Register first so partial signal setup can use the normal owned cleanup.
    const pending = { objects: new Set(), token: {}, track };
    this.set(metaWindow, { pending, queued: !!track, failed: false });
    try {
      for (
        const { object, signal, handler } of [
          ...entries,
          {
            object: metaWindow,
            signal: "unmanaged",
            handler: () => this.remove(metaWindow),
          },
        ]
      ) {
        object.connectObject(signal, handler, pending.token);
        pending.objects.add(object);
      }
      this._queueNext();
    } catch (error) {
      this.remove(metaWindow);
      throw error;
    }
    return true;
  }

  queueTrack(metaWindow, handler) {
    this.addPending(metaWindow, [], handler);
  }

  activate(metaWindow, data) {
    const record = { ...data, pending: null, queued: false, failed: false };
    this.set(metaWindow, record);
    return record;
  }

  queueSync(metaWindow) {
    const record = this.get(metaWindow);
    // A failed active record may be partially torn down. Only reconciliation
    // may replace it; ordinary geometry events must not revive it.
    if (!record || record.pending || record.failed) return;
    record.queued = true;
    this._queueNext();
  }

  updateNow(metaWindow, update) {
    const record = this.get(metaWindow);
    if (
      !record ||
      record.pending ||
      record.failed ||
      !isLiveObject(metaWindow) ||
      !this._manager.isLiveWindowData(record)
    ) return;

    // A failed actor mutation leaves this record unsafe for later events.
    // Mark it failed before propagating the original exception.
    try {
      return update(record);
    } catch (error) {
      if (this.get(metaWindow) === record) {
        record.queued = false;
        record.failed = true;
      }
      throw error;
    }
  }

  syncNow(metaWindow) {
    const record = this.get(metaWindow);
    if (!record || record.pending || record.failed) return;
    record.queued = false;
    try {
      return this.updateNow(
        metaWindow,
        (data) => this._manager.syncBorder(metaWindow, data),
      );
    } finally {
      // Keep a self-requeuing window from starving later records.
      if (this.get(metaWindow) === record) {
        super.delete(metaWindow);
        super.set(metaWindow, record);
      }
    }
  }

  remove(metaWindow) {
    const record = this.get(metaWindow);
    if (!record) return null;
    record.queued = false;
    try {
      this._clearPending(record);
      // Keep active data available for retry unless every cleanup step succeeds.
      if (!record.pending) this._manager.cleanupWindow(metaWindow, record);
    } catch (error) {
      record.failed = true;
      throw error;
    }
    super.delete(metaWindow);
    return record;
  }

  removeAll(metaWindows) {
    // Preserve failed records for retry without stranding independent cleanup.
    return runAll(Array.from(metaWindows, (win) => () => this.remove(win)));
  }

  _clearPending(record) {
    if (!record?.pending) return;
    const { objects, token } = record.pending;
    const error = runAll(Array.from(objects, (object) => () => {
      if (isLiveObject(object)) object.disconnectObject(token);
    }));
    if (error) throw error;
  }

  _cancelQueue() {
    if (this._idleId) GLib.source_remove(this._idleId);
    this._idleId = 0;
    for (const record of this.values()) record.queued = false;
  }

  _nextQueued() {
    for (const entry of this.entries()) {
      if (entry[1].queued) return entry;
    }
    return null;
  }

  _processQueued(metaWindow, record) {
    if (record.pending) {
      const handler = record.pending.track;
      const live = isLiveObject(metaWindow);
      this.remove(metaWindow);
      if (live) handler(metaWindow);
    } else {
      this.syncNow(metaWindow);
    }
  }

  _queueNext() {
    if (this._idleId || !this._nextQueued()) return;

    // One source owns all deferred window work and yields after each item.
    this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      const next = this._nextQueued();
      if (!next) {
        this._idleId = 0;
        return GLib.SOURCE_REMOVE;
      }

      const [metaWindow, record] = next;
      try {
        this._processQueued(metaWindow, record);
      } catch (error) {
        // A failed record must not strand unrelated queued work.
        this._idleId = 0;
        this._queueNext();
        throw error;
      }

      if (this._nextQueued()) return GLib.SOURCE_CONTINUE;
      this._idleId = 0;
      return GLib.SOURCE_REMOVE;
    });
  }
}

// Shell actors can disappear during graphics resets without normal lifecycle
// signals. Treat disposed GObjects as dead without generating secondary errors.
export function isLiveObject(object) {
  if (!object) return false;
  try {
    return !object.is_destroyed?.();
  } catch {
    return false;
  }
}

export function isInterestingWindow(metaWindow, modalEnabled, WindowType) {
  if (!modalEnabled) {
    if (metaWindow.get_transient_for?.()) return false;
    if (metaWindow.is_attached_dialog?.()) return false;
  }

  const type = metaWindow.get_window_type();
  if (type === WindowType.MODAL_DIALOG) return modalEnabled;
  return type === WindowType.NORMAL || type === WindowType.DIALOG;
}

export function runAll(actions) {
  let firstError = null;
  for (const action of actions) {
    // Cleanup actions own independent resources. One disposed GObject must not
    // prevent later resources from being released; return the first failure.
    try {
      action();
    } catch (error) {
      firstError ??= error;
    }
  }
  return firstError;
}

export function createBorderAttachment(actor, border) {
  let originalClip;
  let clipLeased = false;

  const attach = () => {
    originalClip = actor.clip_to_allocation;
    clipLeased = true;
    actor.clip_to_allocation = false;
    border.clip_to_allocation = false;
    actor.add_child(border);
    actor.set_child_above_sibling(border, null);
  };

  const release = () => {
    try {
      if (
        isLiveObject(actor) &&
        isLiveObject(border) &&
        border.get_parent?.() === actor
      ) {
        actor.remove_child(border);
      }
    } finally {
      // Border removal may fail, but it must never retain our clipping lease.
      if (clipLeased && isLiveObject(actor) && !actor.clip_to_allocation) {
        actor.clip_to_allocation = originalClip;
      }
      clipLeased = false;
    }
  };

  return { attach, release };
}
