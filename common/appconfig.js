import { BORDER_CORNERS, BORDER_SIDES } from "./border.js";

export const RULES_KEY = "rules";
export const MAX_CONFIG_ENTRIES = 512;
export const MAX_CONFIG_JSON_LENGTH = 256 * 1024;
export const MAX_CONFIG_FILE_SIZE = 4 * MAX_CONFIG_JSON_LENGTH;
export const MAX_CONFIG_KEY_LENGTH = 512;
export const MAX_REGEX_CONFIGS = 32;
export const MAX_REGEX_RULES = 2 * MAX_REGEX_CONFIGS;
export const MAX_REGEX_LENGTH = 256;
export const MAX_COLOR_LENGTH = 256;
export const MAX_MATCH_VALUE_LENGTH = 512;
export const MAX_BORDER_WIDTH = 50;
export const MAX_BORDER_MARGIN = 100;
export const MAX_BORDER_RADIUS = 200;

export const BASE_APP_CONFIGS = {
  "@off": { enabled: false },
  "@zero": {},
  "@adw": csdPreset(18, 18),
  "@gtk": csdPreset(10),
  "@gtk-all": csdPreset(10, 11),
  "@csd-12": csdPreset(12),
  "@csd-12-12": csdPreset(12, 12),
  "@csd-18": csdPreset(18),
  "@csd-18-18": csdPreset(18, 18),
  "@qt": csdPreset(18),
  "@chrome": csdPreset(12),
  "@zed": {
    margins: { right: -1, bottom: -1 },
    radius: { tl: 14, tr: 14, br: 10, bl: 10 },
  },

  // Regex order controls precedence among shipped patterns.
  "regex.class:^org.gnome.*": "@adw",
  "regex.class:^google-chrome": "@chrome",
  "regex.class:^chrome-": "@chrome",
  "regex.class:^chromium": "@chrome",
  "regex.class:^vivaldi": "@zero",

  ...classConfigs("@adw", [
    "com.github.tchx84.Flatseal",
    "simple-scan",
    "re.sonny.Workbench",
    "com.mattjakeman.ExtensionManager",
    "com.mitchellh.ghostty",
    "io.github.htkhiem.Euphonica",
    "io.bassi.Amberol",
    "ca.edestcroix.Recordbox",
  ]),
  ...classConfigs("@gtk", [
    "org.gnome.Terminal",
    "org.gnome.seahorse.Application",
    "org.gnome.Connections",
    "gnome-power-statistics",
    "org.gnome.PowerStats",
    "firefox",
    "firefox-esr",
    "thunderbird",
    "thunderbird-esr",
    "io.ente.auth",
    "dconf-editor",
    "org.gimp.GIMP",
    "gimp",
    "org.inkscape.Inkscape",
    "system-config-printer",
    "libreoffice-calc",
    "libreoffice-writer",
    "libreoffice-impress",
    "libreoffice-draw",
    "libreoffice-base",
    "cheese",
    "solaar",
    "com.github.xournalpp.xournalpp",
    "blender",
    "fr.handbrake.ghb",
    "com.dec05eba.gpu_screen_recorder",
    "org.pulseaudio.pavucontrol",
  ]),
  ...classConfigs("@gtk-all", [
    "lollypop",
    "geary",
    "gnome-disks",
    "md.Obsidian",
  ]),
  ...classConfigs("@chrome", ["microsoft-edge", "brave-browser"]),
  ...classConfigs("@zero", [
    "electron",
    "obsidian",
    "Chatgpt",
    "com.anthropic.Claude",
    "zulip",
    "slack",
    "code",
    "antigravity",
    "spotify",
    "discord",
    "mpv",
    "imv",
    "foot",
    "footclient",
    "kitty",
  ]),
  ...classConfigs("@qt", [
    "vlc",
    "krita",
    "qpwgraph",
    "org.kde.kdenlive",
    "org.shotcut.Shotcut",
    "com.obsproject.Studio",
    "org.qbittorrent.qBittorrent",
    "SQLiteStudio",
    "btrfs-assistant",
    "Jan",
    "vimiv",
    "DB Browser for SQLite",
  ]),
  ...classConfigs("@csd-12", ["Alacritty"]),
  ...classConfigs("@off", ["xwaylandvideobridge"]),
  "class:dev.zed.Zed": "@zed",
};

export function isConfigObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function copyConfig(value) {
  return JSON.parse(JSON.stringify(value));
}

export function canonicalizeConfigKey(key) {
  return key.startsWith("app:") || key.startsWith("class:")
    ? key.toLowerCase()
    : key;
}

