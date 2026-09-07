import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gdk from "gi://Gdk";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";

import {
  copyConfig,
  findEquivalentConfigKey,
  isConfigObject,
  MAX_BORDER_MARGIN,
  MAX_BORDER_RADIUS,
  MAX_BORDER_WIDTH,
  MAX_CONFIG_FILE_SIZE,
  normalizeMargins,
  normalizeRadius,
  parseConfigJson,
} from "../common/appconfig.js";
import {
  ensureSchemaVersion,
  getSettingsConfigMapError,
  getSettingsFullConfigError,
} from "../common/config.js";
import { PreferencesConfigStore } from "./config.js";

Gio._promisify(
  Gio.File.prototype,
  "query_info_async",
  "query_info_finish",
);
Gio._promisify(
  Gio.File.prototype,
  "load_contents_async",
  "load_contents_finish",
);
Gio._promisify(
  Gio.File.prototype,
  "replace_contents_async",
  "replace_contents_finish",
);

const CUSTOM_LABEL = "Custom";
const APP_CONFIG_SOURCE = {};
const PRESET_SOURCE = {};
const RAW_CONFIG_SOURCE = {};

export function fillPreferencesWindow(window, settings) {
  ensureSchemaVersion(settings);
  const configStore = new PreferencesConfigStore(settings, {
    onError: (error) => showToast(window, `Save failed: ${error.message}`),
  });
  window.connect("destroy", () => configStore.destroy());
  window.set_default_size(760, 640);
  window.add(buildGlobalPage(window, settings, configStore));
  window.add(buildPresetsPage(window, configStore));
  window.add(buildConfigsPage(window, configStore));
  window.add(buildRawConfigPage(window, configStore));
}

function bindSetting(settings, key, object, property) {
  settings.bind(key, object, property, Gio.SettingsBindFlags.DEFAULT);
}

function bindAppliedTextSetting(window, settings, key, row) {
  settings.bind(key, row, "text", Gio.SettingsBindFlags.GET);
  row.show_apply_button = true;
  row.connect("apply", () => {
    if (
      tryAction(window, () => {
        if (!settings.set_string(key, row.text)) {
          throw new Error(`Failed to write setting: ${key}`);
        }
      })
    ) return;

    // A rejected write must not leave an unapplied value in the editor.
    row.text = settings.get_string(key);
  });
}

function formatRgba(rgba) {
  const r = Math.round(rgba.red * 255);
  const g = Math.round(rgba.green * 255);
  const b = Math.round(rgba.blue * 255);
  const alpha = Math.round(rgba.alpha * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function parseRgba(text) {
  if (!text) return null;
  const rgba = new Gdk.RGBA();
  return rgba.parse(text) ? rgba : null;
}

function makeTransparentRgba() {
  const rgba = new Gdk.RGBA();
  rgba.red = 0;
  rgba.green = 0;
  rgba.blue = 0;
  rgba.alpha = 0;
  return rgba;
}

function attachColorPicker(row) {
  const dialog = new Gtk.ColorDialog({ with_alpha: true });
  const button = new Gtk.ColorDialogButton({ dialog });
  row.add_suffix(button);
  row.activatable_widget = button;

  let syncing = false;

  const syncButtonFromText = () => {
    const rgba = parseRgba(row.text.trim());
    syncing = true;
    button.rgba = rgba || makeTransparentRgba();
    syncing = false;
  };

  row.connect("notify::text", () => {
    if (syncing) return;
    syncButtonFromText();
  });

  button.connect("notify::rgba", () => {
    if (syncing) return;
    syncing = true;
    row.text = formatRgba(button.rgba);
    syncing = false;
  });

  syncButtonFromText();
}

function createColorRow(title, placeholder) {
  const row = new Adw.EntryRow({ title });
  row.get_delegate().set_placeholder_text(placeholder);
  attachColorPicker(row);
  return row;
}

function createSpinRow({ title, subtitle, lower, upper, step = 1 }) {
  const params = {
    title,
    adjustment: new Gtk.Adjustment({
      lower,
      upper,
      step_increment: step,
    }),
  };

  if (subtitle !== undefined) params.subtitle = subtitle;

  return new Adw.SpinRow(params);
}

function createNumberStrip(title, labels, lower, upper) {
  const row = new Adw.PreferencesRow();
  const layout = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 8,
    margin_top: 12,
    margin_bottom: 12,
    margin_start: 16,
    margin_end: 16,
  });
  layout.append(new Gtk.Label({ label: title, xalign: 0 }));

  const grid = new Gtk.Grid({
    column_spacing: 16,
    row_spacing: 8,
    column_homogeneous: true,
  });
  const controls = {};

  for (const [index, [key, label]] of labels.entries()) {
    const item = new Gtk.Box({
      spacing: 4,
      valign: Gtk.Align.CENTER,
    });
    item.append(new Gtk.Label({ label }));
    const control = new Gtk.SpinButton({
      adjustment: new Gtk.Adjustment({
        lower,
        upper,
        step_increment: 1,
      }),
      numeric: true,
      width_chars: 3,
    });
    controls[key] = control;
    item.append(control);
    grid.attach(item, index % 2, Math.floor(index / 2), 1, 1);
  }

  layout.append(grid);
  row.set_child(layout);
  return { row, controls };
}

