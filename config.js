// config.js

import Gio from "gi://Gio";
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

    // Connect to settings changes
    this._settings.connectObject(
      "changed",
      () => this._reloadConfig("settings-changed"),
      this,
    );

    // Connect to accent color changes
    this._interfaceSettings.connectObject(
      "changed::accent-color",
      () => this._reloadConfig("accent-color"),
      this,
    );

    // Initialize config from gsettings or set defaults
    this.appConfigFallback = {};
    this._init();
    // Check for first run and save defaults if needed (after defaults are loaded)
    this._ensureDefaultsSaved();
  }

  _init() {
    // Load boolean settings
    this.radiusEnabled = this._settings.get_boolean("radius-enabled");
    this.modalEnabled = this._settings.get_boolean("modal-enabled");
    this.verboseLogging = this._settings.get_boolean("verbose-logging");
    const globalConfig = {
      radiusEnabled: this.radiusEnabled,
      modalEnabled: this.modalEnabled,
      verboseLogging: this.verboseLogging,
    };
    this.globalConfig = globalConfig;

    // Update fallback config from all current settings
    this.appConfigFallback.activeColor = this._getAccentColor();
    this.appConfigFallback.inactiveColor = this._settings.get_string(
      "default-inactive-color",
    );
    this.appConfigFallback.width = this._settings.get_int("default-width");
    this.appConfigFallback.margins = this._settings.get_int("default-margins");
    this.appConfigFallback.radius = this._settings.get_int("default-radius");
    this.appConfigFallback.enabled = this._settings.get_boolean(
      "default-enabled",
    );
    this.appConfigFallback.maximizedBorder = this._settings.get_boolean(
      "default-maximized-borders",
    );

    // Load app configs from gsettings
    const savedConfigs = this._settings.get_string("app-configs");
    this._savedAppConfigs = {};
    if (savedConfigs && savedConfigs !== "{}") {
      try {
        this._savedAppConfigs = JSON.parse(savedConfigs);
      } catch (error) {
        this._logger.warn("Failed to parse saved app configs:", error);
        this._savedAppConfigs = this._fallbackAppConfig();
      }
    }
    if (!this._savedAppConfigs || typeof this._savedAppConfigs !== "object") {
      this._savedAppConfigs = {};
    }

    // Build normalized app configs
    const resolvedConfigs = this._resolvePresets(this._savedAppConfigs);
    this.appConfigs = {};

    // Create @default config by merging with fallback
    const defaultRawConfig = this._savedAppConfigs["@default"] || {};
    const defaultConfig = this.normalizeConfig(
      {
        ...this.appConfigFallback,
        ...defaultRawConfig,
      },
      globalConfig,
    );
    this.appConfigs["@default"] = defaultConfig;

    // Normalize all other configs using @default as base
    for (const [key, rawConfig] of Object.entries(resolvedConfigs)) {
      if (!key.startsWith("@")) {
        const normalized = this.normalizeConfig(
          {
            ...defaultConfig,
            ...{ enabled: true },
            ...rawConfig,
          },
          globalConfig,
        );
        const configKey = key.startsWith("regex.") ? key : key.toLowerCase();
        this.appConfigs[configKey] = normalized;
      }
    }
  }

  _fallbackAppConfig() {
    // If no saved configs, we use the fallback which also
    // happen to be defaults here. We have it in code instead
    // of file to avoid unnecessary json read, as it's meant
    // to be the infallible fallback. This should only happen
    // on first run, and then gsettings should be the single
    // source of truth.
    return {
      "@default": { width: 3 },
      // Presets
      "@zeroPreset": { maximizedBorder: true },
      "@zeroNoMaxPreset": { maximizedBorder: false },
      "@adwPreset": {
        radius: 18,
      },
      "@gtkPreset": {
        radius: { tl: 10, tr: 10, br: 0, bl: 0 },
      },
      "@qtPreset": {
        radius: { tl: 18, tr: 18, br: 0, bl: 0 },
      },
      "@chromePreset": {
        radius: { tl: 12, tr: 12, br: 0, bl: 0 },
      },
      "@chromeGtkPreset": {
        radius: { tl: 10, tr: 10, br: 0, bl: 0 },
      },
      "@zedPreset": {
        margins: { right: -1, bottom: -1 },
        radius: { tl: 14, tr: 14, br: 10, bl: 10 }
      },
      // Adw
      "regex.class:^org.gnome.*": "@adwPreset",
      // "regex.class:^org.freedesktop.*": "@adwPreset",
      "class:com.github.tchx84.Flatseal": "@adwPreset",
      "class:simple-scan": "@adwPreset",
      "class:re.sonny.Workbench": "@adwPreset",
      "class:com.mattjakeman.ExtensionManager": "@adwPreset",
      "class:com.mitchellh.ghostty": "@adwPreset",
      // Gtk
      "class:org.gnome.Terminal": "@gtkPreset",
      "class:org.gnome.seahorse.Application": "@gtkPreset",
      "class:org.gnome.Connections": "@gtkPreset",
      "class:firefox": "@gtkPreset",
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
      "class:gnome-power-statistics": "@gtkPreset",
      "class:cheese": "@gtkPreset",
      "class:solaar": "@gtkPreset",
      "class:com.github.xournalpp.xournalpp": "@gtkPreset",
      "class:gnome-disks": "@gtkPreset",
      // "class:org.pulseaudio.pavucontrol": "@gtkPreset",
      // Chrome
      "regex.class:^google-chrome*": "@chromePreset",
      // Chrome apps
      "regex.class:^chrome-*": "@chromePreset",
      // Chromium
      "regex.class:^chromium*": "@chromePreset",
      // Electron
      "class:obsidian": "@zeroPreset",
      "class:zulip": "@zeroPreset",
      "class:slack": "@zeroPreset",
      "class:code": "@zeroPreset",
      "class:antigravity": "@zeroPreset",
      "class:spotify": "@zeroPreset",
      "class:discord": "@zeroPreset",
      // Qt
      "class:vlc": "@qtPreset",
      "class:krita": "@qtPreset",
      "class:qpwgraph": "@qtPreset",
      // Others
      "class:dev.zed.Zed": "@zedPreset",
      "class:mpv": "@zeroPreset",
      // Custom
      "class:foot": "@zeroPreset",
      "class:footclient": "@zeroPreset",
      "class:Alacritty": {
        radius: { tl: 12, tr: 12 },
        maximizedBorder: true,
      },
      "class:gnome-disks": {
        radius: { tl: 10, tr: 10, br: 11, bl: 11 }
      }
    };
  }

  _ensureDefaultsSaved() {
    // Check if this is the first run by looking at config-version
    const configVersion = this._settings.get_int("config-version");
    const currentRevision = 5;

    if (configVersion < currentRevision) {
      // First run - save all default values to make them visible in dconf-editor
      this._logger.log(
        "First run detected, saving default configuration values",
      );

      const boolKeys = [
        "radius-enabled",
        "default-maximized-borders",
        "default-enabled",
        "modal-enabled",
        "verbose-logging",
      ];
      for (const key of boolKeys) {
        this._settings.set_boolean(key, this._settings.get_boolean(key));
      }

      const intKeys = ["default-margins", "default-radius", "default-width"];
      for (const key of intKeys) {
        this._settings.set_int(key, this._settings.get_int(key));
      }

      const stringKeys = ["default-active-color", "default-inactive-color"];
      for (const key of stringKeys) {
        this._settings.set_string(key, this._settings.get_string(key));
      }

      this._settings.set_string(
        "app-configs",
        JSON.stringify(this._fallbackAppConfig()),
      );

      // Update config version to indicate defaults have been saved
      this._settings.set_int("config-version", currentRevision);

      this._logger.log("Default configuration values saved to dconf");
    }
  }

  _getAccentColor() {
    // Custom color that works well for all dark and light themes
    const defaultAccent = "rgba(51, 153, 230, 0.4)";

    // Check if we should use auto accent color
    const activeColor = this._settings.get_string("default-active-color");
    if (activeColor !== "auto") {
      return activeColor;
    }

    // 'accent-color' was introduced in GNOME 47.
    // Older versions (45/46) may not have this key in the schema.
    if (this._interfaceSettings.settings_schema.has_key("accent-color")) {
      const accentColor = this._interfaceSettings.get_string("accent-color");

      // Map GNOME accent colors to RGBA values with alpha 0.4
      const accentColorMap = {
        blue: "rgba(53, 132, 228, 0.4)",
        teal: "rgba(51, 209, 122, 0.4)",
        green: "rgba(46, 194, 126, 0.4)",
        yellow: "rgba(248, 228, 92, 0.4)",
        orange: "rgba(255, 120, 0, 0.4)",
        red: "rgba(237, 51, 59, 0.4)",
        pink: "rgba(224, 27, 36, 0.4)",
        purple: "rgba(145, 65, 172, 0.4)",
        slate: "rgba(99, 104, 128, 0.4)",
      };

      return accentColorMap[accentColor] || defaultAccent;
    }

    return defaultAccent;
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
   * Save app configurations to gsettings
   * @param {Object} configs - The app configurations to save
   */
  saveAppConfigs(configs) {
    this._settings.set_string("app-configs", JSON.stringify(configs));
    this._init();
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
    // First, extract all presets (keys starting with @)
    const presets = {};
    const appConfigs = {};

    for (const [key, value] of Object.entries(rawConfigs)) {
      if (key.startsWith("@")) {
        presets[key] = value;
      } else {
        appConfigs[key] = value;
      }
    }

    // Resolve preset references in app configs
    const resolvedConfigs = {};
    for (const [key, value] of Object.entries(appConfigs)) {
      if (typeof value === "string" && value.startsWith("@")) {
        // This is a preset reference
        const presetConfig = presets[value];
        if (presetConfig !== undefined) {
          resolvedConfigs[key] = presetConfig;
        } else {
          this._logger.warn(`Unknown preset reference: ${value} for ${key}`);
          resolvedConfigs[key] = {};
        }
      } else {
        // Regular config object
        resolvedConfigs[key] = value;
      }
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
    for (const [key, config] of Object.entries(this.appConfigs)) {
      if (key === "@default" || !key.startsWith("regex.")) continue;

      if (
        key.startsWith("regex.app:") &&
        appId &&
        this._matches(appId, key.slice(11))
      ) {
        return config;
      }
      if (
        key.startsWith("regex.class:") &&
        wmClass &&
        this._matches(wmClass, key.slice(13))
      ) {
        return config;
      }
    }

    return this.appConfigs["@default"];
  }

  _matches(text, pattern) {
    try {
      return new RegExp(pattern, "i").test(text);
    } catch {
      return false; // Invalid regex patterns don"t match
    }
  }

  normalizeConfig(config = {}, globalConfig = {}) {
    const radiusEnabled = globalConfig.radiusEnabled ?? true;
    return {
      ...config,
      margins: this.normalizeMargins(config.margins),
      radius: radiusEnabled
        ? this.normalizeRadius(config.radius)
        : { tl: 0, tr: 0, br: 0, bl: 0 },
    };
  }

  normalizeMargins(margins) {
    if (typeof margins === "number") {
      const value = margins | 0;
      return { top: value, right: value, bottom: value, left: value };
    }

    return {
      top: (margins?.top ?? 0) | 0,
      right: (margins?.right ?? 0) | 0,
      bottom: (margins?.bottom ?? 0) | 0,
      left: (margins?.left ?? 0) | 0,
    };
  }

  normalizeRadius(radius) {
    if (typeof radius === "number") {
      const value = Math.max(0, radius | 0);
      return { tl: value, tr: value, br: value, bl: value };
    }

    return {
      tl: Math.max(0, (radius?.tl ?? 0) | 0),
      tr: Math.max(0, (radius?.tr ?? 0) | 0),
      br: Math.max(0, (radius?.br ?? 0) | 0),
      bl: Math.max(0, (radius?.bl ?? 0) | 0),
    };
  }
}
