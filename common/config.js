// config.js

import Gio from "gi://Gio";
import {
  BASE_APP_CONFIGS,
  buildEffectiveAppConfigs,
  canonicalizeConfigKey,
  findEquivalentConfigKey,
  getConfigMapError,
  getOrderedRegexConfigs,
  isSafeCssColor,
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
const DEFAULT_INACTIVE_COLOR = "rgba(102, 102, 102, 0.2)";

function safeColor(value, fallback) {
  return isSafeCssColor(value) ? value.trim() : fallback;
}

export function getSettingsBaseConfigs(settings) {
  return settings.get_boolean(USE_SHIPPED_CONFIGS_KEY) ? BASE_APP_CONFIGS : {};
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

export function getSettingsRules(settings) {
  return parseConfigJson(settings.get_string(RULES_KEY));
}

export function setSettingsRules(settings, rules) {
  if (Object.keys(rules).length > 0) {
    settings.set_string(RULES_KEY, JSON.stringify(rules));
  } else {
    settings.reset(RULES_KEY);
  }
}

export function readSettingsAppConfigs(settings, logger = null) {
  const baseConfigs = getSettingsBaseConfigs(settings);
  const rules = {};
  for (const [key, value] of Object.entries(getSettingsRules(settings))) {
    const equivalentKey = findEquivalentConfigKey(rules, key);
    const error = equivalentKey
      ? `Duplicate exact-match config keys: ${equivalentKey} and ${key}`
      : getConfigMapError({ [key]: value }, {
        allowTombstones: true,
        validateReferences: false,
      });
    if (error) {
      logger?.warn(`Ignoring invalid rule: ${error}`);
    } else {
      rules[key] = value;
    }
  }

  const configs = buildEffectiveAppConfigs(rules, baseConfigs);
  for (const [key, value] of Object.entries(rules)) {
    if (typeof value === "string" && !Object.hasOwn(configs, key)) {
      logger?.warn(
        `Ignoring invalid rule: Unknown preset reference ${value} in ${key}`,
      );
      delete rules[key];
    }
  }
  return { configs, rules, baseConfigs };
}

export class ConfigManager {
  constructor(settings, logger) {
    // Use the settings object provided by Extension.getSettings()
    this._settings = settings;
    this._logger = logger;

    // Interface settings for accent color detection
    this._interfaceSettings = new Gio.Settings({
      schema_id: "org.gnome.desktop.interface",
    });

    // Callbacks for config changes
    this._configChangeCallbacks = new Set();

    ensureSchemaVersion(this._settings);

    // Connect to settings changes
    this._settings.connectObject(
      "changed",
      (_settings, key) => this._reloadConfig(key),
      this,
    );

    // Connect to accent color changes
    this._interfaceSettings.connectObject(
      "changed::accent-color",
      () => this._reloadConfig("accent-color"),
      this,
    );

    this._init();
  }

  _init() {
    // Get the pure global configs into globalConfig. The rest that
    // go into each app config is pulled directly by defauls below.
    const radiusEnabled = this._settings.get_boolean("radius-enabled");
    const modalEnabled = this._settings.get_boolean("modal-enabled");
    const verboseLogging = this._settings.get_boolean("verbose-logging");
    this.globalConfig = {
      radiusEnabled,
      modalEnabled,
      verboseLogging,
    };

    // Update default config from the current settings
    const defaults = {
      activeColor: this._getDefaultActiveOrAccentColor(),
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

    const { configs: rawConfigs, rules, baseConfigs } = readSettingsAppConfigs(
      this._settings,
      this._logger,
    );

    // Build normalized app configs
    const resolvedConfigs = this._resolvePresets(rawConfigs);
    this.appConfigs = {};

    // Create default config
    this.defaults = this._normalizeConfig(defaults);
    const defaultConfig = this.defaults;

    // Normalize all other configs using default as base
    for (const [key, rawConfig] of Object.entries(resolvedConfigs)) {
      if (!key.startsWith("@")) {
        const normalized = this._normalizeConfig(
          {
            ...defaultConfig,
            // If an app config is specified, it's now whitelisted
            enabled: true,
            ...rawConfig,
          },
        );
        const configKey = canonicalizeConfigKey(key);
        this.appConfigs[configKey] = normalized;
      }
    }

    this._regexConfigs = getOrderedRegexConfigs(
      this.appConfigs,
      rules,
      baseConfigs,
    ).map(([key, config]) => ({
      target: key.startsWith("regex.app:") ? "app" : "class",
      matcher: new RegExp(key.slice(key.indexOf(":") + 1), "i"),
      config,
    }));
  }

  _getDefaultActiveOrAccentColor() {
    // Custom color that works well for all dark and light themes
    // Check if we should use auto accent color
    const activeColor = this._settings.get_string("default-active-color");
    if (activeColor !== "auto") {
      return safeColor(activeColor, DEFAULT_ACTIVE_COLOR);
    }

    // 'accent-color' was introduced in GNOME 47.
    // Older versions (45/46) may not have this key in the schema.
    if (this._interfaceSettings.settings_schema.has_key("accent-color")) {
      return "-st-accent-color";
    }

    return DEFAULT_ACTIVE_COLOR;
  }

  // --- GSettings change handling -----------------------------------------

  _reloadConfig(changeType) {
    this._init();
    this._notifyConfigChange(changeType);
  }

  _notifyConfigChange(changeType) {
    for (const callback of this._configChangeCallbacks) {
      callback(changeType);
    }
  }

  // --- Public API for dynamic updates ------------------------------------

  /**
   * Add a callback to be called when configuration changes
   * @param {Function} callback - Function to call on config changes
   */
  addConfigChangeListener(callback) {
    this._configChangeCallbacks.add(callback);
  }

  /**
   * Remove a config change callback
   * @param {Function} callback - The callback to remove
   */
  removeConfigChangeListener(callback) {
    this._configChangeCallbacks.delete(callback);
  }

  /**
   * Clean up resources
   */
  destroy() {
    // Disconnect settings signals
    this._settings.disconnectObject(this);
    this._interfaceSettings.disconnectObject(this);
    this._configChangeCallbacks.clear();
  }

  _resolvePresets(rawConfigs = {}) {
    const resolvedConfigs = {};
    for (const [key, value] of Object.entries(rawConfigs)) {
      if (key.startsWith("@")) continue;
      resolvedConfigs[key] = resolveConfigValue(value, rawConfigs);
    }

    return resolvedConfigs;
  }

  getConfigForWindow(metaWindow) {
    const appId = metaWindow.get_gtk_application_id?.() || "";
    const wmClass = metaWindow.get_wm_class?.() || "";

    // Try exact matches first
    const exactMatch = this.appConfigs[`app:${appId.toLowerCase()}`] ||
      this.appConfigs[`class:${wmClass.toLowerCase()}`];

    if (exactMatch) return exactMatch;

    // Try pattern matches
    for (const { target, matcher, config } of this._regexConfigs) {
      const value = target === "app" ? appId : wmClass;
      if (value && matcher.test(value)) return config;
    }
    return this.defaults;
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
        : { tl: 0, tr: 0, br: 0, bl: 0 },
    };
  }
}