function showToast(window, title) {
  window.add_toast(new Adw.Toast({ title }));
}

function tryAction(window, action, label = null) {
  // GTK signal handlers have no caller that can present synchronous settings
  // failures, so keep that user-facing boundary in one place.
  try {
    return action() !== false;
  } catch (error) {
    showToast(
      window,
      label ? `${label} failed: ${error.message}` : error.message,
    );
    return false;
  }
}

async function tryFileAction(window, cancellable, label, action) {
  // File operations are launched from GTK callbacks without awaiting them.
  // Consume rejection here; teardown cancellation is expected and stays silent.
  try {
    await action();
    return true;
  } catch (error) {
    if (!cancellable.is_cancelled()) {
      showToast(window, `${label} failed: ${error.message}`);
    }
    return false;
  }
}

function createConfigUpdater(window, configStore, source) {
  return (updater, debounced = false) =>
    tryAction(
      window,
      () => configStore.updateConfigs(updater, source, debounced),
    );
}

function requireConfigFileSize(size) {
  if (size > MAX_CONFIG_FILE_SIZE) {
    throw new Error(
      `Config file must contain at most ${MAX_CONFIG_FILE_SIZE} bytes`,
    );
  }
}

function createJsonEditor(window, { editable, apply }) {
  const box = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 8,
    hexpand: true,
    vexpand: true,
  });
  const toolbar = new Gtk.Box({
    spacing: 8,
    halign: Gtk.Align.END,
    margin_top: 8,
    margin_end: 8,
  });
  const copyButton = new Gtk.Button({ label: "Copy" });
  toolbar.append(copyButton);
  if (apply) {
    const applyButton = new Gtk.Button({
      label: "Apply Rules",
      css_classes: ["suggested-action"],
    });
    applyButton.connect("clicked", apply);
    toolbar.append(applyButton);
  }
  box.append(toolbar);

  const buffer = new Gtk.TextBuffer();
  const view = new Gtk.TextView({
    buffer,
    editable,
    cursor_visible: editable,
    monospace: true,
    wrap_mode: Gtk.WrapMode.NONE,
    hexpand: true,
    vexpand: true,
    left_margin: 8,
    right_margin: 8,
    top_margin: 8,
    bottom_margin: 8,
  });
  const scroller = new Gtk.ScrolledWindow({
    hexpand: true,
    vexpand: true,
    min_content_height: 340,
  });
  scroller.set_child(view);
  box.append(scroller);

  const getText = () => {
    const start = buffer.get_start_iter();
    const end = buffer.get_end_iter();
    return buffer.get_text(start, end, false);
  };
  copyButton.connect("clicked", () => {
    Gdk.Display.get_default().get_clipboard().set(getText());
    showToast(window, "JSON copied");
  });
  return { box, buffer, getText };
}

function setJsonBuffer(buffer, value) {
  buffer.set_text(JSON.stringify(value, null, 2), -1);
}

function chooseJsonFile(window, action, title, onFile, currentName = null) {
  const chooser = new Gtk.FileChooserNative({
    title,
    transient_for: window,
    modal: true,
    action,
    accept_label: action === Gtk.FileChooserAction.SAVE ? "Export" : "Import",
  });
  const filter = new Gtk.FileFilter();
  filter.set_name("JSON files");
  filter.add_mime_type("application/json");
  filter.add_pattern("*.json");
  chooser.add_filter(filter);
  if (currentName) chooser.set_current_name(currentName);
  chooser.connect("response", (_dialog, response) => {
    const file = response === Gtk.ResponseType.ACCEPT
      ? chooser.get_file()
      : null;
    chooser.destroy();
    if (file) onFile(file);
  });
  chooser.show();
}

