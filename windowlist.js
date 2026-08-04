// windowlist.js
// ponytail: exposes open windows over D-Bus so prefs can offer a picker
// instead of making the user type WM_CLASS by hand. Read-only, no state.

import Gio from "gi://Gio";
import Meta from "gi://Meta";

const BUS_NAME = "org.gnome.Shell.Extensions.P7Borders";
const OBJECT_PATH = "/org/gnome/shell/extensions/p7borders";

const IFACE = `
<node>
  <interface name="org.gnome.Shell.Extensions.P7Borders">
    <method name="ListWindows">
      <arg type="s" direction="out" name="json"/>
    </method>
  </interface>
</node>`;

export class WindowListService {
  constructor(logger) {
    this._logger = logger;
    this._impl = null;
    this._ownerId = 0;
  }

  enable() {
    this._impl = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
    this._impl.export(Gio.DBus.session, OBJECT_PATH);
    this._ownerId = Gio.bus_own_name(
      Gio.BusType.SESSION,
      BUS_NAME,
      Gio.BusNameOwnerFlags.REPLACE,
      null,
      null,
      null,
    );
  }

  disable() {
    if (this._ownerId) {
      Gio.bus_unown_name(this._ownerId);
      this._ownerId = 0;
    }
    if (this._impl) {
      this._impl.unexport();
      this._impl = null;
    }
  }

  ListWindows() {
    const seen = new Set();
    const windows = [];

    for (const w of global.display.list_all_windows()) {
      if (w.get_window_type() !== Meta.WindowType.NORMAL) continue;

      const wmClass = w.get_wm_class() || "";
      const appId = w.get_gtk_application_id?.() || "";
      if (!wmClass && !appId) continue;

      // One entry per app, not per window — configs are keyed by app.
      const dedupeKey = `${wmClass} ${appId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      windows.push({ wmClass, appId, title: w.get_title() || "" });
    }

    windows.sort((a, b) =>
      (a.wmClass || a.appId).localeCompare(b.wmClass || b.appId)
    );
    return JSON.stringify(windows);
  }
}
