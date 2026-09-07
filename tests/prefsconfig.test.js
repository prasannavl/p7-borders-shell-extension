import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { MAX_CONFIG_ENTRIES, MAX_REGEX_CONFIGS } from "../common/appconfig.js";
import { getSettingsRules } from "../common/config.js";
import { PreferencesConfigStore } from "../prefs/config.js";
import { assertEquals } from "./assert.js";

const settings = new Gio.Settings({
  schema_id: "org.gnome.shell.extensions.p7-borders",
});
let passed = 0;

function resetSettings() {
  for (const key of settings.settings_schema.list_keys()) settings.reset(key);
}

function drainTimers() {
  GLib.usleep(5_000);
  const context = GLib.MainContext.default();
  while (context.pending()) context.iteration(false);
}

function overrideSettings(overrides) {
  return new Proxy(settings, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return overrides[property];
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
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
  const store = new PreferencesConfigStore(settings, { saveDelayMs: 1 });
  const changes = [];
  store.subscribe(({ source }) => changes.push(source));

  const originalConfigs = store.configs;
  store.updateConfigs(
    (configs) => {
      configs["class:custom"] = { width: 7 };
    },
    "apps",
    true,
  );
  store.updateConfigs(
    (configs) => {
      configs["@custom"] = { radius: 11 };
    },
    "presets",
    true,
  );
  assertEquals(originalConfigs["class:custom"], undefined);
  assertEquals(store.rules, {
    "class:custom": { width: 7 },
    "@custom": { radius: 11 },
  });
  drainTimers();

  assertEquals(getSettingsRules(settings), {
    "class:custom": { width: 7 },
    "@custom": { radius: 11 },
  });
  assertEquals(changes, ["presets"]);
  store.destroy();
});

test("destroy flushes pending edits without notifying closing UI", () => {
  const store = new PreferencesConfigStore(settings, { saveDelayMs: 1 });
  let notifications = 0;
  store.subscribe(() => notifications++);
  store.updateConfigs(
    (configs) => {
      configs["class:pending"] = { width: 7 };
    },
    "apps",
    true,
  );

  store.destroy();

  assertEquals(notifications, 0);
  assertEquals(getSettingsRules(settings), {
    "class:pending": { width: 7 },
  });
});

test("explicit raw rules replace a pending visual edit", () => {
  const store = new PreferencesConfigStore(settings, { saveDelayMs: 1 });
  store.updateConfigs(
    (configs) => {
      configs["class:pending"] = { width: 7 };
    },
    "apps",
    true,
  );
  store.replaceRules({ "class:raw": { width: 9 } }, "raw");
  drainTimers();

  assertEquals(getSettingsRules(settings), {
    "class:raw": { width: 9 },
  });
  assertEquals(store.configs["class:pending"], undefined);
  assertEquals(store.configs["class:raw"], { width: 9 });
  store.destroy();
});

test("external rules replace a pending visual edit", () => {
  const store = new PreferencesConfigStore(settings, { saveDelayMs: 1 });
  store.updateConfigs(
    (configs) => {
      configs["class:pending"] = { width: 7 };
    },
    "apps",
    true,
  );
  settings.set_string(
    "rules",
    JSON.stringify({
      "class:external": { width: 11 },
    }),
  );
  drainTimers();

  assertEquals(store.configs["class:pending"], undefined);
  assertEquals(store.configs["class:external"], { width: 11 });
  store.destroy();
});

test("case variants of shipped keys survive a preferences save", () => {
  const store = new PreferencesConfigStore(settings, { saveDelayMs: 1 });
  store.updateConfigs((configs) => {
    configs["class:Firefox"] = configs["class:firefox"];
    delete configs["class:firefox"];
  });

  assertEquals(store.rules, {});
  assertEquals(store.configs["class:firefox"], "@gtk");
  assertEquals(store.configs["class:Firefox"], undefined);
  store.destroy();
});