async function readConfigFile(file, cancellable) {
  const info = await file.query_info_async(
    Gio.FILE_ATTRIBUTE_STANDARD_SIZE,
    Gio.FileQueryInfoFlags.NONE,
    GLib.PRIORITY_DEFAULT,
    cancellable,
  );
  requireConfigFileSize(info.get_size());

  const [contents] = await file.load_contents_async(cancellable);
  // Recheck the loaded data in case the file changed after its metadata read.
  requireConfigFileSize(contents.length);
  return parseConfigJson(
    new TextDecoder().decode(contents),
    MAX_CONFIG_FILE_SIZE,
  );
}

function createPresetModel(presets) {
  const model = new Gtk.StringList();
  model.append(CUSTOM_LABEL);
  for (const preset of presets) model.append(preset);
  return model;
}

function getConfigKeys(configs, presets = false) {
  return Object.keys(configs)
    .filter((key) => key.startsWith("@") === presets)
    .sort((a, b) => a.localeCompare(b));
}

function getPresetKeys(configs) {
  return getConfigKeys(configs, true);
}

function serializePresets(configs) {
  const presets = getPresetKeys(configs);
  return JSON.stringify(
    Object.fromEntries(presets.map((key) => [key, configs[key]])),
  );
}

function getPresetConfig(configs, presetKey) {
  return isConfigObject(configs[presetKey]) ? configs[presetKey] : {};
}

function getConfigOrigin(rules, key, baseConfigs) {
  if (!findEquivalentConfigKey(rules, key)) return "Built-in";
  return Object.hasOwn(baseConfigs, key) ? "Modified" : "Custom";
}

function getResetTitle(key, type, baseConfigs) {
  return Object.hasOwn(baseConfigs, key)
    ? `Restore built-in ${type}`
    : "Reset rules";
}

function isValidConfigKey(candidate, preset) {
  return Boolean(candidate) &&
    candidate.startsWith("@") === preset &&
    !getSettingsConfigMapError({ [candidate]: {} });
}

function createConfigEditor() {
  const enabled = new Adw.SwitchRow({ title: "Enabled" });
  const width = createSpinRow({
    title: "Border width",
    lower: 0,
    upper: MAX_BORDER_WIDTH,
  });
  const margins = createNumberStrip(
    "Margins",
    [["top", "T"], ["right", "R"], ["bottom", "B"], ["left", "L"]],
    -MAX_BORDER_MARGIN,
    MAX_BORDER_MARGIN,
  );
  const radius = createNumberStrip(
    "Corner radius",
    [["tl", "TL"], ["tr", "TR"], ["bl", "BL"], ["br", "BR"]],
    0,
    MAX_BORDER_RADIUS,
  );
  const activeColor = createColorRow(
    "Active border color",
    "inherit or rgba(...)",
  );
  const inactiveColor = createColorRow(
    "Inactive border color",
    "inherit or rgba(...)",
  );

  const resetRow = new Adw.ActionRow({
    title: "Reset rules",
    subtitle: "Inherit all global defaults",
  });
  const resetButton = new Gtk.Button({ label: "Reset", css_classes: ["flat"] });
  resetRow.add_suffix(resetButton);

  const rows = [
    enabled,
    width,
    margins.row,
    radius.row,
    activeColor,
    inactiveColor,
    resetRow,
  ];

  let syncingFields = false;
  const fields = [];
  const addField = (control, property, read, mutate) => {
    fields.push({
      show: (config) => {
        control[property] = read(config);
      },
      connect: (change) =>
        control.connect(`notify::${property}`, () => change(mutate)),
    });
  };
  addField(enabled, "active", (config) => config.enabled ?? true, (config) => {
    config.enabled = enabled.active;
  });
  addField(width, "value", (config) => config.width ?? 0, (config) => {
    config.width = Math.round(width.value);
  });
  for (
    const [key, strip, normalize] of [
      ["margins", margins, normalizeMargins],
      ["radius", radius, normalizeRadius],
    ]
  ) {
    for (const [name, control] of Object.entries(strip.controls)) {
      addField(
        control,
        "value",
        (config) => normalize(config[key])[name],
        (config) => {
          if (!isConfigObject(config[key])) {
            config[key] = normalize(config[key]);
          }
          config[key][name] = Math.round(control.value);
        },
      );
    }
  }
  for (
    const [key, row] of [
      ["activeColor", activeColor],
      ["inactiveColor", inactiveColor],
    ]
  ) {
    addField(row, "text", (config) => config[key] ?? "", (config) => {
      const text = row.text.trim();
      if (text) config[key] = text;
      else delete config[key];
    });
  }

  function setEditable(editable) {
    for (const row of rows) row.sensitive = editable;
  }

  function applyConfig(config) {
    syncingFields = true;
    for (const field of fields) field.show(config);
    syncingFields = false;
  }

  function connectHandlers({ isEditable, updateConfig, onReset }) {
    resetButton.connect("clicked", () => {
      if (!isEditable()) return;
      onReset();
    });

    for (const field of fields) {
      field.connect((mutate) => {
        if (syncingFields || !isEditable()) return;
        updateConfig(mutate);
      });
    }
  }

  return {
    rows,
    resetRow,
    applyConfig,
    setEditable,
    connectHandlers,
  };
}

