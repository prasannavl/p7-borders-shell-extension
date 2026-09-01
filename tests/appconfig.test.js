import {
  BASE_APP_CONFIGS,
  buildEffectiveAppConfigs,
  canonicalizeConfigKey,
  copyConfig,
  deriveAppConfigRules,
  findEquivalentConfigKey,
  getConfigMapError,
  getOrderedRegexConfigs,
  getRulesError,
  normalizeMargins,
  normalizeRadius,
  normalizeWidth,
  parseConfigJson,
  resolveConfigValue,
} from "../appconfig.js";

function assertEquals(actual, expected) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, got ${actualJson}`);
  }
}

Deno.test("base entries remain references without rules", () => {
  const base = {
    "@preset": { radius: { tl: 10, tr: 10 } },
    "class:app": "@preset",
  };
  assertEquals(buildEffectiveAppConfigs({}, base), base);
});

Deno.test("preset rules flow into shipped app references", () => {
  const base = {
    "@preset": { radius: { tl: 10, tr: 10 } },
    "class:app": "@preset",
  };
  const effective = buildEffectiveAppConfigs({
    "@preset": { radius: { tl: 14 } },
  }, base);

  assertEquals(effective["@preset"], { radius: { tl: 14, tr: 10 } });
  assertEquals(
    resolveConfigValue(effective["class:app"], effective),
    effective["@preset"],
  );
});

Deno.test("app objects overlay resolved shipped presets", () => {
  const base = {
    "@preset": { radius: { tl: 10, tr: 10 } },
    "class:app": "@preset",
  };
  const effective = buildEffectiveAppConfigs({
    "class:app": { width: 4, radius: { tr: 12 } },
  }, base);

  assertEquals(effective["class:app"], {
    radius: { tl: 10, tr: 12 },
    width: 4,
  });
});

Deno.test("null suppresses shipped entries", () => {
  const base = { "class:one": {}, "class:two": {} };
  assertEquals(buildEffectiveAppConfigs({ "class:one": null }, base), {
    "class:two": {},
  });
});

Deno.test("nested null removes only the selected inherited field", () => {
  const base = {
    "@preset": {
      width: 3,
      radius: { tl: 10, tr: 10, br: 4, bl: 4 },
    },
  };
  assertEquals(
    buildEffectiveAppConfigs({
      "@preset": { radius: { br: null, bl: 8 } },
    }, base),
    {
      "@preset": {
        width: 3,
        radius: { tl: 10, tr: 10, bl: 8 },
      },
    },
  );
});

Deno.test("suppressing a preset also suppresses untouched references", () => {
  const base = {
    "@preset": { width: 3 },
    "class:inherited": "@preset",
    "class:overridden": "@preset",
  };
  const rules = {
    "@preset": null,
    "class:overridden": { width: 7 },
  };
  const effective = buildEffectiveAppConfigs(rules, base);
  assertEquals(effective, { "class:overridden": { width: 7 } });
  assertEquals(getConfigMapError(effective), null);
  assertEquals(getRulesError(rules, base), null);
  assertEquals(deriveAppConfigRules(effective, base), rules);
});

Deno.test("nested nulls are removed uniformly from custom entries", () => {
  const effective = buildEffectiveAppConfigs({
    "@custom": { width: null, radius: { tl: 4, tr: null } },
    "class:custom": { width: null, margins: { top: 2, left: null } },
  }, {});
  assertEquals(
    effective,
    {
      "@custom": { radius: { tl: 4 } },
      "class:custom": { margins: { top: 2 } },
    },
  );
  assertEquals(getConfigMapError(effective), null);
});

Deno.test("unknown preset references are omitted from effective configs", () => {
  assertEquals(
    buildEffectiveAppConfigs({
      "class:broken": "@missing",
      "class:valid": { width: 4 },
    }, {}),
    { "class:valid": { width: 4 } },
  );
  assertEquals(
    getRulesError({ "class:broken": "@missing" }, {}),
    "Unknown preset reference @missing in class:broken",
  );
});

Deno.test("derived rules contain only the minimal nested change", () => {
  const base = {
    "@preset": { width: 3, radius: { tl: 10, tr: 10 } },
    "class:app": "@preset",
  };
  const desired = copyConfig(base);
  desired["@preset"].radius.tl = 14;

  assertEquals(deriveAppConfigRules(desired, base), {
    "@preset": { radius: { tl: 14 } },
  });
});

Deno.test("merge and diff do not mutate their inputs", () => {
  const base = {
    "@preset": { radius: { tl: 10, tr: 10 } },
    "class:app": "@preset",
  };
  const rules = { "@preset": { radius: { tl: 14 } } };
  const originalBase = copyConfig(base);
  const originalRules = copyConfig(rules);
  const effective = buildEffectiveAppConfigs(rules, base);
  deriveAppConfigRules(effective, base);

  assertEquals(base, originalBase);
  assertEquals(rules, originalRules);
});

Deno.test("effective config round trips through derived rules", () => {
  const base = {
    "@preset": { radius: { tl: 10, tr: 10 }, width: 2 },
    "class:app": "@preset",
    "class:remove": {},
  };
  const desired = {
    "@preset": { radius: { tl: 14, tr: 10 }, width: 2 },
    "class:app": { radius: { tl: 14, tr: 10 }, width: 5 },
    "class:custom": "@preset",
  };

  const rules = deriveAppConfigRules(desired, base);
  assertEquals(buildEffectiveAppConfigs(rules, base), desired);
  assertEquals(rules["class:remove"], null);
});

Deno.test("an equivalent object remains detached from a shipped preset", () => {
  const base = {
    "@preset": { width: 3, radius: { tl: 10 } },
    "class:app": "@preset",
  };
  const desired = copyConfig(base);
  desired["class:app"] = copyConfig(base["@preset"]);

  const rules = deriveAppConfigRules(desired, base);
  assertEquals(rules, { "class:app": {} });
  assertEquals(buildEffectiveAppConfigs(rules, base), desired);
});

Deno.test("user regular expressions are ordered before shipped patterns", () => {
  const configs = {
    "regex.class:^org.gnome.*": { width: 3 },
    "regex.class:^org.gnome.CustomApp$": { width: 9 },
    "class:exact": { width: 5 },
  };
  const rules = {
    "regex.class:^org.gnome.CustomApp$": { width: 9 },
  };

  assertEquals(getOrderedRegexConfigs(configs, rules), [
    ["regex.class:^org.gnome.CustomApp$", { width: 9 }],
    ["regex.class:^org.gnome.*", { width: 3 }],
  ]);
});

Deno.test("modified shipped regexes stay behind custom regexes", () => {
  const configs = {
    "regex.class:^org.gnome.*": { width: 4 },
    "regex.class:^org.gnome.CustomApp$": { width: 9 },
  };
  const rules = {
    "regex.class:^org.gnome.*": { width: 4 },
    "regex.class:^org.gnome.CustomApp$": { width: 9 },
  };

  assertEquals(getOrderedRegexConfigs(configs, rules), [
    ["regex.class:^org.gnome.CustomApp$", { width: 9 }],
    ["regex.class:^org.gnome.*", { width: 4 }],
  ]);
});

Deno.test("invalid JSON falls back safely", () => {
  assertEquals(parseConfigJson("not json"), {});
  assertEquals(parseConfigJson("[]"), {});
});

Deno.test("config map validation rejects malformed entries", () => {
  assertEquals(getConfigMapError(BASE_APP_CONFIGS), null);
  assertEquals(
    getConfigMapError({ "class:valid": "@preset" }, {
      validateReferences: false,
    }),
    null,
  );
  assertEquals(
    getConfigMapError({ "regex.class:[": {} }),
    "Invalid regular expression: regex.class:[",
  );
  assertEquals(
    getConfigMapError({ "class:invalid": 3 }),
    "App config class:invalid must be an object or preset reference",
  );
  assertEquals(
    getConfigMapError({ "class:foot": null }, { allowTombstones: true }),
    null,
  );
  assertEquals(
    getConfigMapError({ "class:hidden": null }),
    "App config class:hidden must be an object or preset reference",
  );
  assertEquals(
    getConfigMapError({ "class:hidden": null }, { allowTombstones: true }),
    null,
  );
  assertEquals(
    getConfigMapError({ "@invalid": "@preset" }),
    "Preset @invalid must be an object",
  );
  assertEquals(
    getConfigMapError({ "unknown:key": {} }),
    "Invalid config key: unknown:key",
  );
  assertEquals(
    getConfigMapError({ "class:invalid": "@missing" }),
    "Unknown preset reference @missing in class:invalid",
  );
  assertEquals(
    getConfigMapError({ "class:invalid": { width: "wide" } }),
    "class:invalid.width must be a non-negative integer",
  );
  assertEquals(
    getConfigMapError({ "class:invalid": { enabled: "false" } }),
    "class:invalid.enabled must be a boolean",
  );
  assertEquals(
    getConfigMapError({ "class:invalid": { radius: { top: 4 } } }),
    "class:invalid.radius.top is not valid",
  );
  assertEquals(
    getConfigMapError({ "class:invalid": { raduis: 4 } }),
    "class:invalid.raduis is not valid",
  );
  assertEquals(
    getConfigMapError({ "class:invalid": { activeColor: "red; width: 0" } }),
    "class:invalid.activeColor must be a single CSS color value",
  );
  assertEquals(
    getConfigMapError({
      "class:Firefox": {},
      "class:firefox": {},
    }),
    "Duplicate exact-match config keys: class:Firefox and class:firefox",
  );
  assertEquals(
    getConfigMapError(
      { "class:valid": { radius: { tl: null } } },
      { allowTombstones: true },
    ),
    null,
  );
});

Deno.test("exact config keys use the runtime canonical identity", () => {
  const configs = { "class:Firefox": {}, "regex.class:^Foo$": {} };
  assertEquals(
    canonicalizeConfigKey("app:Org.Example.App"),
    "app:org.example.app",
  );
  assertEquals(canonicalizeConfigKey("regex.class:^Foo$"), "regex.class:^Foo$");
  assertEquals(
    findEquivalentConfigKey(configs, "class:firefox"),
    "class:Firefox",
  );
  assertEquals(findEquivalentConfigKey(configs, "class:missing"), undefined);
});

Deno.test("scalar and malformed geometry normalize predictably", () => {
  assertEquals(normalizeWidth("wide"), 0);
  assertEquals(normalizeWidth(3.9), 3);
  assertEquals(normalizeMargins(-2), {
    top: -2,
    right: -2,
    bottom: -2,
    left: -2,
  });
  assertEquals(normalizeMargins({ top: -3, right: 2.9 }), {
    top: -3,
    right: 2,
    bottom: 0,
    left: 0,
  });
  assertEquals(normalizeRadius(9), { tl: 9, tr: 9, br: 9, bl: 9 });
  assertEquals(normalizeRadius({ tl: -3, tr: 2.9, bl: 4 }), {
    tl: 0,
    tr: 2,
    br: 0,
    bl: 4,
  });
});