test("re-adding a suppressed shipped key resolves its canonical identity", () => {
  const store = new PreferencesConfigStore(settings, { saveDelayMs: 1 });
  store.updateConfigs((configs) => {
    delete configs["class:firefox"];
  });
  store.updateConfigs((configs) => {
    configs["class:FIREFOX"] = store.getBaseConfig("class:FIREFOX");
  });

  assertEquals(store.rules, {});
  assertEquals(store.configs["class:FIREFOX"], undefined);
  assertEquals(store.configs["class:firefox"], "@gtk");
  store.destroy();
});

test("case-variant raw overrides remain canonical across visual saves", () => {
  const store = new PreferencesConfigStore(settings, { saveDelayMs: 1 });
  store.replaceRules({ "class:Firefox": { width: 7 } }, "raw");

  assertEquals(store.configs["class:Firefox"], undefined);
  assertEquals(store.configs["class:firefox"].width, 7);
  store.updateConfigs((configs) => {
    configs["class:custom"] = { width: 9 };
  });

  assertEquals(getSettingsRules(settings), {
    "class:firefox": { width: 7 },
    "class:custom": { width: 9 },
  });
  assertEquals(store.configs["class:firefox"].width, 7);
  store.destroy();
});

test("raw regex tombstones do not consume the effective budget", () => {
  const store = new PreferencesConfigStore(settings, { saveDelayMs: 1 });
  const shippedRegexes = Object.keys(store.baseConfigs).filter((key) =>
    key.startsWith("regex.")
  );
  const rules = Object.fromEntries([
    ...shippedRegexes.map((key) => [key, null]),
    ...Array.from({ length: MAX_REGEX_CONFIGS }, (_, index) => [
      `regex.class:^custom-${index}$`,
      {},
    ]),
  ]);

  store.replaceRules(rules);

  assertEquals(store.rules, rules);
  assertEquals(
    Object.keys(store.configs).filter((key) => key.startsWith("regex.")).length,
    MAX_REGEX_CONFIGS,
  );
  store.destroy();
});

test("shipped config mode changes keep the same user rules", () => {
  const store = new PreferencesConfigStore(settings, { saveDelayMs: 1 });
  const rules = { "class:custom": { width: 9 } };
  store.replaceRules(rules, "raw");
  store.setUseShippedConfigs(false, "global");

  assertEquals(store.useShippedConfigs, false);
  assertEquals(store.rules, rules);
  assertEquals(store.configs, rules);
  assertEquals(getSettingsRules(settings), rules);
  store.destroy();
});

test("visual edits preserve rules hidden while shipped configs are off", () => {
  const store = new PreferencesConfigStore(settings, { saveDelayMs: 1 });
  const rules = {
    "class:firefox": null,
    "regex.class:^dormant$": "@gtk",
    "regex.class:^active$": { width: 8 },
    "class:dormant": "@gtk",
    "class:custom": { width: 9 },
  };
  store.replaceRules(rules, "raw");
  store.setUseShippedConfigs(false, "global");
  store.updateConfigs((configs) => {
    configs["class:added"] = { radius: 7 };
  });

  assertEquals(getSettingsRules(settings), {
    ...rules,
    "class:added": { radius: 7 },
  });
  store.setUseShippedConfigs(true, "global");
  assertEquals(store.configs["class:firefox"], undefined);
  assertEquals(store.configs["regex.class:^dormant$"], "@gtk");
  assertEquals(store.configs["class:dormant"], "@gtk");
  store.destroy();
});

test("full config replacement derives rules from the current base", () => {
  const store = new PreferencesConfigStore(settings, { saveDelayMs: 1 });
  const configs = { "class:custom": { width: 9 } };
  const previewRules = store.getRulesForConfigs(configs);
  assertEquals(Object.values(previewRules).includes(null), true);

  store.setUseShippedConfigs(false);
  const rules = store.replaceConfigs(configs, "import");

  assertEquals(rules, configs);
  assertEquals(store.rules, configs);
  assertEquals(store.configs, configs);
  assertEquals(getSettingsRules(settings), configs);
  store.destroy();
});

