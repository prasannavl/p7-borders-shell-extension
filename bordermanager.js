import Meta from "gi://Meta";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { computeBorderState } from "./borderstate.js";
import { applyBorderState, getWindowState } from "./compat.js";
import { ConfigManager } from "./config.js";
import {
  isInterestingWindow,
  isLiveObject,
  PendingTracker,
} from "./windowtracking.js";

export class BorderManager {
  constructor(logger, settings) {
    this._logger = logger;

    /** @type {Map<Meta.Window, {
     *   border: St.Widget,
     *   actor: Meta.WindowActor,
     *   config: any,
     *   borderStyleCache: string | null,
     * }>} */
    this._windowData = new Map();

    // The pending object tracker handles all the nuances in window
    // tracking before it's handed over cleanly post init.
    // This contains the edge cases to cleanup signals in the mid
    // state between when a new window singal from mutter
    // and when we actually track a window fully (which happens
    // only after the actor has been allocated).
    // It additionally also takes care of sync queues.
    this._pending = new PendingTracker(this);
    /** @type {Meta.Window | null} */
    this._lastFocusedWindow = null;

    /** @type {ConfigManager | null} */
    this.configManager = new ConfigManager(settings, this._logger);
    this._configChangeCallback = (x) => this._onConfigChanged(x);
    this.configManager.addConfigChangeListener(this._configChangeCallback);
  }

  // --- Helpers ------------------------------------------------------------

  isLiveWindowData(data) {
    return !!(data && isLiveObject(data.actor) && isLiveObject(data.border));
  }

  _isInterestingWindow(metaWindow) {
    const modalEnabled = this.configManager?.globalConfig?.modalEnabled ??
      false;
    return isInterestingWindow(metaWindow, modalEnabled, Meta.WindowType);
  }

  _resyncAll() {
    for (const [win, data] of this._windowData.entries()) {
      // Get fresh config to ensure we have latest colors/settings
      const config = this.configManager.getConfigForWindow(win);
      data.config = config;
      this._invalidateAndUpdate(win, data);
    }
  }

  _hideBorder(data) {
    if (!data) return;
    data.border.visible = false;
    data.borderStyleCache = null;
  }

  _invalidateAndUpdate(metaWindow, data) {
    if (!data) return;
    data.borderStyleCache = null;
    this._queueUpdate(metaWindow, data);
  }

  _logWindow(metaWindow, prefix, config, extra) {
    if (!this._isVerboseLogging()) return;
    const title = metaWindow.get_title() || "untitled";
    const wmClass = metaWindow.get_wm_class() || "unknown";
    const configTail = config
      ? ` m: ${JSON.stringify(config.margins)}, r: ${
        JSON.stringify(config.radius)
      }`
      : "";
    const extraTail = extra ? ` ${extra}` : "";
    this._logger.log(
      `${prefix}: ${title} (class: ${wmClass})${configTail}${extraTail}`,
    );
  }

  _untrackAllWindows() {
    const tracked = Array.from(this._windowData.keys());
    for (const win of tracked) this._untrackWindow(win);
  }

  _trackAllWindows() {
    for (const win of global.display.list_all_windows()) {
      this._tryTrackWindow(win);
    }
  }

  _retrackAllWindows() {
    this._pending.clearAll();
    this._untrackAllWindows();
    this._trackAllWindows();
  }

  _queueUpdate(metaWindow, windowData = null) {
    if (!metaWindow) return;
    // Schedule sync on next idle cycle for smooth updates
    this._pending.addSync(metaWindow, windowData);
  }

  _isVerboseLogging() {
    return !!this.configManager?.globalConfig?.verboseLogging;
  }

  _waitForActorReady(metaWindow, actor) {
    // There are times we do get empty actors. If we
    // don't check for them, it causes a flood of
    // noisy errors from gnome-shell.
    if (!actor) {
      return this._pending.addTrack(metaWindow, [
        {
          object: metaWindow,
          signal: "shown",
          handler: () => {
            this._pending.clearTrack(metaWindow);
            this._tryTrackWindow(metaWindow);
          },
        },
      ]);
    }

    const allocation = actor.get_allocation_box();
    const allocWidth = allocation ? allocation.get_width() : 0;
    const allocHeight = allocation ? allocation.get_height() : 0;

    // DEFENSIVE checks to schedule when actor exists
    // but has zero allocation initially
    if (!allocation || allocWidth <= 0 || allocHeight <= 0) {
      return this._pending.addTrack(metaWindow, [
        {
          object: actor,
          signal: "notify::allocation",
          handler: () => {
            const alloc = actor.get_allocation_box();
            const w = alloc ? alloc.get_width() : 0;
            const h = alloc ? alloc.get_height() : 0;
            if (alloc && w > 0 && h > 0) {
              this._pending.clearTrack(metaWindow);
              this._tryTrackWindow(metaWindow);
            }
          },
        },
      ]);
    }

    return false;
  }

  // --- Core geometry + style sync -----------------------------------------

  syncBorder(metaWindow, data) {
    const { border, actor, config } = data;

    const windowState = getWindowState(metaWindow, actor);
    const policyState = computeBorderState(windowState, config);

    applyBorderState(border, policyState, data);
  }

  // --- Per-window lifecycle -----------------------------------------------

  _updateWindowConfig(metaWindow) {
    const data = this._windowData.get(metaWindow);
    if (!data) return;

    const config = this.configManager.getConfigForWindow(metaWindow);

    // Only update if config actually changed
    if (data.config === config) return;

    data.config = config;

    this._invalidateAndUpdate(metaWindow, data);
    this._logWindow(metaWindow, "config updated", config);
  }

