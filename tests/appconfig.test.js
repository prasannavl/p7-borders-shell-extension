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
  MAX_BORDER_MARGIN,
  MAX_BORDER_RADIUS,
  MAX_BORDER_WIDTH,
  MAX_COLOR_LENGTH,
  MAX_CONFIG_ENTRIES,
  MAX_CONFIG_JSON_LENGTH,
  MAX_CONFIG_KEY_LENGTH,
  MAX_REGEX_CONFIGS,
  MAX_REGEX_LENGTH,
  MAX_REGEX_RULES,
  normalizeMargins,
  normalizeRadius,
  normalizeWidth,
  parseConfigJson,
  resolveConfigValue,
} from "../common/appconfig.js";
import { assertEquals } from "./assert.js";

Deno.test("base entries remain references without rules", () => {
  const base = {
    "@preset": { radius: { tl: 10, tr: 10 } },
    "class:app": "@preset",
  };
  assertEquals(buildEffectiveAppConfigs({}, base), base);
});

Deno.test("shipped CSD preset names encode top and bottom radii", () => {
  assertEquals(BASE_APP_CONFIGS["@off"], { enabled: false });
  assertEquals(BASE_APP_CONFIGS["@adw"], {
    radius: { tl: 18, tr: 18, br: 18, bl: 18 },
  });
  assertEquals(BASE_APP_CONFIGS["@csd-12"], {
    radius: { tl: 12, tr: 12, br: 0, bl: 0 },
  });
  assertEquals(BASE_APP_CONFIGS["@csd-12-12"], {
    radius: { tl: 12, tr: 12, br: 12, bl: 12 },
  });
  assertEquals(BASE_APP_CONFIGS["@csd-18"], {
    radius: { tl: 18, tr: 18, br: 0, bl: 0 },
  });
  assertEquals(BASE_APP_CONFIGS["@csd-18-18"], {
    radius: { tl: 18, tr: 18, br: 18, bl: 18 },
  });
  assertEquals(BASE_APP_CONFIGS["class:lollypop"], "@gtk-all");
  assertEquals(BASE_APP_CONFIGS["class:firefox"], "@gtk");
  assertEquals(BASE_APP_CONFIGS["class:thunderbird"], "@gtk");
  assertEquals(BASE_APP_CONFIGS["class:Alacritty"], "@csd-12");
  assertEquals(BASE_APP_CONFIGS["class:xwaylandvideobridge"], "@off");
  assertEquals(BASE_APP_CONFIGS["regex.class:keepassxc"], undefined);
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

Deno.test("case variants of shipped exact keys retain one identity", () => {
  const base = {
    "@preset": { width: 3 },
    "class:firefox": "@preset",
  };
  const desired = {
    "@preset": { width: 3 },
    "class:Firefox": { width: 5 },
  };

  const rules = deriveAppConfigRules(desired, base);
  assertEquals(rules, { "class:firefox": { width: 5 } });
  assertEquals(getRulesError(rules, base), null);
  assertEquals(buildEffectiveAppConfigs(rules, base), {
    "@preset": { width: 3 },
    "class:firefox": { width: 5 },
  });
});

Deno.test("case-variant rules override and suppress one shipped identity", () => {
  const base = {
    "@preset": { radius: 10 },
    "class:firefox": "@preset",
  };
  const override = { "class:Firefox": { width: 5 } };
  const effective = buildEffectiveAppConfigs(override, base);

  assertEquals(effective, {
    "@preset": { radius: 10 },
    "class:firefox": { radius: 10, width: 5 },
  });
  assertEquals(deriveAppConfigRules(effective, base), {
    "class:firefox": { width: 5 },
  });
  assertEquals(
    buildEffectiveAppConfigs({ "class:Firefox": null }, base),
    { "@preset": { radius: 10 } },
  );
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

Deno.test("configuration JSON parsing is bounded and strict", () => {
  for (
    const [raw, message] of [
      ["not json", "Invalid JSON"],
      ["[]", "Config must be a JSON object"],
      [
        " ".repeat(MAX_CONFIG_JSON_LENGTH + 1),
        `Config must contain at most ${MAX_CONFIG_JSON_LENGTH} characters`,
      ],
    ]
  ) {
    let error;
    try {
      parseConfigJson(raw);
    } catch (caught) {
      error = caught;
    }
    assertEquals(error?.message, message);
  }
});

Deno.test("configuration work has explicit input bounds", () => {
  const entries = Object.fromEntries(
    Array.from({ length: MAX_CONFIG_ENTRIES + 1 }, (_, index) => [
      `class:${index}`,
      {},
    ]),
  );
  assertEquals(
    getConfigMapError(entries),
    `Config must contain at most ${MAX_CONFIG_ENTRIES} entries`,
  );
  assertEquals(
    getConfigMapError({ [`class:${"x".repeat(MAX_CONFIG_KEY_LENGTH)}`]: {} }),
    `Config keys must contain at most ${MAX_CONFIG_KEY_LENGTH} characters`,
  );
  assertEquals(
    getConfigMapError({
      [`regex.class:${"x".repeat(MAX_REGEX_LENGTH + 1)}`]: {},
    }),
    `Regular expression must contain at most ${MAX_REGEX_LENGTH} characters: ` +
      `regex.class:${"x".repeat(MAX_REGEX_LENGTH + 1)}`,
  );
  assertEquals(
    getConfigMapError({
      "class:color": { activeColor: "x".repeat(MAX_COLOR_LENGTH + 1) },
    }),
    "class:color.activeColor must be a single CSS color value",
  );

  const base = Object.fromEntries(
    Array.from({ length: MAX_REGEX_CONFIGS }, (_, index) => [
      `regex.class:^base${index}$`,
      {},
    ]),
  );
  assertEquals(
    getRulesError({ "regex.class:^custom$": {} }, base),
    `Effective config must contain at most ${MAX_REGEX_CONFIGS} regexes`,
  );

  const replacementRules = Object.fromEntries([
    ...Object.keys(base).map((key) => [key, null]),
    ...Array.from({ length: MAX_REGEX_CONFIGS }, (_, index) => [
      `regex.class:^replacement${index}$`,
      {},
    ]),
  ]);
  assertEquals(getRulesError(replacementRules, base), null);
  assertEquals(
    getOrderedRegexConfigs(
      buildEffectiveAppConfigs(replacementRules, base),
      replacementRules,
      base,
    ).length,
    MAX_REGEX_CONFIGS,
  );
  assertEquals(
    getRulesError(
      Object.fromEntries(
        Array.from({ length: MAX_REGEX_RULES + 1 }, (_, index) => [
          `regex.class:^raw${index}$`,
          null,
        ]),
      ),
      {},
    ),
    `Config must contain at most ${MAX_REGEX_RULES} regexes`,
  );

  const cyclic = {};
  cyclic["class:cyclic"] = cyclic;
  assertEquals(
    getConfigMapError(cyclic),
    "Config must be JSON serializable",
  );
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
    getConfigMapError({ "class:invalid": { width: MAX_BORDER_WIDTH + 1 } }),
    `class:invalid.width must be between 0 and ${MAX_BORDER_WIDTH}`,
  );
  assertEquals(
    getConfigMapError({
      "class:invalid": { margins: { left: -MAX_BORDER_MARGIN - 1 } },
    }),
    `class:invalid.margins.left must be between ` +
      `${-MAX_BORDER_MARGIN} and ${MAX_BORDER_MARGIN}`,
  );
  assertEquals(
    getConfigMapError({
      "class:invalid": { radius: { tr: MAX_BORDER_RADIUS + 1 } },
    }),
    `class:invalid.radius.tr must be between 0 and ${MAX_BORDER_RADIUS}`,
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
  assertEquals(normalizeWidth(1e308), MAX_BORDER_WIDTH);
  assertEquals(normalizeMargins(1e308), {
    top: MAX_BORDER_MARGIN,
    right: MAX_BORDER_MARGIN,
    bottom: MAX_BORDER_MARGIN,
    left: MAX_BORDER_MARGIN,
  });
  assertEquals(normalizeRadius(1e308), {
    tl: MAX_BORDER_RADIUS,
    tr: MAX_BORDER_RADIUS,
    br: MAX_BORDER_RADIUS,
    bl: MAX_BORDER_RADIUS,
  });
});
