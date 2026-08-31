import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { getSettingsRules } from "../config.js";
import { PreferencesConfigStore } from "../prefsconfig.js";

const settings = new Gio.Settings({
  schema_id: "org.gnome.shell.extensions.p7-borders",
});
let passed = 0;

function assertEquals(actual, expected) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, got ${actualJson}`);
  }
}

function resetSettings() {
  for (const key of settings.settings_schema.list_keys()) settings.reset(key);
}

function drainTimers() {
  GLib.usleep(5_000);
  const context = GLib.MainContext.default();
  while (context.pending()) context.iteration(false);
}

function test(name, callback) {
  resetSettings();
  try {
    callback();
    passed++;
    print(`ok - ${name}`);
  } finally {
    resetSettings();
  }
}

test("one debounced save retains edits from every preferences page", () => {
  const store = new PreferencesConfigStore(settings, 1);
  const changes = [];
  store.subscribe(({ source }) => changes.push(source));

  store.configs["class:custom"] = { width: 7 };
  store.scheduleSave("apps");
  store.configs["@custom"] = { radius: 11 };
  store.scheduleSave("presets");
  drainTimers();

  assertEquals(getSettingsRules(settings), {
    "class:custom": { width: 7 },
    "@custom": { radius: 11 },
  });
  assertEquals(changes, ["presets"]);
  store.destroy();
});

test("explicit raw rules replace a pending visual edit", () => {
  const store = new PreferencesConfigStore(settings, 1);
  store.configs["class:pending"] = { width: 7 };
  store.scheduleSave("apps");
  store.replaceRules({ "class:raw": { width: 9 } }, "raw");
  drainTimers();

  assertEquals(getSettingsRules(settings), {
    "class:raw": { width: 9 },
  });
  assertEquals(store.configs["class:pending"], undefined);
  assertEquals(store.configs["class:raw"], { width: 9 });
  store.destroy();
});

test("shipped config mode changes keep the same user rules", () => {
  const store = new PreferencesConfigStore(settings, 1);
  const rules = { "class:custom": { width: 9 } };
  store.replaceRules(rules, "raw");
  store.setUseShippedConfigs(false, "global");

  assertEquals(store.useShippedConfigs, false);
  assertEquals(store.rules, rules);
  assertEquals(store.configs, rules);
  assertEquals(getSettingsRules(settings), rules);
  store.destroy();
});

print(`${passed} preferences config store tests passed`);
