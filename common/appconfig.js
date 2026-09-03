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

  //// Adw
  "regex.class:^org.gnome.*": "@adw",
  // "regex.class:^org.freedesktop.*": "@adw",
  "class:com.github.tchx84.Flatseal": "@adw",
  "class:simple-scan": "@adw",
  "class:re.sonny.Workbench": "@adw",
  "class:com.mattjakeman.ExtensionManager": "@adw",
  "class:com.mitchellh.ghostty": "@adw",
  "class:io.github.htkhiem.Euphonica": "@adw",
  "class:io.bassi.Amberol": "@adw",
  "class:ca.edestcroix.Recordbox": "@adw",

  //// Gtk
  "class:org.gnome.Terminal": "@gtk",
  "class:org.gnome.seahorse.Application": "@gtk",
  "class:org.gnome.Connections": "@gtk",
  "class:gnome-power-statistics": "@gtk",
  "class:org.gnome.PowerStats": "@gtk",
  "class:firefox": "@gtk",
  "class:firefox-esr": "@gtk",
  "class:thunderbird": "@gtk",
  "class:thunderbird-esr": "@gtk",
  "class:io.ente.auth": "@gtk",
  "class:dconf-editor": "@gtk",
  "class:org.gimp.GIMP": "@gtk",
  "class:gimp": "@gtk",
  "class:org.inkscape.Inkscape": "@gtk",
  "class:system-config-printer": "@gtk",
  "class:libreoffice-calc": "@gtk",
  "class:libreoffice-writer": "@gtk",
  "class:libreoffice-impress": "@gtk",
  "class:libreoffice-draw": "@gtk",
  "class:libreoffice-base": "@gtk",
  "class:cheese": "@gtk",
  "class:solaar": "@gtk",
  "class:com.github.xournalpp.xournalpp": "@gtk",
  "class:blender": "@gtk",
  "class:fr.handbrake.ghb": "@gtk",
  "class:com.dec05eba.gpu_screen_recorder": "@gtk",
  "class:org.pulseaudio.pavucontrol": "@gtk",

  //// Gtk with all corners
  "class:lollypop": "@gtk-all",
  "class:geary": "@gtk-all",
  "class:gnome-disks": "@gtk-all",
  // The newer versions use md.Obsidian and curved corners.
  "class:md.Obsidian": "@gtk-all",

  //// Chrome
  "regex.class:^google-chrome": "@chrome",
  //// Chrome apps
  "regex.class:^chrome-": "@chrome",
  //// Chromium
  "regex.class:^chromium": "@chrome",
  //// Electron
  "class:electron": "@zero",
  "class:obsidian": "@zero",
  "class:Chatgpt": "@zero",
  "class:com.anthropic.Claude": "@zero",
  "class:zulip": "@zero",
  "class:slack": "@zero",
  "class:code": "@zero",
  "class:antigravity": "@zero",
  "class:spotify": "@zero",
  "class:discord": "@zero",
  //// Other chromium browsers
  "class:microsoft-edge": "@chrome",
  "class:brave-browser": "@chrome",
  "regex.class:^vivaldi": "@zero",
  //// Qt
  "class:vlc": "@qt",
  "class:krita": "@qt",
  "class:qpwgraph": "@qt",
  "class:org.kde.kdenlive": "@qt",
  "class:org.shotcut.Shotcut": "@qt",
  "class:com.obsproject.Studio": "@qt",
  "class:org.qbittorrent.qBittorrent": "@qt",
  "class:SQLiteStudio": "@qt",
  "class:btrfs-assistant": "@qt",
  "class:Jan": "@qt",
  "class:vimiv": "@qt",
  "class:DB Browser for SQLite": "@qt",
  //// Others
  "class:dev.zed.Zed": "@zed",
  "class:mpv": "@zero",
  "class:imv": "@zero",
  //// Custom
  "class:foot": "@zero",
  "class:footclient": "@zero",
  "class:kitty": "@zero",
  "class:Alacritty": "@csd-12",
  "class:xwaylandvideobridge": "@off",
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

export function isSafeCssColor(value) {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    !/[;{}\r\n]/.test(value);
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
      !isSafeCssColor(config[field])
    ) {
      return `${key}.${field} must be a single CSS color value`;
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
      addEffectiveConfig(effective, key, value, presets);
      continue;
    }

    const rule = rules[key];
    if (rule === null) continue;
    const merged = isConfigObject(rule)
      ? mergePatch(
        presets ? value : resolveConfigValue(value, effective),
        rule,
      )
      : rule;
    addEffectiveConfig(effective, key, merged, presets);
  }
  for (const [key, value] of Object.entries(rules)) {
    if (!belongs(key) || hasOwn(baseConfigs, key) || value === null) {
      continue;
    }
    addEffectiveConfig(effective, key, value, presets);
  }
}

function addEffectiveConfig(effective, key, value, isPreset) {
  if (isPreset) {
    if (isConfigObject(value)) effective[key] = mergePatch({}, value);
    return;
  }
  if (typeof value === "string") {
    if (isConfigObject(effective[value])) effective[key] = value;
    return;
  }
  if (isConfigObject(value)) effective[key] = mergePatch({}, value);
}

export function getRulesError(rules, baseConfigs = BASE_APP_CONFIGS) {
  const error = getConfigMapError(rules, {
    allowTombstones: true,
    validateReferences: false,
  });
  if (error) return error;

  const effective = buildEffectiveAppConfigs(rules, baseConfigs);
  for (const [key, value] of Object.entries(rules)) {
    if (typeof value === "string" && !isConfigObject(effective[value])) {
      return `Unknown preset reference ${value} in ${key}`;
    }
  }
  return null;
}

export function deriveAppConfigRules(
  desiredConfigs,
  baseConfigs = BASE_APP_CONFIGS,
) {
  const desired = isConfigObject(desiredConfigs) ? desiredConfigs : {};
  const rules = {};

  for (const [key, baseValue] of Object.entries(baseConfigs)) {
    if (!hasOwn(desired, key)) {
      if (
        typeof baseValue !== "string" ||
        hasOwn(desired, baseValue)
      ) {
        rules[key] = null;
      }
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
