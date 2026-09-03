import Gio from "gi://Gio";

import {
  ConfigManager,
  ensureSchemaVersion,
  getSettingsRules,
  readSettingsAppConfigs,
  SCHEMA_VERSION,
  setSettingsRules,
} from "../common/config.js";

// GNOME Shell adds connectObject()/disconnectObject() to GObject signals.
// Standalone GJS does not load that Shell helper, so mirror its ownership
// behavior for ConfigManager integration tests.
if (!Gio.Settings.prototype.connectObject) {
  const ownedConnections = new WeakMap();
  Gio.Settings.prototype.connectObject = function (...args) {
    const owner = args.pop();
    const ids = ownedConnections.get(this) ?? new Map();
    const ownerIds = ids.get(owner) ?? [];
    for (let index = 0; index < args.length; index += 2) {
      ownerIds.push(this.connect(args[index], args[index + 1]));
    }
    ids.set(owner, ownerIds);
    ownedConnections.set(this, ids);
  };
  Gio.Settings.prototype.disconnectObject = function (owner) {
    const ids = ownedConnections.get(this);
    for (const id of ids?.get(owner) ?? []) this.disconnect(id);
    ids?.delete(owner);
  };
}

const settings = new Gio.Settings({
  schema_id: "org.gnome.shell.extensions.p7-borders",
});
const logger = { log() {}, warn() {} };
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

test("settings schema version is persisted without downgrades", () => {
  assertEquals(settings.get_int("schema-version"), SCHEMA_VERSION);
  ensureSchemaVersion(settings);
  assertEquals(settings.get_int("schema-version"), SCHEMA_VERSION);
  assertEquals(
    settings.get_user_value("schema-version")?.get_int32(),
    SCHEMA_VERSION,
  );

  settings.set_int("schema-version", SCHEMA_VERSION - 1);
  ensureSchemaVersion(settings);
  assertEquals(settings.get_int("schema-version"), SCHEMA_VERSION);

  settings.set_int("schema-version", SCHEMA_VERSION + 1);
  ensureSchemaVersion(settings);
  assertEquals(settings.get_int("schema-version"), SCHEMA_VERSION + 1);
});

test("empty rules reset their user value", () => {
  setSettingsRules(settings, { "class:custom": {} });
  setSettingsRules(settings, {});
  assertEquals(settings.get_user_value("rules"), null);
});

test("shipped configs can be excluded without changing user rules", () => {
  const rules = {
    "@mine": { width: 8 },
    "class:mine": "@mine",
    "class:firefox": null,
  };
  setSettingsRules(settings, rules);
  settings.set_boolean("use-shipped-configs", false);

  const standalone = readSettingsAppConfigs(settings);
  assertEquals(standalone.rules, rules);
  assertEquals(standalone.configs, {
    "@mine": { width: 8 },
    "class:mine": "@mine",
  });

  settings.set_boolean("use-shipped-configs", true);
  const layered = readSettingsAppConfigs(settings);
  assertEquals(layered.rules, rules);
  assertEquals(layered.configs["class:mine"], "@mine");
  assertEquals(layered.configs["class:firefox"], undefined);
  assertEquals(layered.configs["class:thunderbird"], "@gtk");
});

test("ConfigManager uses only standalone rules when shipped configs are off", () => {
  settings.set_boolean("use-shipped-configs", false);
  settings.set_int("default-width", 4);
  setSettingsRules(settings, { "class:mine": { width: 9 } });

  withManager((manager) => {
    assertEquals(
      manager.getConfigForWindow(metaWindow({ wmClass: "mine" })).width,
      9,
    );
    assertEquals(
      manager.getConfigForWindow(metaWindow({ wmClass: "firefox" })).width,
      4,
    );
  });
});

test("invalid standalone rules fall back to an empty config", () => {
  settings.set_boolean("use-shipped-configs", false);
  setSettingsRules(settings, { "class:broken": "@gtk" });
  assertEquals(readSettingsAppConfigs(settings).configs, {});
});

function withManager(callback, managerLogger = logger) {
  const manager = new ConfigManager(settings, managerLogger);
  try {
    callback(manager);
  } finally {
    manager.destroy();
  }
}

function metaWindow({ appId = "", wmClass = "" } = {}) {
  return {
    get_gtk_application_id: () => appId,
    get_wm_class: () => wmClass,
  };
}

