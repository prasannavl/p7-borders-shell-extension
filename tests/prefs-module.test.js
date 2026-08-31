import Gio from "gi://Gio";
import GLib from "gi://GLib";

const resourcePath = GLib.getenv("GNOME_SHELL_EXTENSIONS_RESOURCE");
if (!resourcePath) throw new Error("GNOME Shell extensions resource not set");

const resource = Gio.Resource.load(resourcePath);
resource._register();

await import("../prefs.js");
print("preferences module loaded");
