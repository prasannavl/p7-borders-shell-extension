import GLib from "gi://GLib";
import Meta from "gi://Meta";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { applyBorderState, getWindowState } from "./compat.js";
import { ConfigManager } from "./config.js";

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
		/** @type {Map<Meta.Window, {object: any, token: object}>} */
		this._pendingTrack = new Map();
		/** @type {Map<Meta.Window, number>} */
		this._pendingSyncs = new Map();
		/** @type {Meta.Window | null} */
		this._lastFocusedWindow = null;

		/** @type {ConfigManager | null} */
		this.configManager = new ConfigManager(settings, this._logger);
		this._configChangeCallback = (x) => this._onConfigChanged(x);
		this.configManager.addConfigChangeListener(this._configChangeCallback);
	}

	// --- Helpers ------------------------------------------------------------

	_isInterestingWindow(metaWindow) {
		const modalEnabled =
			this.configManager?.globalConfig?.modalEnabled ?? false;

		if (!modalEnabled) {
			const transientFor = metaWindow.get_transient_for?.();
			if (transientFor) return false;
			if (metaWindow.is_attached_dialog?.()) return false;
		}

		const type = metaWindow.get_window_type();

		const WindowType = Meta.WindowType;
		if (type === WindowType.MODAL_DIALOG) return modalEnabled;
		return type === WindowType.NORMAL || type === WindowType.DIALOG;
	}

	_resyncAll() {
		for (const [win, data] of this._windowData.entries()) {
			// Get fresh config to ensure we have latest colors/settings
			const config = this.configManager.getConfigForWindow(win);
			data.config = config;
			// Clear style cache to force reapplication of colors
			data.borderStyleCache = null;
			this._queueUpdate(win, data);
		}
	}

	_hideBorder(data) {
		if (!data) return;
		data.border.visible = false;
		data.borderStyleCache = null;
	}

	_setPendingTrack(metaWindow, object, signal, handler) {
		const token = {};
		object.connectObject(signal, handler, token);
		this._pendingTrack.set(metaWindow, { object, token });
	}

	_clearPendingTrack(metaWindow) {
		const pending = this._pendingTrack.get(metaWindow);
		if (!pending) return;
		const { object, token } = pending;
		if (object && !object.is_destroyed?.()) object.disconnectObject(token);
		this._pendingTrack.delete(metaWindow);
	}

	_clearPendingTracks() {
		for (const [_win, pending] of this._pendingTrack.entries()) {
			const { object, token } = pending;
			if (object && !object.is_destroyed?.()) object.disconnectObject(token);
		}
		this._pendingTrack.clear();
	}

	_clearPendingSync(metaWindow) {
		const pendingSyncId = this._pendingSyncs.get(metaWindow);
		if (!pendingSyncId) return;
		GLib.Source.remove(pendingSyncId);
		this._pendingSyncs.delete(metaWindow);
	}

	_clearPendingSyncs() {
		for (const [_win, syncId] of this._pendingSyncs.entries()) {
			GLib.Source.remove(syncId);
		}
		this._pendingSyncs.clear();
	}

	_untrackAllWindows() {
		const tracked = Array.from(this._windowData.keys());
		for (const win of tracked) this._untrackWindow(win);
	}

	_trackAllWindows() {
		for (const win of global.display.list_all_windows())
			this._tryTrackWindow(win);
	}

	_retrackAllWindows() {
		this._clearPendingSyncs();
		this._clearPendingTracks();
		this._untrackAllWindows();
		this._trackAllWindows();
	}

	_queueUpdate(metaWindow, data) {
		if (!data) return;

		// Coalesce rapid updates: only the last scheduled sync runs
		this._clearPendingSync(metaWindow);

		// Schedule sync on next idle cycle for smooth updates
		const idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
			this._pendingSyncs.delete(metaWindow);

			if (this._isLiveWindowData(data)) {
				this._syncBorderToActor(metaWindow, data);
			}
			return GLib.SOURCE_REMOVE;
		});
		this._pendingSyncs.set(metaWindow, idleId);
	}

	_isLiveWindowData(data) {
		return !!(
			data &&
			!data.actor?.is_destroyed?.() &&
			!data.border?.is_destroyed?.()
		);
	}

	// --- Core geometry + style sync -----------------------------------------

	_syncBorderToActor(metaWindow, data) {
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

		// Clear style cache to force reapplication of colors/settings
		data.borderStyleCache = null;
		this._queueUpdate(metaWindow, data);

		const windowTitle = metaWindow.get_title() || "untitled";
		this._logger.log(
			`config updated: ${windowTitle} (class: ${metaWindow.get_wm_class() || "unknown"}) m: ${JSON.stringify(config.margins)}, r: ${JSON.stringify(config.radius)}`,
		);
	}

	_tryTrackWindow(metaWindow) {
		if (!this._isInterestingWindow(metaWindow)) return;
		if (this._windowData.has(metaWindow)) return;

		// DEFENSIVE checks to first schedule since the actor
		// will not immediately be ready on window creation
		const actor = metaWindow.get_compositor_private();
		if (!actor) {
			// Actor not ready yet - listen for when window is shown (actor will be ready by then)
			if (this._pendingTrack.has(metaWindow)) return;
			this._setPendingTrack(metaWindow, metaWindow, "shown", () => {
				this._clearPendingTrack(metaWindow);
				this._tryTrackWindow(metaWindow);
			});
			return;
		}

		// Wait for actor to have proper allocation before proceeding
		const allocation = actor.get_allocation_box();
		const allocWidth = allocation ? allocation.get_width() : 0;
		const allocHeight = allocation ? allocation.get_height() : 0;

		// DEFENSIVE checks to schedule when actor exists
		// but has zero allocation initially
		if (!allocation || allocWidth <= 0 || allocHeight <= 0) {
			// Actor exists but not allocated yet - wait for allocation
			if (this._pendingTrack.has(metaWindow)) return;

			this._setPendingTrack(metaWindow, actor, "notify::allocation", () => {
				const alloc = actor.get_allocation_box();
				const w = alloc ? alloc.get_width() : 0;
				const h = alloc ? alloc.get_height() : 0;
				if (alloc && w > 0 && h > 0) {
					this._clearPendingTrack(metaWindow);
					this._tryTrackWindow(metaWindow);
				}
			});
			return;
		}
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
		actor.connectObject(
			"notify::allocation",
			() => this._queueUpdate(metaWindow, this._windowData.get(metaWindow)),
			this,
		);
		metaWindow.connectObject(
			"unmanaged",
			() => this._untrackWindow(metaWindow),
			"notify::fullscreen",
			() => {
				const data = this._windowData.get(metaWindow);
				if (metaWindow.fullscreen) {
					this._hideBorder(data);
				} else {
					this._queueUpdate(metaWindow, data);
				}
			},
			"notify::wm-class",
			() => this._updateWindowConfig(metaWindow),
			"notify::gtk-application-id",
			() => this._updateWindowConfig(metaWindow),
			"notify::title",
			() => this._updateWindowConfig(metaWindow),
			"notify::appears-focused",
			() => this._queueUpdate(metaWindow, this._windowData.get(metaWindow)),
			"position-changed",
			() => {
				// Prevent mutter from leaving artifacts when moving windows quickly
				// until resize is fully complete.
				border.queue_redraw();
			},
			this,
		);

		const windowTitle = metaWindow.get_title() || "untitled";
		const windowData = {
			border,
			actor,
			config,
			borderStyleCache: null,
		};
		this._windowData.set(metaWindow, windowData);

		this._logger.log(
			`track: ${windowTitle} (class: ${metaWindow.get_wm_class() || "unknown"}) m: ${JSON.stringify(config.margins)}, r: ${JSON.stringify(config.radius)}, pending: ${this._pendingTrack.size}`,
		);

		// Initial sync
		this._queueUpdate(metaWindow, windowData);
	}

	_untrackWindow(metaWindow) {
		// Cancel pending signal tracking
		this._clearPendingTrack(metaWindow);
		// Cancel any pending sync for this window
		this._clearPendingSync(metaWindow);
		const data = this._windowData.get(metaWindow);
		if (!data) return;

		const { border, actor } = data;
		metaWindow.disconnectObject(this);
		if (actor) actor.disconnectObject(this);

		if (this._isLiveWindowData(data) && border.get_parent?.() === actor) {
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

		const lastValid = lastData && this._isLiveWindowData(lastData);
		const currentValid =
			!currentFocus || (currentData && this._isLiveWindowData(currentData));

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

		this._clearPendingSyncs();
		this._clearPendingTracks();
		this._untrackAllWindows();
	}
}

