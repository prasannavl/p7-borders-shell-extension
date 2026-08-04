// windowmenu.js
// ponytail: monkeypatches the shell's window menu (right-click titlebar /
// Alt+Space) with a colour submenu, so a window can be recoloured in place.
// Scoped to the single window; app-wide colours belong to prefs.

import Clutter from "gi://Clutter";
import St from "gi://St";

import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as WindowMenu from "resource:///org/gnome/shell/ui/windowMenu.js";

const COLORS = [
  { name: "Red", value: "#ef4444" },
  { name: "Orange", value: "#f97316" },
  { name: "Yellow", value: "#eab308" },
  { name: "Green", value: "#22c55e" },
  { name: "Teal", value: "#14b8a6" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Purple", value: "#a855f7" },
  { name: "Pink", value: "#ec4899" },
  { name: "Grey", value: "#94a3b8" },
];

function createSwatch(color) {
  return new St.Widget({
    style: `background-color: ${color}; border-radius: 4px;` +
      " width: 14px; height: 14px; margin-right: 8px;",
    y_align: Clutter.ActorAlign.CENTER,
  });
}

export class WindowMenuIntegration {
  constructor(borderManager, logger) {
    this._borderManager = borderManager;
    this._logger = logger;
    this._originalShow = null;
  }

  // WindowMenu is a plain ES class (no GObject _init to patch), and
  // WindowMenuManager builds it via a module-local binding, so replacing the
  // export would not help either. The manager method is the usable seam:
  // wrap it, and intercept the menu as it is handed to the popup manager.
  enable() {
    const proto = WindowMenu.WindowMenuManager.prototype;
    this._originalShow = proto.showWindowMenuForWindow;

    // Bail loudly rather than silently patching a method that is not there.
    if (typeof this._originalShow !== "function") {
      this._originalShow = null;
      this._logger.warn?.("showWindowMenuForWindow missing, menu not patched");
      return;
    }

    const originalShow = this._originalShow;
    const self = this;
    proto.showWindowMenuForWindow = function (metaWindow, type, rect) {
      const popupManager = this._manager;
      const originalAddMenu = popupManager.addMenu;

      popupManager.addMenu = function (menu, ...rest) {
        originalAddMenu.call(this, menu, ...rest);
        try {
          self._appendColorSection(menu, metaWindow);
        } catch (err) {
          self._logger.warn?.(`colour section failed: ${err}`);
        }
      };

      try {
        originalShow.call(this, metaWindow, type, rect);
      } finally {
        popupManager.addMenu = originalAddMenu;
      }
    };
  }

  disable() {
    if (this._originalShow) {
      WindowMenu.WindowMenuManager.prototype.showWindowMenuForWindow =
        this._originalShow;
      this._originalShow = null;
    }
  }

  // One entry in the window menu, scoped to this window only. App-wide
  // colours live in the extension preferences instead.
  _appendColorSection(menu, metaWindow) {
    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    const root = new PopupMenu.PopupSubMenuMenuItem("Window colour", false);
    menu.addMenuItem(root);
    const sub = root.menu;

    sub.addMenuItem(new PopupMenu.PopupSeparatorMenuItem("This window"));
    this._addColorItems(
      sub,
      (color) => this._setWindowColor(metaWindow, color),
    );

    const resetItem = new PopupMenu.PopupMenuItem("Use app colour");
    resetItem.connect(
      "activate",
      () => this._borderManager.setWindowOverride(metaWindow, null),
    );
    sub.addMenuItem(resetItem);

    sub.addMenuItem(new PopupMenu.PopupSeparatorMenuItem("Title bar"));

    const current = this._borderManager.getWindowOverride(metaWindow);
    const tintItem = new PopupMenu.PopupSwitchMenuItem(
      "Tint title bar",
      !!current?.titleTint,
    );
    tintItem.connect("toggled", (_item, state) => {
      const override = this._borderManager.getWindowOverride(metaWindow) || {};
      this._borderManager.setWindowOverride(metaWindow, {
        ...override,
        enabled: true,
        titleTint: state,
      });
    });
    sub.addMenuItem(tintItem);
  }

  _addColorItems(targetMenu, onPick) {
    for (const color of COLORS) {
      const item = new PopupMenu.PopupMenuItem(color.name);
      item.insert_child_at_index(createSwatch(color.value), 0);
      item.connect("activate", () => onPick(color.value));
      targetMenu.addMenuItem(item);
    }

    const offItem = new PopupMenu.PopupMenuItem("No border");
    offItem.connect("activate", () => onPick(null));
    targetMenu.addMenuItem(offItem);
  }

  _setWindowColor(metaWindow, color) {
    const override = color === null
      ? { enabled: false }
      : { enabled: true, activeColor: color, inactiveColor: color };
    this._borderManager.setWindowOverride(metaWindow, override);
  }
}
