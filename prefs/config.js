import GLib from "gi://GLib";

import {
  canonicalizeConfigKey,
  copyConfig,
  deriveAppConfigRules,
  findEquivalentConfigKey,
  MAX_REGEX_RULES,
  RULES_KEY,
} from "../common/appconfig.js";
import {
  getSettingsConfigMapError,
  getSettingsRulesError,
  readSettingsAppConfigs,
  setSettingsRules,
  USE_SHIPPED_CONFIGS_KEY,
} from "../common/config.js";

export class PreferencesConfigStore {
  constructor(
    settings,
    {
      saveDelayMs = 150,
      onError = (error) => console.error(error),
    } = {},
  ) {
    this._settings = settings;
    this._saveDelayMs = saveDelayMs;
    this._listeners = new Set();
    this._pendingSave = null;
    this._writing = false;
    this._onError = onError;

    this._reload();
    this._changedId = settings.connect(
      "changed",
      (_settings, key) => this._onChanged(key),
    );
  }

  get baseConfigs() {
    return this._baseConfigs;
  }

  get configs() {
    return copyConfig(this._configs);
  }

  getBaseConfig(key) {
    const baseKey = findEquivalentConfigKey(this.baseConfigs, key);
    return baseKey ? copyConfig(this.baseConfigs[baseKey]) : {};
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  updateConfigs(updater, source = null, debounced = false) {
    const configs = copyConfig(this._configs);
    if (updater(configs) === false) return false;

    const rules = this._getUpdatedRules(configs);
    this._requireWritable(RULES_KEY);
    this._configs = configs;
    if (debounced) this._scheduleSave(rules, source);
    else this._writeRules(rules, source);
    return true;
  }

  replaceRules(rules, source = null) {
    this._writeRules(this._requireValidRules(rules), source);
  }

  getRulesForConfigs(configs) {
    return this._requireValidRules(
      deriveAppConfigRules(configs, this.baseConfigs),
    );
  }

  replaceConfigs(configs, source = null) {
    const rules = this.getRulesForConfigs(configs);
    this._writeRules(rules, source);
    return rules;
  }

  setUseShippedConfigs(enabled, source = null) {
    if (enabled === this.useShippedConfigs) return;
    this.flush();

    this._writeSetting(
      USE_SHIPPED_CONFIGS_KEY,
      source,
      () => this._settings.set_boolean(USE_SHIPPED_CONFIGS_KEY, enabled),
    );
  }

  flush() {
    const pending = this._cancelScheduledSave();
    if (pending) this._writeRules(this.rules, pending.source);
  }

  destroy() {
    // A final flush may reload the store, but closing UI must not be notified.
    this._listeners.clear();
    this._settings.disconnect(this._changedId);
    try {
      this.flush();
    } catch (error) {
      // The preferences window is already closing; report without touching UI.
      console.error(error);
    }
  }

  _getUpdatedRules(configs) {
    // Effective configs omit disabled-base tombstones and references. Replace
    // visible identities in place while retaining untouched raw rule order.
    const activeKeys = new Set(
      [...Object.keys(this._configs), ...Object.keys(configs)].map(
        canonicalizeConfigKey,
      ),
    );
    const updates = this.getRulesForConfigs(configs);
    const updateKeys = new Map(
      Object.keys(updates).map((key) => [canonicalizeConfigKey(key), key]),
    );
    const rules = {};
    for (const [key, value] of Object.entries(this.rules)) {
      const identity = canonicalizeConfigKey(key);
      const updateKey = updateKeys.get(identity);
      if (updateKey) {
        rules[updateKey] = updates[updateKey];
        updateKeys.delete(identity);
      } else if (!activeKeys.has(identity)) {
        rules[key] = copyConfig(value);
      }
    }
    for (const key of updateKeys.values()) rules[key] = updates[key];

    const error = getSettingsConfigMapError(rules, {
      allowTombstones: true,
      validateReferences: false,
      maxRegexes: MAX_REGEX_RULES,
    });
    if (error) throw new Error(error);
    return rules;
  }

  _scheduleSave(rules, source) {
    this._cancelScheduledSave();
    this.rules = rules;
    const pending = { source, id: 0 };
    this._pendingSave = pending;
    pending.id = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      this._saveDelayMs,
      () => {
        if (this._pendingSave !== pending) return GLib.SOURCE_REMOVE;
        this._pendingSave = null;
        // A GLib source cannot return a write failure to the initiating widget.
        // Report it here so the asynchronous exception does not escape the loop.
        try {
          this._writeRules(this.rules, pending.source);
        } catch (error) {
          this._onError(error);
        }
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  _cancelScheduledSave() {
    const pending = this._pendingSave;
    if (!pending) return null;
    GLib.source_remove(pending.id);
    this._pendingSave = null;
    return pending;
  }

  _writeRules(rules, source) {
    this._cancelScheduledSave();
    this._writeSetting(
      RULES_KEY,
      source,
      () => setSettingsRules(this._settings, rules),
    );
  }

  _requireValidRules(rules) {
    const error = getSettingsRulesError(rules, this.baseConfigs);
    if (error) throw new Error(error);
    return rules;
  }

  _requireWritable(key) {
    if (!this._settings.is_writable(key)) {
      throw new Error(`Setting is not writable: ${key}`);
    }
  }

  _writeSetting(key, source, setter) {
    let writeSucceeded = false;
    this._writing = true;
    try {
      this._requireWritable(key);
      if (setter() === false) {
        throw new Error(`Failed to write setting: ${key}`);
      }
      writeSucceeded = true;
    } finally {
      this._writing = false;
      // A failed write may follow an optimistic edit. Always reload the
      // authoritative backend, but only attribute successful local writes.
      this._reload(writeSucceeded ? source : null);
    }
  }

  _onChanged(key) {
    if (key !== RULES_KEY && key !== USE_SHIPPED_CONFIGS_KEY) return;
    if (this._writing) return;
    this._cancelScheduledSave();
    this._reload();
  }

  _reload(source = null) {
    const state = readSettingsAppConfigs(this._settings);
    this.useShippedConfigs = state.useShippedConfigs;
    this._baseConfigs = state.baseConfigs;
    this.rules = state.rawRules;
    this._configs = state.configs;
    for (const listener of this._listeners) {
      listener({
        configs: this.configs,
        rules: this.rules,
        source,
        useShippedConfigs: this.useShippedConfigs,
      });
    }
  }
}