function buildConfigRow({
  key,
  window,
  configStore,
  source,
  refreshList,
  presets,
}) {
  const isPreset = key.startsWith("@");
  const type = isPreset ? "preset" : "config";
  const getConfigs = () => configStore.configs;
  const updateConfigs = createConfigUpdater(window, configStore, source);
  const getOrigin = (configKey) =>
    getConfigOrigin(configStore.rules, configKey, configStore.baseConfigs);
  const getResetValue = (configKey) => configStore.getBaseConfig(configKey);
  let currentKey = key;
  const expander = new Adw.ExpanderRow({ title: currentKey });
  const originLabel = new Gtk.Label({ css_classes: ["dim-label"] });
  const updateOrigin = () => {
    originLabel.label = getOrigin(currentKey);
  };
  updateOrigin();
  const initialValue = getConfigs()[currentKey];
  expander.subtitle = isPreset
    ? "Preset definition"
    : typeof initialValue === "string" && initialValue.startsWith("@")
    ? `Preset: ${initialValue}`
    : "Custom";
  expander.add_suffix(originLabel);
  const removeButton = new Gtk.Button({
    icon_name: "user-trash-symbolic",
    tooltip_text: "Remove",
    css_classes: ["destructive-action"],
    valign: Gtk.Align.CENTER,
  });
  removeButton.connect("clicked", () => {
    if (
      !updateConfigs((configs) => {
        if (isPreset) {
          const reference = Object.entries(configs).find(
            ([, value]) => value === currentKey,
          );
          if (reference) {
            showToast(window, `${currentKey} is used by ${reference[0]}`);
            return false;
          }
        }
        delete configs[currentKey];
        return true;
      })
    ) return;
    refreshList();
  });
  expander.add_suffix(removeButton);

  let detailsBuilt = false;
  function buildDetails() {
    if (detailsBuilt) return;
    detailsBuilt = true;

    const keyRow = new Adw.EntryRow({
      title: "Key",
      text: currentKey,
    });
    const renameButton = new Gtk.Button({
      label: "Rename",
      css_classes: ["flat"],
    });
    keyRow.add_suffix(renameButton);
    const editor = createConfigEditor();
    editor.resetRow.title = getResetTitle(
      currentKey,
      type,
      configStore.baseConfigs,
    );

    const tryRename = () => {
      const nextKey = keyRow.text.trim();
      if (
        nextKey === currentKey ||
        !isValidConfigKey(nextKey, isPreset) ||
        findEquivalentConfigKey(getConfigs(), nextKey)
      ) {
        keyRow.text = currentKey;
        return;
      }
      if (
        !updateConfigs((configs) => {
          configs[nextKey] = configs[currentKey];
          delete configs[currentKey];
          if (isPreset) {
            for (const [configKey, value] of Object.entries(configs)) {
              if (value === currentKey) configs[configKey] = nextKey;
            }
          }
        })
      ) {
        keyRow.text = currentKey;
        return;
      }
      currentKey = nextKey;
      expander.title = currentKey;
      keyRow.text = currentKey;
      editor.resetRow.title = getResetTitle(
        currentKey,
        type,
        configStore.baseConfigs,
      );
      updateOrigin();
      refreshList();
    };

    renameButton.connect("clicked", tryRename);
    keyRow.connect("entry-activated", tryRename);
    expander.add_row(keyRow);

    let presetRow = null;
    if (!isPreset) {
      presetRow = new Adw.ComboRow({
        title: "Preset",
        model: createPresetModel(presets),
      });
      expander.add_row(presetRow);
    }

    for (const row of editor.rows) expander.add_row(row);

    let syncingPreset = false;
    let usesPreset = false;

    function updateConfig(updater) {
      if (
        updateConfigs((configs) => {
          const value = configs[currentKey];
          configs[currentKey] = isConfigObject(value) ? value : {};
          updater(configs[currentKey]);
        }, true)
      ) updateOrigin();
      else setPresetSelection();
    }

    function replaceConfig(value) {
      const updated = updateConfigs((configs) => {
        configs[currentKey] = value;
      });
      if (updated) updateOrigin();
      return updated;
    }

    function showConfig(config, preset = null) {
      usesPreset = !!preset;
      if (!isPreset) {
        expander.subtitle = preset ? `Preset: ${preset}` : "Custom";
      }
      editor.setEditable(!usesPreset);
      editor.applyConfig(config);
    }

    function setPresetSelection() {
      const configs = getConfigs();
      if (isPreset) {
        showConfig(
          isConfigObject(configs[currentKey]) ? configs[currentKey] : {},
        );
        return;
      }
      const value = configs[currentKey];
      const preset = typeof value === "string" && value.startsWith("@")
        ? value
        : null;
      syncingPreset = true;
      presetRow.selected = preset
        ? Math.max(0, presets.indexOf(preset) + 1)
        : 0;
      syncingPreset = false;
      showConfig(
        preset
          ? getPresetConfig(configs, preset)
          : isConfigObject(value)
          ? value
          : {},
        preset,
      );
    }

    if (presetRow) {
      presetRow.connect("notify::selected", () => {
        if (syncingPreset) return;
        const selected = presetRow.selected;
        let preset = null;
        let value;
        if (selected === 0) {
          const configs = getConfigs();
          const current = configs[currentKey];
          value = typeof current === "string"
            ? copyConfig(getPresetConfig(configs, current))
            : {};
        } else {
          preset = presets[selected - 1];
          if (!preset) return;
          value = preset;
        }

        if (!replaceConfig(value)) {
          setPresetSelection();
          return;
        }
        showConfig(
          preset ? getPresetConfig(getConfigs(), preset) : value,
          preset,
        );
      });
    }

    editor.connectHandlers({
      isEditable: () => !usesPreset,
      updateConfig,
      onReset: () => {
        if (replaceConfig(getResetValue(currentKey))) refreshList();
      },
    });

    setPresetSelection();
  }

  expander.connect("notify::expanded", () => {
    if (expander.expanded) buildDetails();
  });
  return expander;
}