test("ConfigManager normalizes scalar defaults and global settings", () => {
  settings.set_boolean("default-enabled", true);
  settings.set_boolean("modal-enabled", false);
  settings.set_boolean("verbose-logging", true);
  settings.set_int("default-margins", -2);
  settings.set_int("default-radius", 9);
  settings.set_int("default-width", 5);
  settings.set_string("default-active-color", "active");
  settings.set_string("default-inactive-color", "inactive");

  withManager((manager) => {
    assertEquals(manager.globalConfig, {
      radiusEnabled: true,
      modalEnabled: false,
      verboseLogging: true,
    });
    assertEquals(manager.defaults.margins, {
      top: -2,
      right: -2,
      bottom: -2,
      left: -2,
    });
    assertEquals(manager.defaults.radius, { tl: 9, tr: 9, br: 9, bl: 9 });
    assertEquals(manager.defaults.width, 5);
    assertEquals(manager.defaults.activeColor, "active");
    assertEquals(manager.defaults.inactiveColor, "inactive");
  });
});

test("radius-disabled applies to defaults and per-app configs", () => {
  settings.set_boolean("radius-enabled", false);
  settings.set_int("default-radius", 9);

  withManager((manager) => {
    const zeroRadius = { tl: 0, tr: 0, br: 0, bl: 0 };
    assertEquals(manager.defaults.radius, zeroRadius);
    assertEquals(
      manager.getConfigForWindow(metaWindow({ wmClass: "firefox" })).radius,
      zeroRadius,
    );
  });
});

test("exact app ID wins over exact WM_CLASS regardless of case", () => {
  setSettingsRules(settings, {
    "app:org.example.App": { width: 8 },
    "class:Example": { width: 6 },
  });

  withManager((manager) => {
    assertEquals(
      manager.getConfigForWindow(
        metaWindow({ appId: "ORG.EXAMPLE.APP", wmClass: "EXAMPLE" }),
      ).width,
      8,
    );
    assertEquals(
      manager.getConfigForWindow(metaWindow({ wmClass: "EXAMPLE" })).width,
      6,
    );
  });
});

test("user regexes run before broader shipped regexes", () => {
  setSettingsRules(settings, {
    "regex.class:^org\\.gnome\\.Console$": { width: 12 },
  });

  withManager((manager) => {
    const matcher = manager._regexConfigs[0].matcher;
    assertEquals(
      manager.getConfigForWindow(
        metaWindow({ wmClass: "org.gnome.Console" }),
      ).width,
      12,
    );
    assertEquals(manager._regexConfigs[0].matcher === matcher, true);
  });
});

test("modified shipped regexes do not outrank custom regexes", () => {
  setSettingsRules(settings, {
    "regex.class:^org.gnome.*": { width: 6 },
    "regex.class:^org\\.gnome\\.Console$": { width: 12 },
  });

  withManager((manager) => {
    assertEquals(
      manager.getConfigForWindow(
        metaWindow({ wmClass: "org.gnome.Console" }),
      ).width,
      12,
    );
  });
});

test("invalid regexes are ignored and unmatched windows use defaults", () => {
  setSettingsRules(settings, {
    "regex.class:[": { width: 12 },
  });
  settings.set_int("default-width", 4);

  withManager((manager) => {
    assertEquals(
      manager.getConfigForWindow(metaWindow({ wmClass: "anything" })),
      manager.defaults,
    );
    assertEquals(manager.defaults.width, 4);
  });
});

test("invalid field types are ignored before geometry is computed", () => {
  const warnings = [];
  setSettingsRules(settings, {
    "class:broken": { width: "wide", margins: { left: "far" } },
    "class:valid": { width: 9 },
  });
  settings.set_int("default-width", 4);

  withManager((manager) => {
    assertEquals(
      manager.getConfigForWindow(metaWindow({ wmClass: "broken" })),
      manager.defaults,
    );
    assertEquals(
      manager.getConfigForWindow(metaWindow({ wmClass: "valid" })).width,
      9,
    );
    assertEquals(manager.defaults.width, 4);
  }, {
    log() {},
    warn(message) {
      warnings.push(message);
    },
  });
  assertEquals(warnings, [
    "Ignoring invalid rule: " +
    "class:broken.width must be a non-negative integer",
  ]);
});