function computeBorderState(windowState, config) {
	const { actorSize, frame, workarea, isFullscreen, maximize, isFocused } =
		windowState;
	const EDGE_EPS = 2;
	const ZERO_RADIUS = { tl: 0, tr: 0, br: 0, bl: 0 };
	const { margins, radius, width: borderWidth } = config;
	const radiusEnabled = !!(radius.tl || radius.tr || radius.br || radius.bl);

	if (
		isFullscreen ||
		maximize.full ||
		(!config.maximizedBorder && maximize.any) ||
		!borderWidth ||
		!config.enabled
	) {
		return { visible: false };
	}

	const { width, height } = actorSize;
	if (width <= 0 || height <= 0) {
		return { visible: false };
	}

	const edgeThreshold = Math.max(EDGE_EPS, borderWidth);
	const edges = {
		left: Math.abs(frame.x - workarea.x) <= edgeThreshold,
		right:
			Math.abs(frame.x + frame.width - (workarea.x + workarea.width)) <=
			edgeThreshold,
		top: Math.abs(frame.y - workarea.y) <= edgeThreshold,
		bottom:
			Math.abs(frame.y + frame.height - (workarea.y + workarea.height)) <=
			edgeThreshold,
	};

	const borderWidths = {
		top: edges.top ? 0 : borderWidth,
		right: edges.right ? 0 : borderWidth,
		bottom: edges.bottom ? 0 : borderWidth,
		left: edges.left ? 0 : borderWidth,
	};

	const effRadius =
		!radiusEnabled || maximize.any
			? ZERO_RADIUS
			: {
					tl: edges.top && edges.left ? 0 : radius.tl,
					tr: edges.top && edges.right ? 0 : radius.tr,
					br: edges.bottom && edges.right ? 0 : radius.br,
					bl: edges.bottom && edges.left ? 0 : radius.bl,
				};

	const pos = {
		x: -margins.left - borderWidths.left,
		y: -margins.top - borderWidths.top,
	};

	const size = {
		width: Math.max(
			1,
			width +
				margins.left +
				margins.right +
				borderWidths.left +
				borderWidths.right,
		),
		height: Math.max(
			1,
			height +
				margins.top +
				margins.bottom +
				borderWidths.top +
				borderWidths.bottom,
		),
	};

	return {
		visible: true,
		borderWidths,
		borderColor: isFocused ? config.activeColor : config.inactiveColor,
		radius: effRadius,
		pos,
		size,
	};
}