export function findEquivalentConfigKey(configs, candidate) {
  const canonical = canonicalizeConfigKey(candidate);
  return Object.keys(configs).find(
    (key) => canonicalizeConfigKey(key) === canonical,
  );
}

export function normalizeWidth(width) {
  return normalizeInteger(width, 0, MAX_BORDER_WIDTH);
}

export function normalizeMargins(margins) {
  return normalizeNumberMap(
    margins,
    BORDER_SIDES,
    -MAX_BORDER_MARGIN,
    MAX_BORDER_MARGIN,
  );
}

export function normalizeRadius(radius) {
  return normalizeNumberMap(radius, BORDER_CORNERS, 0, MAX_BORDER_RADIUS);
}

export function isSafeCssColor(value) {
  return typeof value === "string" &&
    value.length <= MAX_COLOR_LENGTH &&
    value.trim().length > 0 &&
    !/[;{}\r\n]/.test(value);
}

export function parseConfigJson(raw, maxLength = MAX_CONFIG_JSON_LENGTH) {
  if (raw.length > maxLength) {
    throw new Error(
      `Config must contain at most ${maxLength} characters`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON");
  }
  if (!isConfigObject(parsed)) throw new Error("Config must be a JSON object");
  return parsed;
}

export function getConfigMapError(
  configs,
  {
    allowTombstones = false,
    validateReferences = true,
    validateRegex = (pattern) => new RegExp(pattern),
    maxEntries = MAX_CONFIG_ENTRIES,
    maxJsonLength = MAX_CONFIG_JSON_LENGTH,
    maxRegexes = MAX_REGEX_CONFIGS,
  } = {},
) {
  if (!isConfigObject(configs)) return "Config must be a JSON object";

  const entries = Object.entries(configs);
  if (entries.length > maxEntries) {
    return `Config must contain at most ${maxEntries} entries`;
  }
  let serialized;
  try {
    serialized = JSON.stringify(configs);
  } catch {
    return "Config must be JSON serializable";
  }
  if (serialized.length > maxJsonLength) {
    return `Config must contain at most ${maxJsonLength} characters`;
  }

  const exactKeys = new Map();
  let regexCount = 0;
  for (const [key, value] of entries) {
    if (key.length > MAX_CONFIG_KEY_LENGTH) {
      return `Config keys must contain at most ${MAX_CONFIG_KEY_LENGTH} characters`;
    }
    const isPreset = key.startsWith("@");
    const appPrefix = APP_PREFIXES.find((prefix) => key.startsWith(prefix));
    if (
      (isPreset && key.length === 1) ||
      (!isPreset && (!appPrefix || key.length === appPrefix.length))
    ) {
      return `Invalid config key: ${key}`;
    }
    const canonicalKey = canonicalizeConfigKey(key);
    const equivalentKey = exactKeys.get(canonicalKey);
    if (equivalentKey) {
      return `Duplicate exact-match config keys: ${equivalentKey} and ${key}`;
    }
    exactKeys.set(canonicalKey, key);
    if (key.startsWith("regex.")) {
      const pattern = key.slice(key.indexOf(":") + 1);
      if (++regexCount > maxRegexes) {
        return `Config must contain at most ${maxRegexes} regexes`;
      }
      if (pattern.length > MAX_REGEX_LENGTH) {
        return `Regular expression must contain at most ${MAX_REGEX_LENGTH} characters: ${key}`;
      }
      try {
        validateRegex(pattern);
      } catch {
        return `Invalid regular expression: ${key}`;
      }
    }
    if (value === null && allowTombstones) continue;
    if (isPreset && !isConfigObject(value)) {
      return `Preset ${key} must be an object`;
    }
    if (
      !isPreset &&
      !isConfigObject(value) &&
      !(typeof value === "string" && value.startsWith("@"))
    ) {
      return `App config ${key} must be an object or preset reference`;
    }
    if (isConfigObject(value)) {
      const valueError = getConfigValueError(key, value, allowTombstones);
      if (valueError) return valueError;
    }
  }
  return validateReferences ? getReferenceError(configs) : null;
}

export function resolveConfigValue(value, configs) {
  if (typeof value === "string" && value.startsWith("@")) {
    const preset = configs[value];
    return isConfigObject(preset) ? copyConfig(preset) : {};
  }
  return isConfigObject(value) ? copyConfig(value) : {};
}

export function buildEffectiveAppConfigs(
  rules = {},
  baseConfigs = BASE_APP_CONFIGS,
) {
  const effective = {};
  addEffectiveConfigs(effective, baseConfigs, rules, true);
  addEffectiveConfigs(effective, baseConfigs, rules, false);
  return effective;
}

export function getRulesError(
  rules,
  baseConfigs = BASE_APP_CONFIGS,
  options = {},
) {
  const error = getConfigMapError(rules, {
    allowTombstones: true,
    validateReferences: false,
    maxRegexes: MAX_REGEX_RULES,
    ...options,
  });
  if (error) return error;

  const effective = buildEffectiveAppConfigs(rules, baseConfigs);
  const referenceError = getReferenceError(effective, rules);
  if (referenceError) return referenceError;
  if (
    getOrderedRegexConfigs(effective, rules, baseConfigs).length >
      MAX_REGEX_CONFIGS
  ) {
    return `Effective config must contain at most ${MAX_REGEX_CONFIGS} regexes`;
  }
  return null;
}

export function deriveAppConfigRules(
  desiredConfigs,
  baseConfigs = BASE_APP_CONFIGS,
) {
  const desired = isConfigObject(desiredConfigs) ? desiredConfigs : {};
  const desiredKeys = new Map(
    Object.keys(desired).map((key) => [canonicalizeConfigKey(key), key]),
  );
  const inheritedKeys = new Set();
  const rules = {};

  for (const [key, baseValue] of Object.entries(baseConfigs)) {
    const desiredKey = desiredKeys.get(canonicalizeConfigKey(key));
    if (desiredKey === undefined) {
      if (
        typeof baseValue !== "string" ||
        hasOwn(desired, baseValue)
      ) {
        rules[key] = null;
      }
      continue;
    }

    inheritedKeys.add(desiredKey);
    const desiredValue = desired[desiredKey];
    let comparisonBase = baseValue;
    if (
      !key.startsWith("@") &&
      isConfigObject(desiredValue) &&
      typeof baseValue === "string"
    ) {
      comparisonBase = resolveConfigValue(baseValue, desired);
    }
    const patch = createPatch(comparisonBase, desiredValue);
    if (patch !== undefined) {
      rules[key] = patch;
    } else if (typeof baseValue === "string" && isConfigObject(desiredValue)) {
      // An empty object is meaningful here: it detaches the app from the
      // shipped preset while retaining its current effective values.
      rules[key] = {};
    }
  }

  for (const [key, value] of Object.entries(desired)) {
    if (!inheritedKeys.has(key)) rules[key] = copyConfig(value);
  }

  return rules;
}

export function getOrderedRegexConfigs(
  configs,
  rules,
  baseConfigs = BASE_APP_CONFIGS,
) {
  const customKeys = new Set(
    Object.keys(rules).filter(
      (key) =>
        key.startsWith("regex.") &&
        rules[key] !== null &&
        !hasOwn(baseConfigs, key),
    ),
  );
  const ordered = [[], []];
  for (const entry of Object.entries(configs)) {
    const [key, config] = entry;
    if (key.startsWith("regex.") && config) {
      ordered[customKeys.has(key) ? 0 : 1].push(entry);
    }
  }
  return ordered.flat();
}

function csdPreset(topRadius, bottomRadius = 0) {
  return {
    radius: {
      tl: topRadius,
      tr: topRadius,
      br: bottomRadius,
      bl: bottomRadius,
    },
  };
}

function classConfigs(preset, classes) {
  return Object.fromEntries(classes.map((name) => [`class:${name}`, preset]));
}

function hasOwn(object, key) {
  return Object.hasOwn(object, key);
}

function normalizeInteger(value, minimum, maximum) {
  return Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.trunc(value)))
    : 0;
}

