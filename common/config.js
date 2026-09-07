// config.js

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import {
  BASE_APP_CONFIGS,
  buildEffectiveAppConfigs,
  canonicalizeConfigKey,
  getConfigMapError,
  getOrderedRegexConfigs,
  getRulesError,
  isSafeCssColor,
  MAX_CONFIG_ENTRIES,
  MAX_CONFIG_FILE_SIZE,
  MAX_MATCH_VALUE_LENGTH,
  MAX_REGEX_CONFIGS,
  MAX_REGEX_RULES,
  normalizeMargins,
  normalizeRadius,
  normalizeWidth,
  parseConfigJson,
  resolveConfigValue,
  RULES_KEY,
} from "./appconfig.js";

export const SCHEMA_VERSION = 1;
export const USE_SHIPPED_CONFIGS_KEY = "use-shipped-configs";
const DEFAULT_ACTIVE_COLOR = "rgba(51, 153, 230, 0.4)";
const DEFAULT_SOLID_ACTIVE_COLOR = "rgb(51, 153, 230)";
const DEFAULT_INACTIVE_COLOR = "rgba(102, 102, 102, 0.2)";
const MAX_CONFIG_WARNINGS = 20;
const MAX_RULE_CANDIDATES = 2 * MAX_CONFIG_ENTRIES;

export function getSettingsConfigMapError(configs, options = {}) {
  return getConfigMapError(configs, { ...options, ...REGEX_VALIDATION });
}

export function getSettingsRulesError(rules, baseConfigs) {
  return getRulesError(rules, baseConfigs, REGEX_VALIDATION);
}

export function getSettingsFullConfigError(configs, baseConfigs) {
  return getSettingsConfigMapError(configs, {
    maxEntries: MAX_CONFIG_ENTRIES + Object.keys(baseConfigs).length,
    maxJsonLength: MAX_CONFIG_FILE_SIZE,
  });
}

export function ensureSchemaVersion(settings) {
  const storedVersion = settings.get_int("schema-version");
  // Persist even when the schema default matches. A future default bump must
  // still be able to identify existing installs that need migration.
  if (
    settings.get_user_value("schema-version") === null ||
    storedVersion < SCHEMA_VERSION
  ) {
    settings.set_int("schema-version", SCHEMA_VERSION);
  }
}

export function getSettingsRules(settings, logger = null) {
  try {
    return parseConfigJson(settings.get_string(RULES_KEY));
  } catch (error) {
    // Persisted invalid input must not prevent the extension from starting.
    logger?.warn(`Ignoring invalid rules document: ${error.message}`);
    return {};
  }
}

export function setSettingsRules(settings, rules) {
  if (!settings.is_writable(RULES_KEY)) return false;
  if (Object.keys(rules).length > 0) {
    return settings.set_string(RULES_KEY, JSON.stringify(rules));
  }
  settings.reset(RULES_KEY);
  return true;
}