test("preferences and runtime retain valid rules beside invalid ones", () => {
  setSettingsRules(settings, {
    "class:broken": { width: "wide" },
    "class:valid": { width: 8 },
  });

  const { configs, rules } = readSettingsAppConfigs(settings);
  assertEquals(rules, { "class:valid": { width: 8 } });
  assertEquals(configs["class:broken"], undefined);
  assertEquals(configs["class:valid"], { width: 8 });
  assertEquals(configs["class:firefox"], "@gtk");
  assertEquals(getSettingsRules(settings), {
    "class:broken": { width: "wide" },
    "class:valid": { width: 8 },
  });
});

test("preset tombstones and custom nulls produce valid effective configs", () => {
  setSettingsRules(settings, {
    "@gtk": null,
    "class:custom": { width: null, radius: { tl: 7, tr: null } },
  });

  const { configs, rules } = readSettingsAppConfigs(settings);
  assertEquals(rules, {
    "@gtk": null,
    "class:custom": { width: null, radius: { tl: 7, tr: null } },
  });
  assertEquals(configs["@gtk"], undefined);
  assertEquals(configs["class:firefox"], undefined);
  assertEquals(configs["class:custom"], { radius: { tl: 7 } });
});

test("unsafe color declarations cannot reach border styles", () => {
  settings.set_string("default-active-color", "red; background: white");
  settings.set_string("default-inactive-color", "blue\nbackground: white");
  setSettingsRules(settings, {
    "class:broken": { activeColor: "red; background: white" },
    "class:valid": { activeColor: "orange" },
  });

  withManager((manager) => {
    assertEquals(manager.defaults.activeColor, "rgba(51, 153, 230, 0.4)");
    assertEquals(manager.defaults.inactiveColor, "rgba(102, 102, 102, 0.2)");
    assertEquals(
      manager.getConfigForWindow(metaWindow({ wmClass: "valid" })).activeColor,
      "orange",
    );
    assertEquals(
      manager.getConfigForWindow(metaWindow({ wmClass: "broken" })),
      manager.defaults,
    );
  });
});

test("preset rules reach every app that references the preset", () => {
  setSettingsRules(settings, {
    "@gtk": { width: 7, radius: { tl: 21 } },
  });

  withManager((manager) => {
    const firefox = manager.getConfigForWindow(
      metaWindow({ wmClass: "firefox" }),
    );
    const thunderbird = manager.getConfigForWindow(
      metaWindow({ wmClass: "thunderbird" }),
    );
    assertEquals(firefox.width, 7);
    assertEquals(thunderbird.width, 7);
    assertEquals(firefox.radius, { tl: 21, tr: 10, br: 0, bl: 0 });
  });
});

test("window methods are optional and fall back to global defaults", () => {
  withManager((manager) => {
    assertEquals(manager.getConfigForWindow({}), manager.defaults);
  });
});

test("accent compatibility uses the Shell accent color when available", () => {
  const getColor = ConfigManager.prototype._getDefaultActiveOrAccentColor;
  const receiver = (hasAccent) => ({
    _settings: { get_string: () => "auto" },
    _interfaceSettings: {
      settings_schema: { has_key: () => hasAccent },
    },
  });

  assertEquals(
    getColor.call(receiver(false)),
    "rgba(51, 153, 230, 0.4)",
  );
  assertEquals(
    getColor.call(receiver(true)),
    "-st-accent-color",
  );
});

test("settings changes reload config and notify listeners", () => {
  withManager((manager) => {
    const changes = [];
    manager.addConfigChangeListener((change) => changes.push(change));
    settings.set_int("default-width", 10);
    assertEquals(manager.defaults.width, 10);
    assertEquals(changes, ["default-width"]);
  });
});

test("unknown preset references do not discard valid rules", () => {
  const warnings = [];
  setSettingsRules(settings, {
    "class:broken": "@missing",
    "class:valid": { width: 11 },
  });

  withManager((manager) => {
    assertEquals(
      manager.getConfigForWindow(metaWindow({ wmClass: "broken" })),
      manager.defaults,
    );
    assertEquals(
      manager.getConfigForWindow(metaWindow({ wmClass: "valid" })).width,
      11,
    );
  }, {
    log() {},
    warn(message) {
      warnings.push(message);
    },
  });
  assertEquals(warnings, [
    "Ignoring invalid rule: " +
    "Unknown preset reference @missing in class:broken",
  ]);
});

print(`${passed} GSettings tests passed`);