function buildConfigListPage(window, configStore, {
  title,
  icon,
  source,
  addDescription,
  listDescription,
  leading,
  placeholder,
  header,
  emptyTitle,
  getKeys,
  getKey: formatKey,
  isValid,
  findExisting: findConfig,
  afterRefresh,
  beforeOpen,
  invalidMessage,
  connect,
}) {
  const page = new Adw.PreferencesPage({
    title,
    icon_name: icon,
  });
  const addGroup = new Adw.PreferencesGroup({
    title: "Quick Add",
    description: addDescription,
  });
  const addBox = new Gtk.Box({
    spacing: 8,
    margin_top: 8,
    margin_bottom: 8,
    margin_start: 12,
    margin_end: 12,
  });
  const entry = new Gtk.Entry({
    hexpand: true,
    placeholder_text: placeholder,
  });
  const button = new Gtk.Button({
    label: "Add",
    css_classes: ["suggested-action"],
    valign: Gtk.Align.CENTER,
  });
  addBox.append(leading);
  addBox.append(entry);
  addBox.append(button);
  const addRow = new Adw.PreferencesRow();
  addRow.set_child(addBox);
  addGroup.add(addRow);
  const listGroup = new Adw.PreferencesGroup({
    title,
    description: listDescription,
  });
  if (header) listGroup.add(header);

  const rows = [];
  const rowsByKey = new Map();
  const controller = {
    rowsByKey,
    updateConfigs: createConfigUpdater(window, configStore, source),
  };
  const getKey = () => formatKey(entry.text.trim());
  const findExisting = (key) => findConfig(configStore.configs, key);
  const updateQuickAdd = () => {
    const key = getKey();
    button.label = findExisting(key) ? "Open" : "Add";
    button.sensitive = isValid(key);
  };
  controller.refresh = () => {
    const expanded = new Set(
      Array.from(rowsByKey)
        .filter(([, row]) => row.expanded)
        .map(([key]) => key),
    );
    for (const row of rows) listGroup.remove(row);
    rows.length = 0;
    rowsByKey.clear();

    const configs = configStore.configs;
    const keys = getKeys(configs);
    const presets = getConfigKeys(configs, true);
    if (keys.length === 0) {
      rows.push(
        new Adw.ActionRow({
          title: emptyTitle,
          subtitle: "Add one above to get started.",
        }),
      );
    } else {
      for (const key of keys) {
        const row = buildConfigRow({
          key,
          window,
          configStore,
          source,
          refreshList: controller.refresh,
          presets,
        });
        rows.push(row);
        rowsByKey.set(key, row);
        row.expanded = expanded.has(key);
      }
    }
    for (const row of rows) listGroup.add(row);
    afterRefresh?.(controller, keys, configs);
    updateQuickAdd();
  };

  button.connect("clicked", () => {
    const key = getKey();
    if (!isValid(key)) {
      showToast(window, invalidMessage);
      return;
    }
    let openKey = findExisting(key);
    if (!openKey) {
      if (
        !controller.updateConfigs((configs) => {
          configs[key] = configStore.getBaseConfig(key);
        })
      ) return;
      controller.refresh();
      openKey = findExisting(key);
      showToast(window, `Added ${key}`);
    }
    beforeOpen?.();
    controller.rowsByKey.get(openKey).expanded = true;
    entry.text = "";
    entry.grab_focus();
  });
  entry.connect("changed", updateQuickAdd);
  entry.connect("activate", () => button.emit("clicked"));

  connect?.(controller, updateQuickAdd);
  controller.refresh();
  page.add(addGroup);
  page.add(listGroup);
  return page;
}

