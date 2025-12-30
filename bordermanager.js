import GLib from "gi://GLib";
import Meta from "gi://Meta";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import {
	applyBorderState,
	getMaximizeState,
	getWindowState,
} from "./compat.js";
import { ConfigManager } from "./config.js";

export class BorderManager {
	constructor(logger, settings) {
		this._logger = logger;

		/** @type {Map<Meta.Window, {
		 *   border: St.Widget,
		 *   actor: Meta.WindowActor,
		 *   signals: Array<{object: any, id: number}>,_signals
		 *   config: any,
		 * }>} */
		this._windowData = new Map();

		/** @type {Map<Meta.Window, number>} */
		this._pendingTrack = new Map();

		/** @type {Map<Meta.Window, number>} */
		this._pendingSyncs = new Map();

		/** @type {Array<{object: any, id: number}>} */
		this._signals = [];

		/** @type {Meta.Window | null} */
		this._lastFocusedWindow = null;

		/** @type {ConfigManager | null} */
		this.configManager = new ConfigManager(settings, this._logger);
		this._configChangeCallback = (changeType) => {
			this._logger.log(`Config changed: ${changeType}`);
			this._onConfigChanged(changeType);
		};
		this.configManager.addConfigChangeListener(this._configChangeCallback);
	}

	// --- Helpers ------------------------------------------------------------

	_hideBorder(border) {
		border.visible = false;
		border._lastStyleKey = null;
	}

	_isInterestingWindow(metaWindow) {
		const type = metaWindow.get_window_type();
		return (
			type === Meta.WindowType.NORMAL ||
			type === Meta.WindowType.DIALOG ||
			type === Meta.WindowType.MODAL_DIALOG
		);
	}

	_resyncAll() {
		for (const [win, data] of this._windowData.entries()) {
			const { actor, border } = data;
			// Get fresh config to ensure we have latest colors/settings
			const config = this.configManager.getConfigForWindow(win);
			data.config = config; // Update stored config

			// Clear style cache to force reapplication of colors
			border._lastStyleKey = null;

			this._syncWindow(win, border, actor, config);
		}
	}