export function readSettingsAppConfigs(settings, logger = null) {
  const useShippedConfigs = settings.get_boolean(USE_SHIPPED_CONFIGS_KEY);
  const baseConfigs = useShippedConfigs ? BASE_APP_CONFIGS : {};
  const rawRules = getSettingsRules(settings, logger);
  const entries = Object.entries(rawRules);
  const candidates = [];
  let warningCount = 0;
  const warn = (message) => {
    if (warningCount < MAX_CONFIG_WARNINGS) logger?.warn(message);
    else if (warningCount === MAX_CONFIG_WARNINGS) {
      logger?.warn("Ignoring additional invalid rules");
    }
    warningCount++;
  };

  let regexCandidates = 0;
  for (let index = 0; index < entries.length; index++) {
    if (index >= MAX_RULE_CANDIDATES) {
      warn(`Ignoring rules after ${MAX_RULE_CANDIDATES} candidates`);
      break;
    }
    const [key, value] = entries[index];
    if (
      key.startsWith("regex.") &&
      ++regexCandidates > MAX_REGEX_RULES
    ) {
      warn(`Ignoring regexes after ${MAX_REGEX_RULES} candidates`);
      continue;
    }
    const error = getSettingsConfigMapError({ [key]: value }, {
      allowTombstones: true,
      validateReferences: false,
    });
    if (error) {
      warn(`Ignoring invalid rule: ${error}`);
    } else candidates.push([key, value]);
  }

  // Resolve references before applying the accepted-rule quota, so broken
  // references cannot displace valid rules. Presets are admitted first because
  // application references depend on them, while regex order remains intact.
  const presets = new Set(
    Object.keys(baseConfigs).filter((key) => key.startsWith("@")),
  );
  for (const [key, value] of candidates) {
    if (!key.startsWith("@")) continue;
    if (value === null) presets.delete(key);
    else presets.add(key);
  }

  const validEntries = candidates.filter(([key, value]) => {
    if (typeof value !== "string" || presets.has(value)) return true;
    warn(`Ignoring invalid rule: Unknown preset reference ${value} in ${key}`);
    return false;
  });
  validEntries.sort(([left], [right]) =>
    Number(right.startsWith("@")) - Number(left.startsWith("@"))
  );

  const rules = {};
  const exactKeys = new Map();
  for (const [key, value] of validEntries) {
    const canonicalKey = canonicalizeConfigKey(key);
    const equivalentKey = exactKeys.get(canonicalKey);
    if (equivalentKey) {
      warn(
        `Ignoring invalid rule: Duplicate exact-match config keys: ` +
          `${equivalentKey} and ${key}`,
      );
      continue;
    }
    if (exactKeys.size >= MAX_CONFIG_ENTRIES) {
      warn(`Ignoring rules after ${MAX_CONFIG_ENTRIES} valid entries`);
      break;
    }
    rules[key] = value;
    exactKeys.set(canonicalKey, key);
  }

  const configs = buildEffectiveAppConfigs(rules, baseConfigs);
  const configKeys = new Set(Object.keys(configs).map(canonicalizeConfigKey));
  // Overflow can exclude a custom preset that an earlier accepted app uses.
  for (const [key, value] of Object.entries(rules)) {
    if (
      typeof value === "string" && !configKeys.has(canonicalizeConfigKey(key))
    ) {
      warn(
        `Ignoring invalid rule: Unknown preset reference ${value} in ${key}`,
      );
      delete rules[key];
    }
  }

  return { configs, rules, rawRules, baseConfigs, useShippedConfigs };
}

export class ConfigManager {
  constructor(settings, logger, onChange = null) {
    this._settings = settings;
    this._logger = logger;
    this._interfaceSettings = new Gio.Settings({
      schema_id: "org.gnome.desktop.interface",
    });
    this._onChange = onChange;

    ensureSchemaVersion(this._settings);
    this._settings.connectObject(
      "changed",
      (_settings, key) => this._onSettingsChanged(key),
      this,
    );
    this._interfaceSettings.connectObject(
      "changed::accent-color",
      () => this._onSettingsChanged("accent-color"),
      this,
    );

    this._loadConfig();
  }

  getConfigForWindow(metaWindow) {
    const appId = boundedIdentity(metaWindow.get_gtk_application_id?.());
    const wmClass = boundedIdentity(metaWindow.get_wm_class?.());
    const exactMatch = this.appConfigs[`app:${appId.toLowerCase()}`] ||
      this.appConfigs[`class:${wmClass.toLowerCase()}`];
    if (exactMatch) return exactMatch;

    for (const { target, matcher, config } of this._regexConfigs) {
      const value = target === "app" ? appId : wmClass;
      if (value && matcher.match(value, GLib.RegexMatchFlags.DEFAULT)[0]) {
        return config;
      }
    }
    return this.defaults;
  }

  destroy() {
    this._settings.disconnectObject(this);
    this._interfaceSettings.disconnectObject(this);
    this._onChange = null;
  }

  _onSettingsChanged(changeType) {
    if (changeType === "schema-version") return;
    const property = {
      "modal-enabled": "modalEnabled",
      "verbose-logging": "verboseLogging",
    }[changeType];
    if (property) {
      this.globalConfig[property] = this._settings.get_boolean(changeType);
    } else this._loadConfig();
    this._onChange?.(changeType);
  }