function buildGlobalPage(window, settings, configStore) {
  const page = new Adw.PreferencesPage({
    title: "Global",
    icon_name: "preferences-system-symbolic",
  });

  const behaviorGroup = new Adw.PreferencesGroup({ title: "Behavior" });
  for (
    const [key, title, subtitle] of [
      [
        "default-enabled",
        "Enable by default",
        "Enable borders on all windows without opt-in config",
      ],
      [
        "radius-enabled",
        "Rounded corners",
        "Toggle border radius rendering on or off",
      ],
      [
        "default-maximized-borders",
        "Smart maximize",
        "Enable smart borders on partially maximized windows",
      ],
      [
        "modal-enabled",
        "Enable borders on modal/dialog windows",
        "Borders are enabled only on top-level windows without this",
      ],
      [
        "verbose-logging",
        "Verbose logging",
        "Log detailed track/untrack events for debugging",
      ],
    ]
  ) {
    const row = new Adw.SwitchRow({ title, subtitle });
    bindSetting(settings, key, row, "active");
    behaviorGroup.add(row);
  }
  const useShippedConfigsRow = new Adw.SwitchRow({
    title: "Use shipped app configs",
    subtitle: "Layer your rules over the presets and app configs we provide",
    active: configStore.useShippedConfigs,
  });
  let syncingShippedConfigs = false;
  useShippedConfigsRow.connect("notify::active", () => {
    if (syncingShippedConfigs) return;
    tryAction(
      window,
      () => configStore.setUseShippedConfigs(useShippedConfigsRow.active),
    );
  });
  configStore.subscribe(({ useShippedConfigs }) => {
    syncingShippedConfigs = true;
    useShippedConfigsRow.active = useShippedConfigs;
    syncingShippedConfigs = false;
  });
  behaviorGroup.add(useShippedConfigsRow);

  const defaultsGroup = new Adw.PreferencesGroup({ title: "Defaults" });
  for (
    const [key, params] of [
      ["default-width", {
        title: "Border width",
        lower: 0,
        upper: MAX_BORDER_WIDTH,
      }],
      ["default-margins", {
        title: "Margins",
        subtitle: "Applied equally to all sides",
        lower: -MAX_BORDER_MARGIN,
        upper: MAX_BORDER_MARGIN,
      }],
      ["default-radius", {
        title: "Corner radius",
        lower: 0,
        upper: MAX_BORDER_RADIUS,
      }],
    ]
  ) {
    const row = createSpinRow(params);
    bindSetting(settings, key, row, "value");
    defaultsGroup.add(row);
  }

  const colorsGroup = new Adw.PreferencesGroup({ title: "Colors" });
  for (
    const [key, title, placeholder] of [
      ["default-active-color", "Active border color", "auto or rgba(...)"],
      ["default-inactive-color", "Inactive border color", "rgba(...)"],
    ]
  ) {
    const row = createColorRow(title, placeholder);
    bindAppliedTextSetting(window, settings, key, row);
    colorsGroup.add(row);
  }

  page.add(behaviorGroup);
  page.add(defaultsGroup);
  page.add(colorsGroup);
  return page;
}

function buildPresetsPage(window, configStore) {
  let lastPresets = serializePresets(configStore.configs);

  return buildConfigListPage(window, configStore, {
    title: "Presets",
    icon: "view-list-symbolic",
    source: PRESET_SOURCE,
    addDescription: "Add a preset now, then open it to set optional values.",
    listDescription: "Preset definitions can be referenced by app configs.",
    leading: new Gtk.Label({ label: "@" }),
    placeholder: "myPreset",
    emptyTitle: "No presets yet",
    getKeys: getPresetKeys,
    getKey: (input) => !input || input.startsWith("@") ? input : `@${input}`,
    isValid: (candidate) => isValidConfigKey(candidate, true),
    findExisting: (configs, key) => Object.hasOwn(configs, key) && key,
    afterRefresh: (_controller, _keys, configs) => {
      lastPresets = serializePresets(configs);
    },
    invalidMessage: "Enter a preset name",
    connect: (controller) => {
      configStore.subscribe(({ configs, source }) => {
        const nextPresets = serializePresets(configs);
        if (source !== PRESET_SOURCE && nextPresets !== lastPresets) {
          controller.refresh();
        }
      });
    },
  });
}