	_syncWindow(metaWindow, border, actor, config) {
		// Coalesce rapid updates: only the last scheduled sync runs
		const existing = this._pendingSyncs.get(metaWindow);
		if (existing) {
			GLib.Source.remove(existing);
			this._pendingSyncs.delete(metaWindow);
		}

		// Schedule sync on next idle cycle for smooth updates
		const idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
			this._pendingSyncs.delete(metaWindow);
			if (!actor?.is_destroyed?.() && !border?.is_destroyed?.()) {
				try {
					const box = actor.get_allocation_box();
					this._syncBorderToActor(border, actor, box, config, metaWindow);
				} catch (err) {
					this._logger.error(
						`Err: ${metaWindow.get_title() || "untitled"} => ${err}`,
					);
				}
			}
			return GLib.SOURCE_REMOVE;
		});
		this._pendingSyncs.set(metaWindow, idleId);
	}

	// --- Core geometry + style sync -----------------------------------------

	_syncBorderToActor(border, actor, box, config, metaWindow) {
		const maximize = getMaximizeState(metaWindow);

		if (
			metaWindow.fullscreen ||
			maximize.full ||
			(!config.maximizedBorder && maximize.any) ||
			!config.width ||
			!config.enabled
		) {
			applyBorderState(border, { visible: false });
			return;
		}

		const windowState = getWindowState(metaWindow, actor, box, maximize);
		const policyState = computeBorderState({
			...windowState,
			config,
			radiusEnabled: this.configManager.radiusEnabled,
		});

		const borderColor = windowState.isFocused
			? config.activeColor
			: config.inactiveColor;
		applyBorderState(border, policyState, borderColor);
	}

	// --- Per-window lifecycle -----------------------------------------------

	_updateWindowConfig(metaWindow) {
		const data = this._windowData.get(metaWindow);
		if (!data) return;

		const { border, actor } = data;
		const config = this.configManager.getConfigForWindow(metaWindow);

		// Only update if config actually changed
		if (JSON.stringify(data.config) === JSON.stringify(config)) return;

		data.config = config;

		// Clear style cache to force reapplication of colors/settings
		border._lastStyleKey = null;

		this._syncWindow(metaWindow, border, actor, config);

		const windowTitle = metaWindow.get_title() || "untitled";
		this._logger.log(
			`Updated config: ${windowTitle} (${metaWindow.get_wm_class() || "unknown class"}) - Margins: ${JSON.stringify(config.margins)}, Radius: ${JSON.stringify(config.radius)}`,
		);
	}

	_trackWindow(metaWindow) {
		if (!this._isInterestingWindow(metaWindow)) return;

		if (this._windowData.has(metaWindow)) return;

		const actor = metaWindow.get_compositor_private();
		if (!actor) {
			// Actor not ready yet - listen for when window is shown (actor will be ready by then)
			if (this._pendingTrack.has(metaWindow)) return;

			const signalId = metaWindow.connect("shown", () => {
				metaWindow.disconnect(signalId);
				this._pendingTrack.delete(metaWindow);
				this._trackWindow(metaWindow);
			});

			this._pendingTrack.set(metaWindow, signalId);
			return;
		}

		// Wait for actor to have proper allocation before proceeding
		const allocation = actor.get_allocation_box();
		const allocWidth = allocation ? allocation.get_width() : 0;
		const allocHeight = allocation ? allocation.get_height() : 0;

		if (!allocation || allocWidth <= 0 || allocHeight <= 0) {
			// Actor exists but not allocated yet - wait for allocation
			if (this._pendingTrack.has(metaWindow)) return;

			const signalId = actor.connect("notify::allocation", () => {
				const alloc = actor.get_allocation_box();
				const w = alloc ? alloc.get_width() : 0;
				const h = alloc ? alloc.get_height() : 0;
				if (alloc && w > 0 && h > 0) {
					actor.disconnect(signalId);
					this._pendingTrack.delete(metaWindow);
					this._trackWindow(metaWindow);
				}
			});

			this._pendingTrack.set(metaWindow, signalId);
			return;
		}

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
		const signals = [
			{
				object: actor,
				id: actor.connect("notify::allocation", () => {
					const data = this._windowData.get(metaWindow);
					if (data) this._syncWindow(metaWindow, border, actor, data.config);
				}),
			},
			{
				object: metaWindow,
				id: metaWindow.connect("unmanaged", () =>
					this._untrackWindow(metaWindow),
				),
			},
			{
				object: metaWindow,
				id: metaWindow.connect("notify::fullscreen", () => {
					if (metaWindow.fullscreen) {
						this._hideBorder(border);
					} else {
						const data = this._windowData.get(metaWindow);
						if (data) this._syncWindow(metaWindow, border, actor, data.config);
					}
				}),
			},
			{
				object: metaWindow,
				id: metaWindow.connect("notify::wm-class", () =>
					this._updateWindowConfig(metaWindow),
				),
			},
			{
				object: metaWindow,
				id: metaWindow.connect("notify::gtk-application-id", () =>
					this._updateWindowConfig(metaWindow),
				),
			},
			{
				object: metaWindow,
				id: metaWindow.connect("notify::title", () =>
					this._updateWindowConfig(metaWindow),
				),
			},
			{
				object: metaWindow,
				id: metaWindow.connect("notify::appears-focused", () => {
					const data = this._windowData.get(metaWindow);
					if (data) this._syncWindow(metaWindow, border, actor, data.config);
				}),
			},
			{
				object: metaWindow,
				id: metaWindow.connect("position-changed", () => {
					// Prevent mutter from leaving artifacts when moving windows quickly
					// until resize is fully complete.
					border.queue_redraw();
				}),
			},
		];

		const windowTitle = metaWindow.get_title() || "untitled";
		this._windowData.set(metaWindow, {
			border,
			actor,
			signals,
			config,
		});

		this._logger.log(
			`Tracking window: ${windowTitle} (${metaWindow.get_wm_class() || "unknown class"}) - Margins: ${JSON.stringify(config.margins)}, Radius: ${JSON.stringify(config.radius)}`,
		);

		// Initial sync
		this._syncWindow(metaWindow, border, actor, config);
	}

	_untrackWindow(metaWindow) {
		// Cancel pending signal tracking
		const pending = this._pendingTrack.get(metaWindow);
		if (pending) {
			// Try disconnecting from both window and actor since we use both
			try {
				if (metaWindow && !metaWindow.is_destroyed?.()) {
					metaWindow.disconnect(pending);
				}
			} catch {}
			try {
				const actor = metaWindow?.get_compositor_private?.();
				if (actor && !actor.is_destroyed?.()) {
					actor.disconnect(pending);
				}
			} catch {}
			this._pendingTrack.delete(metaWindow);
		}

		const data = this._windowData.get(metaWindow);

		// Cancel any pending sync for this window
		const pendingSyncId = this._pendingSyncs.get(metaWindow);
		if (pendingSyncId) {
			GLib.Source.remove(pendingSyncId);
			this._pendingSyncs.delete(metaWindow);
		}

		if (!data) return;

		const { border, actor, signals } = data;

		// Disconnect all signals with disposal guards
		for (const { object, id } of signals) {
			try {
				if (object && !object.is_destroyed?.()) {
					object.disconnect(id);
				}
			} catch {}
		}

		// Remove border from actor with disposal guards
		try {
			if (
				border &&
				!border.is_destroyed?.() &&
				actor &&
				!actor.is_destroyed?.() &&
				border.get_parent?.() === actor
			) {
				actor.remove_child(border);
			}
		} catch {}

		this._windowData.delete(metaWindow);
	}

	_onConfigChanged(_changeType) {
		// For any config change, resync all windows
		this._resyncAll();
	}

	_onFocusChanged() {
		const currentFocus = global.display.focus_window;
		const lastData = this._lastFocusedWindow
			? this._windowData.get(this._lastFocusedWindow)
			: null;
		const currentData = currentFocus
			? this._windowData.get(currentFocus)
			: null;

		const lastValid =
			lastData &&
			!lastData.actor?.is_destroyed?.() &&
			!lastData.border?.is_destroyed?.();
		const currentValid =
			!currentFocus ||
			(currentData &&
				!currentData.actor?.is_destroyed?.() &&
				!currentData.border?.is_destroyed?.());

		if (
			(this._lastFocusedWindow && !lastValid) ||
			(currentFocus && !currentValid)
		) {
			this._resyncAll();
			this._lastFocusedWindow = currentFocus;
			return;
		}

		// Sync the previously focused window (if any)
		if (lastData) {
			this._syncWindow(
				this._lastFocusedWindow,
				lastData.border,
				lastData.actor,
				lastData.config,
			);
		}

		// Sync the newly focused window (if any)
		if (currentData) {
			this._syncWindow(
				currentFocus,
				currentData.border,
				currentData.actor,
				currentData.config,
			);
		}

		// Update last focused window
		this._lastFocusedWindow = currentFocus;
	}

	_onWindowCreated(metaWindow) {
		this._trackWindow(metaWindow);
	}

	// --- Extension lifecycle -------------------------------------------------

	enable() {
		const display = global.display;

		this._signals = [
			{
				object: display,
				id: display.connect("window-created", (_display, metaWindow) =>
					this._onWindowCreated(metaWindow),
				),
			},
			{
				object: display,
				id: display.connect("workareas-changed", () => this._resyncAll()),
			},
			{
				object: Main.layoutManager,
				id: Main.layoutManager.connect("monitors-changed", () =>
					this._resyncAll(),
				),
			},
			{
				object: display,
				id: display.connect("notify::focus-window", () =>
					this._onFocusChanged(),
				),
			},
		];

		// Attach to existing windows
		for (const actor of global.get_window_actors()) {
			if (!actor) continue;
			const win = actor.meta_window;
			if (win) this._trackWindow(win);
		}
	}

	disable() {

		// Remove config change listener
		this.configManager.removeConfigChangeListener(this._configChangeCallback);

		// Clean up config manager
		this.configManager.destroy();
		this.configManager = null;
		this._configChangeCallback = null;
		// Disconnect all extension signals
		for (const { object, id } of this._signals) {
			object.disconnect(id);
		}
		this._signals = [];

		// Cancel all pending syncs
		for (const [_win, syncId] of this._pendingSyncs.entries()) {
			GLib.Source.remove(syncId);
		}
		this._pendingSyncs.clear();

		// Cancel pending signal tracking
		for (const [win, signalId] of this._pendingTrack.entries()) {
			// Try disconnecting from both window and actor since we use both
			try {
				if (win && !win.is_destroyed?.()) {
					win.disconnect(signalId);
				}
			} catch {}
			try {
				const actor = win?.get_compositor_private?.();
				if (actor && !actor.is_destroyed?.()) {
					actor.disconnect(signalId);
				}
			} catch {}
			this._pendingTrack.delete(win);
		}

		for (const [win] of this._windowData.entries()) this._untrackWindow(win);
	}
}

function computeBorderState({
	actorSize,
	frame,
	workarea,
	config,
	isFullscreen,
	maximize,
	radiusEnabled,
}) {
	const { margins, radius, width: borderWidth } = config;

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

	const EPS = 2;
	const edgeThreshold = Math.max(EPS, borderWidth);
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
			? {
					tl: 0,
					tr: 0,
					br: 0,
					bl: 0,
				}
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
		radius: effRadius,
		pos,
		size,
	};
}
