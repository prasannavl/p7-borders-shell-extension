// extension.js

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { ConfigManager } from './config.js';

export default class WindowBorderExtension extends Extension {
    constructor(metadata) {
        super(metadata);

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
        
        this.configManager = new ConfigManager(this.getSettings());
        
        // Listen for config changes and update all windows
        this._configChangeCallback = (changeType) => {
            console.log(`[p7-borders] Config changed: ${changeType}`);
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
        // If there's already a pending sync for this window, skip this round
        if (this._pendingSyncs.has(metaWindow)) {
            return;
        }

        // Schedule sync on next idle cycle for smooth updates
        const idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._pendingSyncs.delete(metaWindow);
            if (!actor?.is_destroyed?.() && !border?.is_destroyed?.()) {
                try {
                    const box = actor.get_allocation_box();
                    this._syncBorderToActor(border, actor, box, config, metaWindow);
                } catch(err) {
                    console.error(`[p7-borders] Err: ${metaWindow.get_title() || 'untitled'} => ${err}`);
                }
            }
            return GLib.SOURCE_REMOVE;
        });
        this._pendingSyncs.set(metaWindow, idleId);
    }

    // --- Core geometry + style sync -----------------------------------------

    _syncBorderToActor(border, actor, box, config, metaWindow) {
        const { margins, radius, width: borderWidth } = config;
        // console.log(`[p7-borders] Syncing border for window: ${metaWindow.get_title() || 'untitled'}`);

        // Early return for various states
        const maximizeFlags = metaWindow.get_maximize_flags();
        const isAnyMaximized = maximizeFlags !== 0;
        
        if (metaWindow.fullscreen || 
            maximizeFlags === Meta.MaximizeFlags.BOTH || 
            (!config.maximizedBorder && isAnyMaximized) ||
            !borderWidth || 
            !config.enabled) {
            this._hideBorder(border);
            return;
        }

        const width = box.x2 - box.x1;
        const height = box.y2 - box.y1;
        if (width <= 0 || height <= 0) {
            this._hideBorder(border);
            return;
        }

        // Get frame and workarea with fallback
        let frame, workarea;
        try {
            frame = metaWindow.get_frame_rect();
            workarea = metaWindow.get_work_area_current_monitor?.() || 
                      global.display.get_monitor_workarea(metaWindow.get_monitor());
        } catch {
            workarea = global.display.get_monitor_workarea(metaWindow.get_monitor() || 0);
            frame = { x: actor.x, y: actor.y, width, height };
        }

        // Edge snapping detection (within 2px tolerance)
        const EPS = 2;
        const edges = {
            left: Math.abs(frame.x - workarea.x) <= EPS,
            right: Math.abs((frame.x + frame.width) - (workarea.x + workarea.width)) <= EPS,
            top: Math.abs(frame.y - workarea.y) <= EPS,
            bottom: Math.abs((frame.y + frame.height) - (workarea.y + workarea.height)) <= EPS
        };

        // Only border widths are affected by edge snapping
        const borderWidths = {
            top: edges.top ? 0 : config.width,
            right: edges.right ? 0 : config.width,
            bottom: edges.bottom ? 0 : config.width,
            left: edges.left ? 0 : config.width
        };

        // Check if window has any maximize flags set (we already have maximizeFlags from above)
        const isMaximized = maximizeFlags === Meta.MaximizeFlags.HORIZONTAL || maximizeFlags === Meta.MaximizeFlags.VERTICAL;

        // Only radius is affected by edge snapping
        // If any maximize flags are set, make all border radius 0
        // Otherwise, only remove radius from corners that are actually touching edges
        // Also check if radius is globally enabled
        const effRadius = (!this.configManager.radiusEnabled || isMaximized) ? {
            tl: 0, tr: 0, br: 0, bl: 0
        } : {
            tl: (edges.top && edges.left) ? 0 : radius.tl,
            tr: (edges.top && edges.right) ? 0 : radius.tr,
            br: (edges.bottom && edges.right) ? 0 : radius.br,
            bl: (edges.bottom && edges.left) ? 0 : radius.bl
        };

        // Position and size calculation
        // Border width always extends outside the window
        // Positive margins: extend border further outside the window 
        // Negative margins: bring border inside the window
        const posX = -margins.left - borderWidths.left;
        const posY = -margins.top - borderWidths.top;
        border.set_position(posX, posY);

        // Border element size: window size + margins + border widths on both sides
        const sizeW = Math.max(1, width + margins.left + margins.right + borderWidths.left + borderWidths.right);
        const sizeH = Math.max(1, height + margins.top + margins.bottom + borderWidths.top + borderWidths.bottom);
        border.set_size(sizeW, sizeH);

        // Style application with caching
        const isActive = metaWindow === global.display.focus_window;
        const borderColor = isActive ? config.activeColor : config.inactiveColor;
        const styleKey = `${borderWidths.top},${borderWidths.right},${borderWidths.bottom},${borderWidths.left}|${effRadius.tl},${effRadius.tr},${effRadius.br},${effRadius.bl}|${borderColor}`;
        
        if (border._lastStyleKey !== styleKey) {
            border._lastStyleKey = styleKey;
            const styleString = 
                `border-top-width: ${borderWidths.top}px;` +
                `border-right-width: ${borderWidths.right}px;` +
                `border-bottom-width: ${borderWidths.bottom}px;` +
                `border-left-width: ${borderWidths.left}px;` +
                `border-radius: ${effRadius.tl}px ${effRadius.tr}px ${effRadius.br}px ${effRadius.bl}px;` +
                `border-style: solid;` +
                `border-color: ${borderColor};` +
                `background: transparent;`;
            border.set_style(styleString);
        }
        border.visible = true;
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
        
        const windowTitle = metaWindow.get_title() || 'untitled';
        console.log(`[p7-borders] Updated config: ${windowTitle} (${metaWindow.get_wm_class() || 'unknown class'}) - Margins: ${JSON.stringify(config.margins)}, Radius: ${JSON.stringify(config.radius)}`);
    }

    _trackWindow(metaWindow) {
        if (!this._isInterestingWindow(metaWindow))
            return;

        if (this._windowData.has(metaWindow))
            return;

        const actor = metaWindow.get_compositor_private();
        if (!actor) {
            // Actor not ready yet - listen for when window is shown (actor will be ready by then)
            if (this._pendingTrack.has(metaWindow))
                return;

            const signalId = metaWindow.connect('shown', () => {
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
            if (this._pendingTrack.has(metaWindow))
                return;

            const signalId = actor.connect('notify::allocation', () => {
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
                id: actor.connect('notify::allocation', () => {
                    const data = this._windowData.get(metaWindow);
                    if (data) this._syncWindow(metaWindow, border, actor, data.config);
                })
            },
            { 
                object: metaWindow, 
                id: metaWindow.connect('unmanaged', () => this._untrackWindow(metaWindow))
            },
            { 
                object: metaWindow, 
                id: metaWindow.connect('notify::fullscreen', () => {
                    if (metaWindow.fullscreen) {
                        this._hideBorder(border);
                    } else {
                        const data = this._windowData.get(metaWindow);
                        if (data) this._syncWindow(metaWindow, border, actor, data.config);
                    }
                })
            },
            { 
                object: metaWindow, 
                id: metaWindow.connect('notify::wm-class', () => this._updateWindowConfig(metaWindow))
            },
            { 
                object: metaWindow, 
                id: metaWindow.connect('notify::gtk-application-id', () => this._updateWindowConfig(metaWindow))
            },
            { 
                object: metaWindow, 
                id: metaWindow.connect('notify::title', () => this._updateWindowConfig(metaWindow))
            },
            { 
                object: metaWindow, 
                id: metaWindow.connect('notify::appears-focused', () => {
                    const data = this._windowData.get(metaWindow);
                    if (data) this._syncWindow(metaWindow, border, actor, data.config);
                })
            }
        ];

        const windowTitle = metaWindow.get_title() || 'untitled';        
        this._windowData.set(metaWindow, {
            border,
            actor,
            signals,
            config,
        });

        console.log(`[p7-borders] Tracking window: ${windowTitle} (${metaWindow.get_wm_class() || 'unknown class'}) - Margins: ${JSON.stringify(config.margins)}, Radius: ${JSON.stringify(config.radius)}`);

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
        for (const {object, id} of signals) {
            try {
                if (object && !object.is_destroyed?.()) {
                    object.disconnect(id);
                }
            } catch {}
        }

        // Remove border from actor with disposal guards
        try {
            if (border && !border.is_destroyed?.() && 
                actor && !actor.is_destroyed?.() && 
                border.get_parent?.() === actor) {
                actor.remove_child(border);
            }
        } catch {}

        this._windowData.delete(metaWindow);
    }
    
    _onConfigChanged(changeType) {
        // For any config change, resync all windows
        this._resyncAll();
    }

    _onFocusChanged() {
        const currentFocus = global.display.focus_window;
        
        // Sync the previously focused window (if any)
        if (this._lastFocusedWindow && this._windowData.has(this._lastFocusedWindow)) {
            const data = this._windowData.get(this._lastFocusedWindow);
            this._syncWindow(this._lastFocusedWindow, data.border, data.actor, data.config);
        }
        
        // Sync the newly focused window (if any)
        if (currentFocus && this._windowData.has(currentFocus)) {
            const data = this._windowData.get(currentFocus);
            this._syncWindow(currentFocus, data.border, data.actor, data.config);
        }
        
        // Update last focused window
        this._lastFocusedWindow = currentFocus;
    }
    _onWindowCreated(metaWindow) {
        this._trackWindow(metaWindow);
    }

    // --- Extension lifecycle -------------------------------------------------

    enable() {
        console.log('[p7-borders] Extension enabled');
        const display = global.display;

        this._signals = [
            {
                object: display,
                id: display.connect('window-created', (display, metaWindow) => this._onWindowCreated(metaWindow))
            },
            {
                object: display,
                id: display.connect('workareas-changed', () => this._resyncAll())
            },
            {
                object: Main.layoutManager,
                id: Main.layoutManager.connect('monitors-changed', () => this._resyncAll())
            },
            {
                object: display,
                id: display.connect('notify::focus-window', () => this._onFocusChanged())
            }
        ];

        // Attach to existing windows
        for (const actor of global.get_window_actors()) {
            if (!actor) continue;
            const win = actor.meta_window;
            if (win)
                this._trackWindow(win);
        }
    }

    disable() {
        console.log('[p7-borders] Extension disabled');
        
        // Remove config change listener
        if (this._configChangeCallback) {
            this.configManager.removeConfigChangeListener(this._configChangeCallback);
        }
        
        // Clean up config manager
        this.configManager.destroy();
        // Disconnect all extension signals
        for (const {object, id} of this._signals) {
            object.disconnect(id);
        }
        this._signals = [];

        // Cancel all pending syncs
        for (const [win, syncId] of this._pendingSyncs.entries()) {
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

        for (const [win] of this._windowData.entries())
            this._untrackWindow(win);
    }
}