function buildConfigsPage(window, configStore) {
  const typePrefixes = ["class:", "app:", "regex.class:", "regex.app:"];

  const typeDropDown = Gtk.DropDown.new_from_strings([
    "Window Class",
    "Application ID",
    "Class Regex",
    "App ID Regex",
  ]);
  typeDropDown.valign = Gtk.Align.CENTER;
  const searchBox = new Gtk.Box({
    spacing: 8,
    margin_top: 6,
    margin_bottom: 6,
    margin_start: 12,
    margin_end: 12,
  });
  const searchEntry = new Gtk.SearchEntry({
    hexpand: true,
    placeholder_text: "Filter config keys",
  });
  const countLabel = new Gtk.Label({ css_classes: ["dim-label"] });
  searchBox.append(searchEntry);
  searchBox.append(countLabel);
  const searchRow = new Adw.PreferencesRow();
  searchRow.set_child(searchBox);

  function applyFilter(controller) {
    const query = searchEntry.text.trim().toLocaleLowerCase();
    let visible = 0;
    for (const [key, row] of controller.rowsByKey) {
      row.visible = !query || key.toLocaleLowerCase().includes(query);
      if (row.visible) visible++;
    }
    countLabel.label = query
      ? `${visible} of ${controller.rowsByKey.size}`
      : `${visible}`;
  }

  return buildConfigListPage(window, configStore, {
    title: "App Configs",
    icon: "application-x-executable-symbolic",
    source: APP_CONFIG_SOURCE,
    addDescription: "Add a key now, then open it to customize optional values.",
    listDescription: "Unset values inherit from global defaults.",
    leading: typeDropDown,
    placeholder: "org.gnome.Terminal",
    header: searchRow,
    emptyTitle: "No configs yet",
    getKeys: (configs) => getConfigKeys(configs),
    getKey: (input) => {
      if (!input) return "";
      if (typePrefixes.some((prefix) => input.startsWith(prefix))) return input;
      return `${typePrefixes[typeDropDown.selected]}${input}`;
    },
    isValid: (candidate) => isValidConfigKey(candidate, false),
    findExisting: findEquivalentConfigKey,
    afterRefresh: (controller) => applyFilter(controller),
    beforeOpen: () => {
      searchEntry.text = "";
    },
    invalidMessage: "Enter a valid config key",
    connect: (controller, updateQuickAdd) => {
      typeDropDown.connect("notify::selected", updateQuickAdd);
      searchEntry.connect("search-changed", () => applyFilter(controller));
      configStore.subscribe(({ source }) => {
        if (source !== APP_CONFIG_SOURCE) controller.refresh();
        else updateQuickAdd();
      });
    },
  });
}