test("visual updates reject invalid complete rules transactionally", () => {
  const store = new PreferencesConfigStore(settings, { saveDelayMs: 1 });
  let error = null;
  try {
    store.updateConfigs((configs) => {
      configs["class:custom"] = { activeColor: "red; width: 20px" };
    });
  } catch (caught) {
    error = caught;
  }

  assertEquals(
    error?.message,
    "class:custom.activeColor must be a single CSS color value",
  );
  assertEquals(store.configs["class:custom"], undefined);
  assertEquals(getSettingsRules(settings), {});
  store.destroy();
});

test("visual updates reject non-writable settings before mutation", () => {
  const store = new PreferencesConfigStore(
    overrideSettings({
      is_writable: () => false,
    }),
    { saveDelayMs: 1 },
  );
  let error = null;
  try {
    store.updateConfigs(
      (configs) => {
        configs["class:custom"] = { width: 7 };
      },
      null,
      true,
    );
  } catch (caught) {
    error = caught;
  }

  assertEquals(error?.message, "Setting is not writable: rules");
  assertEquals(store.configs["class:custom"], undefined);
  assertEquals(getSettingsRules(settings), {});
  store.destroy();
});

test("rejected backend writes roll back optimistic state", () => {
  const store = new PreferencesConfigStore(
    overrideSettings({
      set_string: () => false,
    }),
    { saveDelayMs: 1 },
  );
  const changes = [];
  store.subscribe(({ source }) => changes.push(source));
  let error = null;
  try {
    store.updateConfigs((configs) => {
      configs["class:custom"] = { width: 7 };
    }, "apps");
  } catch (caught) {
    error = caught;
  }

  assertEquals(error?.message, "Failed to write setting: rules");
  assertEquals(store.configs["class:custom"], undefined);
  assertEquals(getSettingsRules(settings), {});
  assertEquals(changes, [null]);
  store.destroy();
});

test("rejected debounced writes report errors and roll back", () => {
  const errors = [];
  const store = new PreferencesConfigStore(
    overrideSettings({
      set_string: () => false,
    }),
    {
      saveDelayMs: 1,
      onError: (error) => errors.push(error.message),
    },
  );
  store.updateConfigs(
    (configs) => {
      configs["class:custom"] = { width: 7 };
    },
    "apps",
    true,
  );
  assertEquals(store.configs["class:custom"], { width: 7 });

  drainTimers();

  assertEquals(errors, ["Failed to write setting: rules"]);
  assertEquals(store.configs["class:custom"], undefined);
  assertEquals(getSettingsRules(settings), {});
  store.destroy();
});

test("visual updates enforce the effective regex budget", () => {
  const store = new PreferencesConfigStore(settings, { saveDelayMs: 1 });
  const shippedRegexes =
    Object.keys(store.baseConfigs).filter((key) => key.startsWith("regex."))
      .length;
  let error = null;
  try {
    store.updateConfigs((configs) => {
      for (
        let index = 0;
        index <= MAX_REGEX_CONFIGS - shippedRegexes;
        index++
      ) configs[`regex.class:^custom-${index}$`] = {};
    });
  } catch (caught) {
    error = caught;
  }

  assertEquals(
    error?.message,
    `Effective config must contain at most ${MAX_REGEX_CONFIGS} regexes`,
  );
  assertEquals(getSettingsRules(settings), {});
  store.destroy();
});

test("full-config rules are validated after derivation", () => {
  const store = new PreferencesConfigStore(settings, { saveDelayMs: 1 });
  const configs = Object.fromEntries(
    Array.from({ length: MAX_CONFIG_ENTRIES }, (_, index) => [
      `class:custom-${index}`,
      {},
    ]),
  );
  let error = null;
  try {
    store.replaceConfigs(configs);
  } catch (caught) {
    error = caught;
  }

  assertEquals(
    error?.message,
    `Config must contain at most ${MAX_CONFIG_ENTRIES} entries`,
  );
  assertEquals(getSettingsRules(settings), {});
  store.destroy();
});

print(`${passed} preferences config store tests passed`);