  _loadConfig() {
    this.globalConfig = {
      radiusEnabled: this._settings.get_boolean("radius-enabled"),
      modalEnabled: this._settings.get_boolean("modal-enabled"),
      verboseLogging: this._settings.get_boolean("verbose-logging"),
    };

    const defaults = {
      activeColor: this._getDefaultActiveColor(),
      inactiveColor: safeColor(
        this._settings.get_string("default-inactive-color"),
        DEFAULT_INACTIVE_COLOR,
      ),
      width: this._settings.get_int("default-width"),
      margins: this._settings.get_int("default-margins"),
      radius: this._settings.get_int("default-radius"),
      enabled: this._settings.get_boolean("default-enabled"),
      maximizedBorder: this._settings.get_boolean("default-maximized-borders"),
    };

    const { configs: effectiveConfigs, rules, baseConfigs } =
      readSettingsAppConfigs(this._settings, this._logger);

    this.appConfigs = {};
    this.defaults = this._normalizeConfig(defaults);

    // Resolve presets before normalizing each application config over defaults.
    for (const [key, value] of Object.entries(effectiveConfigs)) {
      if (key.startsWith("@")) continue;
      const resolvedConfig = resolveConfigValue(value, effectiveConfigs);
      this.appConfigs[canonicalizeConfigKey(key)] = this._normalizeConfig({
        ...this.defaults,
        // If an app config is specified, it's now whitelisted.
        enabled: true,
        ...resolvedConfig,
      });
    }

    const regexConfigs = getOrderedRegexConfigs(
      this.appConfigs,
      rules,
      baseConfigs,
    );
    if (regexConfigs.length > MAX_REGEX_CONFIGS) {
      this._logger.warn(
        `Ignoring regexes after the first ${MAX_REGEX_CONFIGS} entries`,
      );
    }
    this._regexConfigs = regexConfigs.slice(0, MAX_REGEX_CONFIGS).map((
      [key, config],
    ) => ({
      target: key.startsWith("regex.app:") ? "app" : "class",
      matcher: compileAppRegex(key.slice(key.indexOf(":") + 1)),
      config,
    }));
  }

  _getDefaultActiveColor() {
    const activeColor = this._settings.get_string("default-active-color");
    const solidAccent = activeColor === "auto-solid";
    if (activeColor !== "auto" && !solidAccent) {
      return safeColor(activeColor, DEFAULT_ACTIVE_COLOR);
    }

    // 'accent-color' was introduced in GNOME 47.
    // Older versions (45/46) may not have this key in the schema.
    if (this._interfaceSettings.settings_schema.has_key("accent-color")) {
      return solidAccent
        ? "-st-accent-color"
        : "st-transparentize(-st-accent-color, 0.6)";
    }

    return solidAccent ? DEFAULT_SOLID_ACTIVE_COLOR : DEFAULT_ACTIVE_COLOR;
  }

  _normalizeConfig(config = {}) {
    return {
      ...config,
      activeColor: safeColor(config.activeColor, DEFAULT_ACTIVE_COLOR),
      inactiveColor: safeColor(config.inactiveColor, DEFAULT_INACTIVE_COLOR),
      width: normalizeWidth(config.width),
      margins: normalizeMargins(config.margins),
      radius: this.globalConfig.radiusEnabled
        ? normalizeRadius(config.radius)
        : normalizeRadius(0),
    };
  }
}

const REGEX_MATCH_LIMIT = 10000;
const REGEX_DEPTH_LIMIT = 1000;
const REGEX_FLAGS = GLib.RegexCompileFlags.CASELESS |
  GLib.RegexCompileFlags.OPTIMIZE;
const REGEX_VALIDATION = { validateRegex: compileAppRegex };

function compileAppRegex(pattern) {
  // Preserve the existing JavaScript syntax contract, then use PCRE's match
  // budget so a pathological rule cannot hold the Shell thread indefinitely.
  new RegExp(pattern);
  return GLib.Regex.new(
    `(*LIMIT_MATCH=${REGEX_MATCH_LIMIT})` +
      `(*LIMIT_DEPTH=${REGEX_DEPTH_LIMIT})(?:${pattern})`,
    REGEX_FLAGS,
    GLib.RegexMatchFlags.DEFAULT,
  );
}

function safeColor(value, fallback) {
  return isSafeCssColor(value) ? value.trim() : fallback;
}

function boundedIdentity(value) {
  return typeof value === "string" && value.length <= MAX_MATCH_VALUE_LENGTH
    ? value
    : "";
}