function buildRawConfigPage(window, configStore) {
  const page = new Adw.PreferencesPage({
    title: "Raw Config",
    icon_name: "text-x-generic-symbolic",
  });

  const fileGroup = new Adw.PreferencesGroup({
    title: "Import and Export",
    description: "Transfer the complete effective app and preset config.",
  });
  const fileRow = new Adw.ActionRow({
    title: "Full config file",
    subtitle: "Importing replaces the effective config after confirmation.",
  });
  const exportButton = new Gtk.Button({
    label: "Export…",
    valign: Gtk.Align.CENTER,
  });
  const importButton = new Gtk.Button({
    label: "Import…",
    css_classes: ["suggested-action"],
    valign: Gtk.Align.CENTER,
  });
  const fileActions = new Gtk.Box({
    spacing: 8,
    valign: Gtk.Align.CENTER,
  });
  fileActions.append(exportButton);
  fileActions.append(importButton);
  fileRow.add_suffix(fileActions);
  fileGroup.add(fileRow);

  const jsonGroup = new Adw.PreferencesGroup({
    title: "JSON",
    description: "Edit your rules, or inspect the complete effective result.",
  });
  jsonGroup.hexpand = true;
  jsonGroup.vexpand = true;

  let rulesEditor;
  let updatingRules = false;
  let rulesDirty = false;
  const applyRules = () =>
    tryAction(window, () => {
      const parsed = parseConfigJson(rulesEditor.getText());
      configStore.replaceRules(parsed, RAW_CONFIG_SOURCE);
      setRulesBuffer(parsed);
      showToast(window, "Rules applied");
    });
  rulesEditor = createJsonEditor(window, {
    editable: true,
    apply: applyRules,
  });
  const effectiveEditor = createJsonEditor(window, { editable: false });
  const fileCancellable = new Gio.Cancellable();
  window.connect("destroy", () => fileCancellable.cancel());

  const stack = new Gtk.Stack({
    hexpand: true,
    vexpand: true,
    transition_type: Gtk.StackTransitionType.CROSSFADE,
  });
  stack.add_titled(rulesEditor.box, "rules", "User Rules");
  stack.add_titled(effectiveEditor.box, "effective", "Effective Config");
  const switcher = new Gtk.StackSwitcher({
    stack,
    halign: Gtk.Align.CENTER,
    margin_top: 8,
  });
  const stackBox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    hexpand: true,
    vexpand: true,
  });
  stackBox.append(switcher);
  stackBox.append(stack);
  const stackRow = new Adw.PreferencesRow({ hexpand: true, vexpand: true });
  stackRow.set_child(stackBox);
  jsonGroup.add(stackRow);

  function setRulesBuffer(rules) {
    updatingRules = true;
    setJsonBuffer(rulesEditor.buffer, rules);
    updatingRules = false;
    rulesDirty = false;
  }

  setRulesBuffer(configStore.rules);
  setJsonBuffer(effectiveEditor.buffer, configStore.configs);
  rulesEditor.buffer.connect("changed", () => {
    if (!updatingRules) rulesDirty = true;
  });

  const exportConfig = (file) =>
    tryFileAction(window, fileCancellable, "Export", async () => {
      const contents = new TextEncoder().encode(
        `${JSON.stringify(configStore.configs, null, 2)}\n`,
      );
      requireConfigFileSize(contents.length);
      await file.replace_contents_async(
        contents,
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        fileCancellable,
      );
      showToast(window, "Full config exported");
    });

  exportButton.connect("clicked", () => {
    if (!tryAction(window, () => configStore.flush())) return;
    chooseJsonFile(
      window,
      Gtk.FileChooserAction.SAVE,
      "Export Full Config",
      (file) => void exportConfig(file),
      "p7-borders-config.json",
    );
  });

  const importConfig = (file) =>
    tryFileAction(window, fileCancellable, "Import", async () => {
      const parsed = await readConfigFile(file, fileCancellable);
      const validationError = getSettingsFullConfigError(
        parsed,
        configStore.baseConfigs,
      );
      if (validationError) throw new Error(validationError);

      const rules = configStore.getRulesForConfigs(parsed);
      const useShippedConfigs = configStore.useShippedConfigs;

      let added = 0;
      let modified = 0;
      let suppressed = 0;
      for (const [key, value] of Object.entries(rules)) {
        if (value === null) suppressed++;
        else if (Object.hasOwn(configStore.baseConfigs, key)) modified++;
        else added++;
      }

      const confirmation = new Gtk.MessageDialog({
        transient_for: window,
        modal: true,
        text: "Import this full config?",
        secondary_text:
          `${modified} built-in modified, ${added} custom added, ` +
          `${suppressed} built-in suppressed.`,
        buttons: Gtk.ButtonsType.NONE,
      });
      confirmation.add_button("Cancel", Gtk.ResponseType.CANCEL);
      confirmation.add_button("Import", Gtk.ResponseType.ACCEPT);
      confirmation.connect("response", (dialog, response) => {
        if (response === Gtk.ResponseType.ACCEPT) {
          tryAction(window, () => {
            if (configStore.useShippedConfigs !== useShippedConfigs) {
              throw new Error(
                "Shipped config mode changed; review import again",
              );
            }
            const acceptedRules = configStore.replaceConfigs(
              parsed,
              RAW_CONFIG_SOURCE,
            );
            setRulesBuffer(acceptedRules);
            showToast(window, "Full config imported");
          }, "Import");
        }
        dialog.destroy();
      });
      confirmation.present();
    });

  importButton.connect("clicked", () => {
    chooseJsonFile(
      window,
      Gtk.FileChooserAction.OPEN,
      "Import Full Config",
      (file) => void importConfig(file),
    );
  });

  configStore.subscribe(({ configs, rules }) => {
    setJsonBuffer(effectiveEditor.buffer, configs);
    if (!rulesDirty) setRulesBuffer(rules);
  });

  page.add(fileGroup);
  page.add(jsonGroup);
  return page;
}