function normalizeNumberMap(value, keys, minimum, maximum) {
  if (typeof value === "number") {
    const normalized = normalizeInteger(value, minimum, maximum);
    return Object.fromEntries(keys.map((key) => [key, normalized]));
  }
  return Object.fromEntries(
    keys.map((key) => [
      key,
      normalizeInteger(value?.[key], minimum, maximum),
    ]),
  );
}

const APP_PREFIXES = ["app:", "class:", "regex.app:", "regex.class:"];

const CONFIG_FIELDS = {
  enabled: (value) => typeof value === "boolean" ? null : " must be a boolean",
  maximizedBorder: (value) =>
    typeof value === "boolean" ? null : " must be a boolean",
  width: (value) => {
    if (!Number.isInteger(value)) return " must be a non-negative integer";
    return value >= 0 && value <= MAX_BORDER_WIDTH
      ? null
      : ` must be between 0 and ${MAX_BORDER_WIDTH}`;
  },
  activeColor: (value) =>
    isSafeCssColor(value) ? null : " must be a single CSS color value",
  inactiveColor: (value) =>
    isSafeCssColor(value) ? null : " must be a single CSS color value",
  margins: (value, allowNulls) =>
    getNumberMapError(
      value,
      BORDER_SIDES,
      -MAX_BORDER_MARGIN,
      MAX_BORDER_MARGIN,
      allowNulls,
    ),
  radius: (value, allowNulls) =>
    getNumberMapError(
      value,
      BORDER_CORNERS,
      0,
      MAX_BORDER_RADIUS,
      allowNulls,
    ),
};

