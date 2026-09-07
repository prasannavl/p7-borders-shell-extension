import Meta from "gi://Meta";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { computeBorderState } from "../common/border.js";
import { applyBorderState, getWindowState } from "./compat.js";
import { ConfigManager } from "../common/config.js";
import {
  createBorderAttachment,
  isInterestingWindow,
  isLiveObject,
  runAll,
  WindowTracker,
} from "./windowtracking.js";

export class BorderManager {
  constructor(logger, settings) {
    this._logger = logger;

    // One registry owns each window from the initial actor wait through active
    // border updates and final cleanup, including all deferred work.
    /** @type {WindowTracker<Meta.Window, {
     *   border: St.Widget,
     *   actor: Meta.WindowActor,
     *   config: any,
     *   borderStyle: string | null,
     *   releaseBorder: Function,
     * }>} */
    this._windows = new WindowTracker(this);
    /** @type {Meta.Window | null} */
    this._lastFocusedWindow = null;

    /** @type {ConfigManager | null} */
    this.configManager = new ConfigManager(
      settings,
      this._logger,
      (change) => this._onConfigChanged(change),
    );
  }

  // --- Extension lifecycle -------------------------------------------------

  enable() {
    const display = global.display;

    display.connectObject(
      "window-created",
      (_display, metaWindow) => this._queueTrackWindow(metaWindow),
      "workareas-changed",
      () => this._resyncAllGeometry(),
      "notify::focus-window",
      () => this._onFocusChanged(),
      this,
    );
    Main.layoutManager.connectObject(
      "monitors-changed",
      () => this._resyncAllGeometry(),
      this,
    );

    this._reconcileAllWindows();
  }

  disable() {
    // A failed resource remains retryable, while unrelated resources still
    // release during the same disable attempt.
    const error = runAll([
      () => {
        if (!this.configManager) return;
        this.configManager.destroy();
        this.configManager = null;
      },
      () => global.display.disconnectObject(this),
      () => Main.layoutManager.disconnectObject(this),
      () => this._windows.clear(),
    ]);
    if (error) throw error;
  }

  // --- Window tracker contract --------------------------------------------

  syncBorder(metaWindow, data) {
    const { actor, config } = data;

    const windowState = getWindowState(metaWindow, actor);
    const policyState = computeBorderState(windowState, config);

    this._applyBorderState(data, policyState);
  }

  cleanupWindow(metaWindow, data) {
    this._logWindow(metaWindow, "untrack", data.config);

    const { actor } = data;
    const error = runAll([
      () => {
        if (isLiveObject(metaWindow)) metaWindow.disconnectObject(this);
      },
      () => {
        if (isLiveObject(actor)) actor.disconnectObject(this);
      },
      () => data.releaseBorder(),
    ]);
    if (error) throw error;
  }

  isLiveWindowData(data) {
    return isLiveObject(data?.actor) && isLiveObject(data?.border);
  }

  // --- Window lifecycle ----------------------------------------------------

  _isInterestingWindow(metaWindow) {
    const modalEnabled = this.configManager?.globalConfig?.modalEnabled ??
      false;
    return isInterestingWindow(metaWindow, modalEnabled, Meta.WindowType);
  }

  _isUnexpectedlyUntracked(metaWindow) {
    return isLiveObject(metaWindow) &&
      this._isInterestingWindow(metaWindow) &&
      !this._windows.isViable(metaWindow);
  }

  _resyncAllGeometry() {
    for (const win of this._windows.keys()) this._queueUpdate(win);
  }

  _refreshAllWindowConfigs() {
    const error = runAll(Array.from(
      this._windows.keys(),
      (win) => () => this._updateWindowConfig(win),
    ));
    if (error) throw error;
  }

  _applyBorderState(data, state) {
    // Commit the cache only after the corresponding actor update succeeds.
    data.borderStyle = applyBorderState(
      data.border,
      state,
      data.borderStyle,
    );
  }

  _invalidateAndUpdate(metaWindow, data) {
    data.borderStyle = null;
    this._queueUpdate(metaWindow);
  }

  _isVerboseLogging() {
    return !!this.configManager?.globalConfig?.verboseLogging;
  }

  _logWindow(metaWindow, prefix, config) {
    if (!this._isVerboseLogging()) return;

    try {
      const title = metaWindow.get_title() || "untitled";
      const wmClass = metaWindow.get_wm_class() || "unknown";
      this._logger.log(
        `${prefix}: ${title} (class: ${wmClass}) ` +
          `m: ${JSON.stringify(config.margins)}, ` +
          `r: ${JSON.stringify(config.radius)}`,
      );
    } catch {
      // Meta.Window may already be disposed during cleanup. Diagnostics must
      // never prevent the remaining resources from being released.
    }
  }

  _reconcileAllWindows() {
    const windows = global.display.list_all_windows();
    const current = new Set(windows);
    const stale = Array.from(this._windows.keys()).filter((win) => (
      !current.has(win) ||
      !this._windows.isViable(win) ||
      !this._isInterestingWindow(win)
    ));
    const cleanupError = this._windows.removeAll(stale);
    for (const win of windows) this._queueTrackWindow(win);
    if (cleanupError) throw cleanupError;
  }

