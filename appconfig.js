export const RULES_KEY = "rules";

const APP_PREFIXES = ["app:", "class:", "regex.app:", "regex.class:"];
const CONFIG_FIELDS = new Set([
  "activeColor",
  "enabled",
  "inactiveColor",
  "margins",
  "maximizedBorder",
  "radius",
  "width",
]);
const MARGIN_KEYS = ["top", "right", "bottom", "left"];
const RADIUS_KEYS = ["tl", "tr", "br", "bl"];

export const BASE_APP_CONFIGS = {
  "@zeroPreset": {},
  "@adwPreset": {
    radius: 18,
  },
  "@gtkPreset": {
    radius: { tl: 10, tr: 10, br: 0, bl: 0 },
  },
  "@gtk3Preset": {
    radius: { tl: 10, tr: 10, br: 11, bl: 11 },
  },
  "@qtPreset": {
    radius: { tl: 18, tr: 18, br: 0, bl: 0 },
  },
  "@chromePreset": {
    radius: { tl: 12, tr: 12, br: 0, bl: 0 },
  },
  "@zedPreset": {
    margins: { right: -1, bottom: -1 },
    radius: { tl: 14, tr: 14, br: 10, bl: 10 },
  },

  //// Adw
  "regex.class:^org.gnome.*": "@adwPreset",
  // "regex.class:^org.freedesktop.*": "@adwPreset",
  "class:com.github.tchx84.Flatseal": "@adwPreset",
  "class:simple-scan": "@adwPreset",
  "class:re.sonny.Workbench": "@adwPreset",
  "class:com.mattjakeman.ExtensionManager": "@adwPreset",
  "class:com.mitchellh.ghostty": "@adwPreset",
  "class:io.github.htkhiem.Euphonica": "@adwPreset",
  "class:io.bassi.Amberol": "@adwPreset",
  "class:ca.edestcroix.Recordbox": "@adwPreset",

  //// Gtk
  "class:org.gnome.Terminal": "@gtkPreset",
  "class:org.gnome.seahorse.Application": "@gtkPreset",
  "class:org.gnome.Connections": "@gtkPreset",
  "class:gnome-power-statistics": "@gtkPreset",
  "class:org.gnome.PowerStats": "@gtkPreset",
  "class:firefox": "@gtkPreset",
  "class:firefox-esr": "@gtkPreset",
  "class:thunderbird": "@gtkPreset",
  "class:thunderbird-esr": "@gtkPreset",
  "class:io.ente.auth": "@gtkPreset",
  "class:dconf-editor": "@gtkPreset",
  "class:org.gimp.GIMP": "@gtkPreset",
  "class:gimp": "@gtkPreset",
  "class:org.inkscape.Inkscape": "@gtkPreset",
  "class:system-config-printer": "@gtkPreset",
  "class:libreoffice-calc": "@gtkPreset",
  "class:libreoffice-writer": "@gtkPreset",
  "class:libreoffice-impress": "@gtkPreset",
  "class:libreoffice-draw": "@gtkPreset",
  "class:libreoffice-base": "@gtkPreset",
  "class:cheese": "@gtkPreset",
  "class:solaar": "@gtkPreset",
  "class:com.github.xournalpp.xournalpp": "@gtkPreset",
  "class:blender": "@gtkPreset",
  "class:fr.handbrake.ghb": "@gtkPreset",
  "class:com.dec05eba.gpu_screen_recorder": "@gtkPreset",
  "class:org.pulseaudio.pavucontrol": "@gtkPreset",

  //// Gtk3
  "class:lollypop": "@gtk3Preset",
  "class:geary": "@gtk3Preset",
  "class:gnome-disks": "@gtk3Preset",
  // The newer versions use md.Obsidian and curved corners.
  "class:md.Obsidian": "@gtk3Preset",

  //// Chrome
  "regex.class:^google-chrome": "@chromePreset",
  //// Chrome apps
  "regex.class:^chrome-": "@chromePreset",
  //// Chromium
  "regex.class:^chromium": "@chromePreset",
  //// Electron
  "class:electron": "@zeroPreset",
  "class:obsidian": "@zeroPreset",
  "class:Chatgpt": "@zeroPreset",
  "class:com.anthropic.Claude": "@zeroPreset",
  "class:zulip": "@zeroPreset",
  "class:slack": "@zeroPreset",
  "class:code": "@zeroPreset",
  "class:antigravity": "@zeroPreset",
  "class:spotify": "@zeroPreset",
  "class:discord": "@zeroPreset",
  //// Other chromium browsers
  "class:microsoft-edge": "@chromePreset",
  "class:brave-browser": "@chromePreset",
  "regex.class:^vivaldi": "@zeroPreset",
  //// Qt
  "class:vlc": "@qtPreset",
  "class:krita": "@qtPreset",
  "class:qpwgraph": "@qtPreset",
  "class:org.kde.kdenlive": "@qtPreset",
  "class:org.shotcut.Shotcut": "@qtPreset",
  "class:com.obsproject.Studio": "@qtPreset",
  "class:org.qbittorrent.qBittorrent": "@qtPreset",
  "class:SQLiteStudio": "@qtPreset",
  "class:btrfs-assistant": "@qtPreset",
  "class:Jan": "@qtPreset",
  "class:vimiv": "@qtPreset",
  "class:DB Browser for SQLite": "@qtPreset",
  //// Others
  "class:dev.zed.Zed": "@zedPreset",
  "class:mpv": "@zeroPreset",
  "class:imv": "@zeroPreset",
  //// Custom
  "class:foot": "@zeroPreset",
  "class:footclient": "@zeroPreset",
  "class:kitty": "@zeroPreset",
  "class:Alacritty": {
    radius: { tl: 12, tr: 12 },
  },
  "class:xwaylandvideobridge": {
    enabled: false,
  },
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

function normalizeInteger(value, minimum = -Infinity) {
  return Number.isFinite(value) ? Math.max(minimum, Math.trunc(value)) : 0;
}

function normalizeNumberMap(value, keys, minimum = -Infinity) {
  if (typeof value === "number") {
    const normalized = normalizeInteger(value, minimum);
    return Object.fromEntries(keys.map((key) => [key, normalized]));
  }
  return Object.fromEntries(
    keys.map((key) => [key, normalizeInteger(value?.[key], minimum)]),
  );
}

export function normalizeWidth(width) {
  return normalizeInteger(width, 0);
}

export function normalizeMargins(margins) {
  return normalizeNumberMap(margins, MARGIN_KEYS);
}

export function normalizeRadius(radius) {
  return normalizeNumberMap(radius, RADIUS_KEYS, 0);
}

export function parseConfigJson(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return isConfigObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function getConfigMapError(
  configs,
  { allowTombstones = false, validateReferences = true } = {},
) {
  if (!isConfigObject(configs)) return "Config must be a JSON object";

  const exactKeys = new Map();
  for (const [key, value] of Object.entries(configs)) {
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
      try {
        new RegExp(key.slice(key.indexOf(":") + 1));
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
  if (validateReferences) {
    for (const [key, value] of Object.entries(configs)) {
      if (
        typeof value === "string" &&
        !isConfigObject(configs[value])
      ) {
        return `Unknown preset reference ${value} in ${key}`;
      }
    }
  }
  return null;
}

function getConfigValueError(key, config, allowNulls) {
  const unknownField = Object.keys(config).find(
    (field) => !CONFIG_FIELDS.has(field),
  );
  if (unknownField) return `${key}.${unknownField} is not valid`;

  const nullable = (value) => allowNulls && value === null;
  for (const field of ["enabled", "maximizedBorder"]) {
    if (
      hasOwn(config, field) &&
      !nullable(config[field]) &&
      typeof config[field] !== "boolean"
    ) {
      return `${key}.${field} must be a boolean`;
    }
  }
  if (
    hasOwn(config, "width") &&
    !nullable(config.width) &&
    (!Number.isInteger(config.width) || config.width < 0)
  ) {
    return `${key}.width must be a non-negative integer`;
  }
  for (const field of ["activeColor", "inactiveColor"]) {
    if (
      hasOwn(config, field) &&
      !nullable(config[field]) &&
      (typeof config[field] !== "string" || !config[field])
    ) {
      return `${key}.${field} must be a non-empty string`;
    }
  }

  const marginsError = getNumberMapError(
    key,
    "margins",
    config.margins,
    MARGIN_KEYS,
    allowNulls,
  );
  if (hasOwn(config, "margins") && marginsError) return marginsError;

  const radiusError = getNumberMapError(
    key,
    "radius",
    config.radius,
    RADIUS_KEYS,
    allowNulls,
    0,
  );
  if (hasOwn(config, "radius") && radiusError) return radiusError;
  return null;
}

function getNumberMapError(
  key,
  field,
  value,
  names,
  allowNulls,
  minimum = -Infinity,
) {
  if (allowNulls && value === null) return null;
  if (Number.isInteger(value) && value >= minimum) return null;
  if (!isConfigObject(value)) {
    return `${key}.${field} must be an integer or side object`;
  }
  for (const [name, number] of Object.entries(value)) {
    if (!names.includes(name)) return `${key}.${field}.${name} is not valid`;
    if (allowNulls && number === null) continue;
    if (!Number.isInteger(number) || number < minimum) {
      return `${key}.${field}.${name} must be an integer`;
    }
  }
  return null;
}

function hasOwn(object, key) {
  return Object.hasOwn(object, key);
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

function addEffectiveConfigs(effective, baseConfigs, rules, presets) {
  const belongs = (key) => key.startsWith("@") === presets;
  for (const [key, value] of Object.entries(baseConfigs)) {
    if (!belongs(key)) continue;
    if (!hasOwn(rules, key)) {
      effective[key] = copyConfig(value);
      continue;
    }

    const rule = rules[key];
    if (rule === null) continue;
    effective[key] = isConfigObject(rule)
      ? mergePatch(
        presets ? value : resolveConfigValue(value, effective),
        rule,
      )
      : copyConfig(rule);
  }
  for (const [key, value] of Object.entries(rules)) {
    if (!belongs(key) || hasOwn(baseConfigs, key) || value === null) {
      continue;
    }
    effective[key] = copyConfig(value);
  }
}

export function deriveAppConfigRules(
  desiredConfigs,
  baseConfigs = BASE_APP_CONFIGS,
) {
  const desired = isConfigObject(desiredConfigs) ? desiredConfigs : {};
  const rules = {};

  for (const [key, baseValue] of Object.entries(baseConfigs)) {
    if (!hasOwn(desired, key)) {
      rules[key] = null;
      continue;
    }

    const desiredValue = desired[key];
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
    if (!hasOwn(baseConfigs, key)) rules[key] = copyConfig(value);
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
  return [
    ...Array.from(customKeys, (key) => [key, configs[key]]),
    ...Object.entries(configs).filter(
      ([key]) => key.startsWith("regex.") && !customKeys.has(key),
    ),
  ].filter(([_key, config]) => config);
}