function getNumberMapError(
  value,
  names,
  minimum,
  maximum,
  allowNulls = false,
) {
  if (Number.isInteger(value)) {
    return value >= minimum && value <= maximum
      ? null
      : ` must be between ${minimum} and ${maximum}`;
  }
  if (!isConfigObject(value)) return " must be an integer or side object";
  for (const [name, number] of Object.entries(value)) {
    if (!names.includes(name)) return `.${name} is not valid`;
    if (allowNulls && number === null) continue;
    if (!Number.isInteger(number)) return `.${name} must be an integer`;
    if (number < minimum || number > maximum) {
      return `.${name} must be between ${minimum} and ${maximum}`;
    }
  }
  return null;
}

function getReferenceError(configs, references = configs) {
  for (const [key, value] of Object.entries(references)) {
    if (typeof value === "string" && !isConfigObject(configs[value])) {
      return `Unknown preset reference ${value} in ${key}`;
    }
  }
  return null;
}

function getConfigValueError(key, config, allowNulls) {
  const unknownField = Object.keys(config).find(
    (field) => !Object.hasOwn(CONFIG_FIELDS, field),
  );
  if (unknownField) return `${key}.${unknownField} is not valid`;

  for (const [field, validate] of Object.entries(CONFIG_FIELDS)) {
    if (!hasOwn(config, field) || (allowNulls && config[field] === null)) {
      continue;
    }
    const error = validate(config[field], allowNulls);
    if (error) return `${key}.${field}${error}`;
  }
  return null;
}

function mergePatch(base, patch) {
  if (!isConfigObject(patch)) return copyConfig(patch);

  const merged = isConfigObject(base) ? copyConfig(base) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete merged[key];
    } else if (isConfigObject(value)) {
      merged[key] = mergePatch(merged[key], value);
    } else {
      merged[key] = copyConfig(value);
    }
  }
  return merged;
}

function valuesEqual(left, right) {
  if (left === right) return true;
  if (!isConfigObject(left) || !isConfigObject(right)) return false;

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key) => hasOwn(right, key) && valuesEqual(left[key], right[key]),
  );
}

function createPatch(base, desired) {
  if (valuesEqual(base, desired)) return undefined;
  if (!isConfigObject(base) || !isConfigObject(desired)) {
    return copyConfig(desired);
  }

  const patch = {};
  for (const key of Object.keys(base)) {
    if (!hasOwn(desired, key)) patch[key] = null;
  }
  for (const [key, value] of Object.entries(desired)) {
    const change = hasOwn(base, key)
      ? createPatch(base[key], value)
      : copyConfig(value);
    if (change !== undefined) patch[key] = change;
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

function addEffectiveConfigs(effective, baseConfigs, rules, presets) {
  const baseKeys = new Map(
    Object.keys(baseConfigs).map((key) => [canonicalizeConfigKey(key), key]),
  );
  const ruleKeys = new Map(
    Object.keys(rules).map((key) => [canonicalizeConfigKey(key), key]),
  );
  const identities = new Set([...baseKeys.keys(), ...ruleKeys.keys()]);

  for (const identity of identities) {
    // Exact app/class matches are case-insensitive at runtime. Keep the shipped
    // spelling while applying an equivalent user key as the same entry.
    const key = baseKeys.get(identity) ?? ruleKeys.get(identity);
    if (key.startsWith("@") !== presets) continue;
    const baseKey = baseKeys.get(identity);
    const ruleKey = ruleKeys.get(identity);
    const hasBase = baseKey !== undefined;
    const hasRule = ruleKey !== undefined;
    const baseValue = baseConfigs[baseKey];
    const rule = rules[ruleKey];
    if (hasRule && rule === null) continue;
    const value = !hasRule
      ? baseValue
      : hasBase && isConfigObject(rule)
      ? mergePatch(
        presets ? baseValue : resolveConfigValue(baseValue, effective),
        rule,
      )
      : rule;
    if (presets) {
      if (isConfigObject(value)) effective[key] = mergePatch({}, value);
    } else if (typeof value === "string" && isConfigObject(effective[value])) {
      effective[key] = value;
    } else if (isConfigObject(value)) {
      effective[key] = mergePatch({}, value);
    }
  }
}
