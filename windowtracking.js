import GLib from "gi://GLib";

// Shell actors can disappear during graphics resets without normal lifecycle
// signals. Treat disposed GObjects as dead without generating secondary errors.
export function isLiveObject(object) {
  if (!object) return false;
  try {
    if (typeof object.is_destroyed !== "function") return true;
    return !object.is_destroyed();
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

export class PendingTracker {
  constructor(manager) {
    this._manager = manager;
    this.tracks = new Map();
    this.syncs = new Map();
  }

  isTracked(metaWindow) {
    return this.tracks.has(metaWindow);
  }

  _track(metaWindow, entries) {
    const token = {};
    const objects = [];
    for (const { object, signal, handler } of entries) {
      object.connectObject(signal, handler, token);
      objects.push(object);
    }
    this.tracks.set(metaWindow, { objects, token });
  }

  addTrack(metaWindow, entries) {
    if (this.isTracked(metaWindow)) return true;
    this._track(metaWindow, [
      ...entries,
      {
        object: metaWindow,
        signal: "unmanaged",
        handler: () => this.clearTrack(metaWindow),
      },
    ]);
    return true;
  }

  clearTrack(metaWindow) {
    const pending = this.tracks.get(metaWindow);
    if (!pending) return;
    const { objects, token } = pending;
    for (const object of objects) {
      if (isLiveObject(object)) object.disconnectObject(token);
    }
    this.tracks.delete(metaWindow);
  }

  clearAllTracks() {
    for (const metaWindow of Array.from(this.tracks.keys())) {
      this.clearTrack(metaWindow);
    }
  }

  addSync(metaWindow, windowData = null) {
    this.clearSync(metaWindow);
    const idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this.syncs.delete(metaWindow);
      const latestData = windowData ??
        this._manager._windowData.get(metaWindow);
      if (
        isLiveObject(metaWindow) &&
        this._manager.isLiveWindowData(latestData)
      ) {
        this._manager.syncBorder(metaWindow, latestData);
      }
      return GLib.SOURCE_REMOVE;
    });
    this.syncs.set(metaWindow, idleId);
  }

  clearSync(metaWindow) {
    const pendingSyncId = this.syncs.get(metaWindow);
    if (!pendingSyncId) return;
    GLib.Source.remove(pendingSyncId);
    this.syncs.delete(metaWindow);
  }

  clearAllSyncs() {
    for (const metaWindow of Array.from(this.syncs.keys())) {
      this.clearSync(metaWindow);
    }
  }

  clearForWindow(metaWindow) {
    this.clearTrack(metaWindow);
    this.clearSync(metaWindow);
  }

  clearAll() {
    this.clearAllSyncs();
    this.clearAllTracks();
  }

  trackCount() {
    return this.tracks.size;
  }
}