  _queueUpdate(metaWindow) {
    // Draw on the next idle cycle so bursts of Shell signals coalesce.
    this._windows.queueSync(metaWindow);
  }

  _queueTrackWindow(metaWindow) {
    // Attach one border per idle turn so startup and retracking cannot monopolize
    // the Shell thread. The tracker owns cancellation until attachment begins.
    if (!this._isInterestingWindow(metaWindow)) return;
    this._windows.queueTrack(metaWindow, (win) => this._tryTrackWindow(win));
  }

  _retryTrackWindow(metaWindow) {
    this._windows.remove(metaWindow);
    this._queueTrackWindow(metaWindow);
  }

  _waitForActorReady(metaWindow, actor) {
    const waitFor = (object, signal, handler) =>
      this._windows.addPending(metaWindow, [{ object, signal, handler }]);

    // Mutter can announce a window before its compositor actor exists. Waiting
    // avoids repeated Shell errors while keeping the pending signals owned.
    if (!actor) {
      return waitFor(
        metaWindow,
        "shown",
        () => this._retryTrackWindow(metaWindow),
      );
    }

    // An actor can likewise exist before receiving a usable allocation.
    if (!hasAllocation(actor)) {
      return waitFor(
        actor,
        "notify::allocation",
        () => {
          if (hasAllocation(actor)) this._retryTrackWindow(metaWindow);
        },
      );
    }

    return false;
  }

  _updateWindowConfig(metaWindow) {
    const config = this._windows.updateNow(metaWindow, (data) => {
      const config = this.configManager.getConfigForWindow(metaWindow);
      if (data.config === config) return null;

      data.config = config;
      this._invalidateAndUpdate(metaWindow, data);
      return config;
    });
    if (config) this._logWindow(metaWindow, "config updated", config);
  }

  _tryTrackWindow(metaWindow) {
    if (
      this._windows.has(metaWindow) || !this._isInterestingWindow(metaWindow)
    ) return;

    const actor = metaWindow.get_compositor_private();
    if (this._waitForActorReady(metaWindow, actor)) return;

    const border = new St.Widget({
      reactive: false,
      visible: false,
    });
    const config = this.configManager.getConfigForWindow(metaWindow);

    // Register ownership before the first fallible actor mutation, so failed
    // attachment rollback remains part of normal retryable window cleanup.
    const attachment = createBorderAttachment(actor, border);
    this._windows.activate(metaWindow, {
      border,
      actor,
      config,
      borderStyle: null,
      releaseBorder: attachment.release,
    });

    try {
      attachment.attach();
      actor.connectObject(
        "notify::allocation",
        () => this._queueUpdate(metaWindow),
        this,
      );
      metaWindow.connectObject(
        "unmanaged",
        () => this._windows.remove(metaWindow),
        "notify::fullscreen",
        () => {
          if (metaWindow.fullscreen) this._windows.syncNow(metaWindow);
          else this._queueUpdate(metaWindow);
        },
        "notify::wm-class",
        () => this._updateWindowConfig(metaWindow),
        "notify::gtk-application-id",
        () => this._updateWindowConfig(metaWindow),
        "notify::appears-focused",
        () => this._queueUpdate(metaWindow),
        "position-changed",
        () => {
          // Prevent Mutter from leaving artifacts while moving windows quickly.
          this._windows.updateNow(
            metaWindow,
            (data) => data.border.queue_redraw(),
          );
        },
        "size-changed",
        () => {
          // Resize immediately for the smoothest result; the later allocation
          // notification is still queued and coalesced normally.
          this._windows.syncNow(metaWindow);
        },
        this,
      );

      this._logWindow(metaWindow, "track", config);

      // The initial actor state may not emit another signal after attachment.
      this._queueUpdate(metaWindow);
    } catch (error) {
      this._windows.remove(metaWindow);
      throw error;
    }
  }

  _onConfigChanged(changeType) {
    this._logger.log(`conf changed: ${changeType}`);
    if (changeType === "modal-enabled") this._reconcileAllWindows();
    else if (changeType !== "verbose-logging") {
      this._refreshAllWindowConfigs();
    }
  }

  _onFocusChanged() {
    const currentFocus = global.display.focus_window;
    const lastFocus = this._lastFocusedWindow;

    if (
      this._isUnexpectedlyUntracked(lastFocus) ||
      this._isUnexpectedlyUntracked(currentFocus)
    ) {
      // A missing or disposed record indicates a Shell lifecycle gap. Reconcile
      // every record because a geometry resync cannot recreate window actors.
      this._reconcileAllWindows();
      this._lastFocusedWindow = currentFocus;
      return;
    }

    if (lastFocus) this._queueUpdate(lastFocus);
    if (currentFocus) this._queueUpdate(currentFocus);

    this._lastFocusedWindow = currentFocus;
  }
}

function hasAllocation(actor) {
  const box = actor.get_allocation_box();
  return box && box.get_width() > 0 && box.get_height() > 0;
}
