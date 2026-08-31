import GLib from "gi://GLib";

import { deriveAppConfigRules, RULES_KEY } from "./appconfig.js";
import {
  getSettingsBaseConfigs,
  getSettingsRules,
  readSettingsAppConfigs,
  setSettingsRules,
  USE_SHIPPED_CONFIGS_KEY,
} from "./config.js";

export class PreferencesConfigStore {
  constructor(settings, saveDelayMs = 150) {
    this._settings = settings;
    this._saveDelayMs = saveDelayMs;
    this._listeners = new Set();
    this._saveSource = null;
    this._timeoutId = 0;
    this._rulesWrite = null;
    this._modeWrite = null;

    this._reload();
    this._rulesChangedId = settings.connect(
      `changed::${RULES_KEY}`,
      () => this._onRulesChanged(),
    );
    this._modeChangedId = settings.connect(
      `changed::${USE_SHIPPED_CONFIGS_KEY}`,
      () => this._onModeChanged(),
    );
  }

  get baseConfigs() {
    return getSettingsBaseConfigs(this._settings);
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  save(source = null) {
    this._cancelScheduledSave();
    const rules = deriveAppConfigRules(this.configs, this.baseConfigs);
    this._writeRules(rules, source);
  }

  scheduleSave(source = null) {
    this._cancelScheduledSave();
    this._saveSource = source;
    this._timeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      this._saveDelayMs,
      () => {
        this._timeoutId = 0;
        const saveSource = this._saveSource;
        this._saveSource = null;
        this.save(saveSource);
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  replaceRules(rules, source = null) {
    this._cancelScheduledSave();
    this._writeRules(rules, source);
  }

  setUseShippedConfigs(enabled, source = null) {
    if (enabled === this.useShippedConfigs) return;
    this.flush();

    const write = { enabled, source };
    this._modeWrite = write;
    this._settings.set_boolean(USE_SHIPPED_CONFIGS_KEY, enabled);
    if (this._modeWrite === write) {
      this._modeWrite = null;
      this._reload(source);
    }
  }

  flush() {
    if (!this._timeoutId) return;
    GLib.source_remove(this._timeoutId);
    this._timeoutId = 0;
    const source = this._saveSource;
    this._saveSource = null;
    this.save(source);
  }

  destroy() {
    this.flush();
    this._settings.disconnect(this._rulesChangedId);
    this._settings.disconnect(this._modeChangedId);
    this._listeners.clear();
  }

  _cancelScheduledSave() {
    if (this._timeoutId) GLib.source_remove(this._timeoutId);
    this._timeoutId = 0;
    this._saveSource = null;
  }

  _writeRules(rules, source) {
    const write = { json: JSON.stringify(rules), source };
    this._rulesWrite = write;
    setSettingsRules(this._settings, rules);
    if (this._rulesWrite === write) {
      this._rulesWrite = null;
      this.rules = rules;
    }
  }

  _onRulesChanged() {
    const storedRules = getSettingsRules(this._settings);
    const write = this._rulesWrite;
    const ownWrite = write?.json === JSON.stringify(storedRules);
    this._rulesWrite = null;
    if (!ownWrite) this._cancelScheduledSave();
    this._reload(ownWrite ? write.source : null);
  }

  _onModeChanged() {
    const enabled = this._settings.get_boolean(USE_SHIPPED_CONFIGS_KEY);
    const write = this._modeWrite;
    const ownWrite = write?.enabled === enabled;
    this._modeWrite = null;
    if (!ownWrite) this._cancelScheduledSave();
    this._reload(ownWrite ? write.source : null);
  }

  _reload(source = null) {
    this.useShippedConfigs = this._settings.get_boolean(
      USE_SHIPPED_CONFIGS_KEY,
    );
    this.rules = getSettingsRules(this._settings);
    this.configs = readSettingsAppConfigs(this._settings).configs;
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