  _tryTrackWindow(metaWindow) {
    if (!this._isInterestingWindow(metaWindow)) return;
    if (this._windowData.has(metaWindow)) return;

    // DEFENSIVE checks to first schedule since the actor
    // will not immediately be ready on window creation
    const actor = metaWindow.get_compositor_private();
    if (this._waitForActorReady(metaWindow, actor)) return;

    // We're ready now to actually do the work.

    const border = new St.Widget({
      reactive: false,
      visible: false,
    });

    // Ensure we can draw outside if "outer" expands
    actor.clip_to_allocation = false;
    border.clip_to_allocation = false;

    actor.add_child(border);
    actor.set_child_above_sibling(border, null);

    const config = this.configManager.getConfigForWindow(metaWindow);

    const windowData = {
      border,
      actor,
      config,
      borderStyleCache: null,
    };
    this._windowData.set(metaWindow, windowData);

    actor.connectObject(
      "notify::allocation",
      () => this._queueUpdate(metaWindow, windowData),
      this,
    );
    metaWindow.connectObject(
      "unmanaged",
      () => this._untrackWindow(metaWindow),
      "notify::fullscreen",
      () => {
        if (metaWindow.fullscreen) {
          this._hideBorder(windowData);
        } else {
          this._queueUpdate(metaWindow, windowData);
        }
      },
      "notify::wm-class",
      () => this._updateWindowConfig(metaWindow),
      "notify::gtk-application-id",
      () => this._updateWindowConfig(metaWindow),
      "notify::title",
      () => this._updateWindowConfig(metaWindow),
      "notify::appears-focused",
      () => this._queueUpdate(metaWindow, windowData),
      "position-changed",
      () => {
        // Prevent mutter from leaving artifacts when moving windows quickly
        // until resize is fully complete.
        border.queue_redraw();
      },
      "size-changed",
      () => {
        // We hide the border of size change to prevent old borders from
        // showing up as artifacts during resize. notify::allocation handler
        // will be fired again once the the new size is allocated. That's
        // queued and coalesced, so that draws it smoothly. This removes
        // artifacting and makes smooth consistent borders during resize.
        // This can cause it's own artifacts, as minor blinks.
        // this._hideBorder(windowData);

        // Let's just redraw the border entirely right away, it's not that
        // costly but provides the smoothest experience.
        this._pending.clearSync(metaWindow);
        this.syncBorder(metaWindow, windowData);
      },
      this,
    );

    this._logWindow(
      metaWindow,
      "track",
      config,
      `pending: ${this._pending.trackCount()}`,
    );

    // Initial sync
    this._queueUpdate(metaWindow, windowData);
  }

  _untrackWindow(metaWindow) {
    // Cancel pending signal tracking
    this._pending.clearForWindow(metaWindow);
    const data = this._windowData.get(metaWindow);
    if (!data) return;

    this._logWindow(metaWindow, "untrack", data.config);

    const { border, actor } = data;
    if (isLiveObject(metaWindow)) metaWindow.disconnectObject(this);
    if (isLiveObject(actor)) actor.disconnectObject(this);

    if (this.isLiveWindowData(data) && border.get_parent?.() === actor) {
      actor.remove_child(border);
    }

    this._windowData.delete(metaWindow);
  }

  _onConfigChanged(changeType) {
    this._logger.log(`conf changed: ${changeType}`);
    this._retrackAllWindows();
  }

  _onFocusChanged() {
    const currentFocus = global.display.focus_window;
    const lastData = this._lastFocusedWindow
      ? this._windowData.get(this._lastFocusedWindow)
      : null;
    const currentData = currentFocus
      ? this._windowData.get(currentFocus)
      : null;

    const lastValid = lastData && this.isLiveWindowData(lastData);
    const currentValid = !currentFocus ||
      (currentData && this.isLiveWindowData(currentData));

    // If either focused window is invalid, it's either the
    // first window or something went wrong with tracking,
    // focus tacking, resync all
    if (
      (this._lastFocusedWindow && !lastValid) ||
      (currentFocus && !currentValid)
    ) {
      this._resyncAll();
      this._lastFocusedWindow = currentFocus;
      return;
    }

    // Sync the previously focused window (if any)
    this._queueUpdate(this._lastFocusedWindow, lastData);
    // Sync the newly focused window (if any)
    this._queueUpdate(currentFocus, currentData);

    // Update last focused window
    this._lastFocusedWindow = currentFocus;
  }

  _onWindowCreated(metaWindow) {
    this._tryTrackWindow(metaWindow);
  }

  // --- Extension lifecycle -------------------------------------------------

  enable() {
    const display = global.display;

    display.connectObject(
      "window-created",
      (_display, metaWindow) => this._onWindowCreated(metaWindow),
      "workareas-changed",
      () => this._resyncAll(),
      "notify::focus-window",
      () => this._onFocusChanged(),
      this,
    );
    Main.layoutManager.connectObject(
      "monitors-changed",
      () => this._resyncAll(),
      this,
    );

    // Attach to existing windows
    this._trackAllWindows();
  }

  disable() {
    // Remove config change listener
    this.configManager.removeConfigChangeListener(this._configChangeCallback);

    // Clean up config manager
    this.configManager.destroy();
    this.configManager = null;
    this._configChangeCallback = null;
    // Disconnect all extension signals
    global.display.disconnectObject(this);
    Main.layoutManager.disconnectObject(this);

    this._pending.clearAll();
    this._untrackAllWindows();
  }
}
