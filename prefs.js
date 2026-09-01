import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";

import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
import {
  copyConfig,
  deriveAppConfigRules,
  findEquivalentConfigKey,
  getConfigMapError,
  getRulesError,
  isConfigObject,
  normalizeMargins,
  normalizeRadius,
} from "./appconfig.js";
import { ensureConfigVersion } from "./config.js";
import { PreferencesConfigStore } from "./prefsconfig.js";

const CUSTOM_LABEL = "Custom";
const APP_CONFIG_SOURCE = {};
const PRESET_SOURCE = {};
const RAW_CONFIG_SOURCE = {};
const GLOBAL_SOURCE = {};

function setEntryRowPlaceholder(row, text) {
  const delegate = row.get_delegate();
  delegate.set_placeholder_text(text);
}

function bindSetting(settings, key, object, property) {
  settings.bind(key, object, property, Gio.SettingsBindFlags.DEFAULT);
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
    const rgba = parseRgba(row.text.trim());
    if (!rgba) {
      syncing = true;
      button.rgba = makeTransparentRgba();
      syncing = false;
      return;
    }
    syncing = true;
    button.rgba = rgba;
    syncing = false;
  });

  button.connect("notify::rgba", () => {
    if (syncing) return;
    syncing = true;
    row.text = formatRgba(button.rgba);
    syncing = false;
  });

  syncButtonFromText();
  return button;
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

function createQuickAddGroup({ description, leading, placeholder }) {
  const group = new Adw.PreferencesGroup({
    title: "Quick Add",
    description,
  });
  const box = new Gtk.Box({
    spacing: 8,
    margin_top: 8,
    margin_bottom: 8,
    margin_start: 12,
    margin_end: 12,
  });
  box.append(leading);

  const entry = new Gtk.Entry({ hexpand: true, placeholder_text: placeholder });
  box.append(entry);
  const button = new Gtk.Button({
    label: "Add",
    css_classes: ["suggested-action"],
    valign: Gtk.Align.CENTER,
  });
  box.append(button);

  const row = new Adw.PreferencesRow();
  row.set_child(box);
  group.add(row);
  return { group, entry, button };
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

function createJsonFileChooser(window, action, title) {
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
  return chooser;
}

function clearGroupRows(group, rows) {
  for (const row of rows) group.remove(row);
  rows.length = 0;
}

function getExpandedKeys(rowsByKey) {
  return new Set(
    Array.from(rowsByKey)
      .filter(([, row]) => row.expanded)
      .map(([key]) => key),
  );
}

function createPresetModel(presets) {
  const model = new Gtk.StringList();
  model.append(CUSTOM_LABEL);
  for (const preset of presets) model.append(preset);
  return model;
}

function getAppKeys(rawConfigs) {
  return Object.keys(rawConfigs)
    .filter((key) => !key.startsWith("@"))
    .sort((a, b) => a.localeCompare(b));
}

function getPresetConfig(rawConfigs, presetKey) {
  const presetValue = rawConfigs[presetKey];
  return isConfigObject(presetValue) ? presetValue : {};
}

function getConfigOrigin(rules, key, baseConfigs) {
  if (!Object.hasOwn(rules, key)) return "Built-in";
  return Object.hasOwn(baseConfigs, key) ? "Modified" : "Custom";
}

function getBaseConfig(key, baseConfigs) {
  return Object.hasOwn(baseConfigs, key) ? copyConfig(baseConfigs[key]) : {};
}

function getResetTitle(key, type, baseConfigs) {
  return Object.hasOwn(baseConfigs, key)
    ? `Restore built-in ${type}`
    : "Reset rules";
}

function createConfigEditor() {
  const enabledRow = new Adw.SwitchRow({ title: "Enabled" });
  const widthRow = createSpinRow({
    title: "Border width",
    lower: 0,
    upper: 50,
  });

  const marginsStrip = createNumberStrip(
    "Margins",
    [
      ["top", "T"],
      ["right", "R"],
      ["bottom", "B"],
      ["left", "L"],
    ],
    -100,
    100,
  );
  const radiusStrip = createNumberStrip(
    "Corner radius",
    [
      ["tl", "TL"],
      ["tr", "TR"],
      ["bl", "BL"],
      ["br", "BR"],
    ],
    0,
    200,
  );

  const activeColorRow = new Adw.EntryRow({
    title: "Active border color",
  });
  const inactiveColorRow = new Adw.EntryRow({
    title: "Inactive border color",
  });
  setEntryRowPlaceholder(activeColorRow, "inherit or rgba(...)");
  setEntryRowPlaceholder(inactiveColorRow, "inherit or rgba(...)");
  attachColorPicker(activeColorRow);
  attachColorPicker(inactiveColorRow);

  const resetRow = new Adw.ActionRow({
    title: "Reset rules",
    subtitle: "Inherit all global defaults",
  });
  const resetButton = new Gtk.Button({ label: "Reset", css_classes: ["flat"] });
  resetRow.add_suffix(resetButton);

  const customRows = [
    enabledRow,
    widthRow,
    marginsStrip.row,
    radiusStrip.row,
    activeColorRow,
    inactiveColorRow,
    resetRow,
  ];

  let updating = false;

  function setCustomSensitive(sensitive) {
    for (const row of customRows) row.sensitive = sensitive;
  }

  function applyConfig(config) {
    const margins = normalizeMargins(config.margins);
    const radius = normalizeRadius(config.radius);
    updating = true;
    enabledRow.active = config.enabled ?? true;
    widthRow.value = config.width ?? 0;
    for (const [key, control] of Object.entries(marginsStrip.controls)) {
      control.value = margins[key];
    }
    for (const [key, control] of Object.entries(radiusStrip.controls)) {
      control.value = radius[key];
    }
    activeColorRow.text = config.activeColor ?? "";
    inactiveColorRow.text = config.inactiveColor ?? "";
    updating = false;
  }

  function connectHandlers({ isCustom, setConfigValue, onReset }) {
    resetButton.connect("clicked", () => {
      if (!isCustom()) return;
      onReset();
    });

    enabledRow.connect("notify::active", () => {
      if (updating || !isCustom()) return;
      setConfigValue((config) => {
        config.enabled = enabledRow.active;
      });
    });
    widthRow.connect("notify::value", () => {
      if (updating || !isCustom()) return;
      setConfigValue((config) => {
        config.width = Math.round(widthRow.value);
      });
    });

    const connectNumberControls = (controls, field, normalize) => {
      for (const [key, control] of Object.entries(controls)) {
        control.connect("notify::value", () => {
          if (updating || !isCustom()) return;
          setConfigValue((config) => {
            if (!isConfigObject(config[field])) {
              config[field] = normalize(config[field]);
            }
            config[field][key] = Math.round(control.value);
          });
        });
      }
    };
    connectNumberControls(marginsStrip.controls, "margins", normalizeMargins);
    connectNumberControls(radiusStrip.controls, "radius", normalizeRadius);

    for (
      const [row, field] of [
        [activeColorRow, "activeColor"],
        [inactiveColorRow, "inactiveColor"],
      ]
    ) {
      row.connect("notify::text", () => {
        if (updating || !isCustom()) return;
        const text = row.text.trim();
        setConfigValue((config) => {
          if (text) config[field] = text;
          else delete config[field];
        });
      });
    }
  }

  return {
    rows: customRows,
    resetRow,
    applyConfig,
    setCustomSensitive,
    connectHandlers,
  };
}

function buildGlobalPage(settings, configStore) {
  const page = new Adw.PreferencesPage({
    title: "Global",
    icon_name: "preferences-system-symbolic",
  });

  const behaviorGroup = new Adw.PreferencesGroup({ title: "Behavior" });
  const defaultEnabledRow = new Adw.SwitchRow({
    title: "Enable by default",
    subtitle: "Enable borders on all windows without opt-in config",
  });
  const radiusEnabledRow = new Adw.SwitchRow({
    title: "Rounded corners",
    subtitle: "Toggle border radius rendering on or off",
  });
  const maximizedBordersRow = new Adw.SwitchRow({
    title: "Smart maximize",
    subtitle: "Enable smart borders on partially maximized windows",
  });
  const modalEnabledRow = new Adw.SwitchRow({
    title: "Enable borders on modal/dialog windows",
    subtitle: "Borders are enabled only on top-level windows without this",
  });
  const verboseLoggingRow = new Adw.SwitchRow({
    title: "Verbose logging",
    subtitle: "Log detailed track/untrack events for debugging",
  });
  const useShippedConfigsRow = new Adw.SwitchRow({
    title: "Use shipped app configs",
    subtitle: "Layer your rules over the presets and app configs we provide",
    active: configStore.useShippedConfigs,
  });
  let syncingShippedConfigs = false;
  useShippedConfigsRow.connect("notify::active", () => {
    if (syncingShippedConfigs) return;
    configStore.setUseShippedConfigs(
      useShippedConfigsRow.active,
      GLOBAL_SOURCE,
    );
  });
  configStore.subscribe(({ useShippedConfigs }) => {
    syncingShippedConfigs = true;
    useShippedConfigsRow.active = useShippedConfigs;
    syncingShippedConfigs = false;
  });
  behaviorGroup.add(defaultEnabledRow);
  behaviorGroup.add(radiusEnabledRow);
  behaviorGroup.add(maximizedBordersRow);
  behaviorGroup.add(modalEnabledRow);
  behaviorGroup.add(verboseLoggingRow);
  behaviorGroup.add(useShippedConfigsRow);

  bindSetting(settings, "radius-enabled", radiusEnabledRow, "active");
  bindSetting(settings, "default-enabled", defaultEnabledRow, "active");
  bindSetting(
    settings,
    "default-maximized-borders",
    maximizedBordersRow,
    "active",
  );
  bindSetting(settings, "modal-enabled", modalEnabledRow, "active");
  bindSetting(settings, "verbose-logging", verboseLoggingRow, "active");

  const defaultsGroup = new Adw.PreferencesGroup({ title: "Defaults" });
  const widthRow = createSpinRow({
    title: "Border width",
    lower: 0,
    upper: 50,
  });
  const marginsRow = createSpinRow({
    title: "Margins",
    subtitle: "Applied equally to all sides",
    lower: -100,
    upper: 100,
  });
  const radiusRow = createSpinRow({
    title: "Corner radius",
    lower: 0,
    upper: 200,
  });
  defaultsGroup.add(widthRow);
  defaultsGroup.add(marginsRow);
  defaultsGroup.add(radiusRow);

  bindSetting(settings, "default-width", widthRow, "value");
  bindSetting(settings, "default-margins", marginsRow, "value");
  bindSetting(settings, "default-radius", radiusRow, "value");

  const colorsGroup = new Adw.PreferencesGroup({ title: "Colors" });
  const activeColorRow = new Adw.EntryRow({
    title: "Active border color",
    text: settings.get_string("default-active-color"),
  });
  const inactiveColorRow = new Adw.EntryRow({
    title: "Inactive border color",
    text: settings.get_string("default-inactive-color"),
  });
  setEntryRowPlaceholder(activeColorRow, "auto or rgba(...)");
  setEntryRowPlaceholder(inactiveColorRow, "rgba(...)");
  attachColorPicker(activeColorRow);
  attachColorPicker(inactiveColorRow);
  colorsGroup.add(activeColorRow);
  colorsGroup.add(inactiveColorRow);

  bindSetting(settings, "default-active-color", activeColorRow, "text");
  bindSetting(settings, "default-inactive-color", inactiveColorRow, "text");

  page.add(behaviorGroup);
  page.add(defaultsGroup);
  page.add(colorsGroup);
  return page;
}

function getPresetKeys(rawConfigs) {
  return Object.keys(rawConfigs)
    .filter((key) => key.startsWith("@"))
    .sort((a, b) => a.localeCompare(b));
}

function serializePresets(rawConfigs) {
  const presets = getPresetKeys(rawConfigs);
  return JSON.stringify(
    Object.fromEntries(presets.map((key) => [key, rawConfigs[key]])),
  );
}

function buildConfigRow({
  key,
  getRawConfigs,
  saveConfigs,
  saveConfigsDebounced,
  refreshList,
  presets,
  removeConfig = (configKey, configs) => {
    delete configs[configKey];
    return true;
  },
  getOrigin = () => "Custom",
  getResetValue = () => ({}),
  resetTitle = "Reset rules",
  validateKey = () => true,
  updateReferences = () => {},
}) {
  const isPreset = key.startsWith("@");
  let currentKey = key;
  const expander = new Adw.ExpanderRow({ title: currentKey });
  const originLabel = new Gtk.Label({ css_classes: ["dim-label"] });
  const updateOrigin = () => {
    originLabel.label = getOrigin(currentKey);
  };
  updateOrigin();
  const initialValue = getRawConfigs()[currentKey];
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
    const rawConfigs = getRawConfigs();
    if (!removeConfig(currentKey, rawConfigs)) return;
    saveConfigs();
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

    const tryRename = () => {
      const nextKey = keyRow.text.trim();
      if (!nextKey || nextKey === currentKey) {
        keyRow.text = currentKey;
        return;
      }
      if (!validateKey(nextKey)) {
        keyRow.text = currentKey;
        return;
      }
      const rawConfigs = getRawConfigs();
      const equivalentKey = findEquivalentConfigKey(rawConfigs, nextKey);
      if (equivalentKey && equivalentKey !== currentKey) {
        keyRow.text = currentKey;
        return;
      }
      rawConfigs[nextKey] = rawConfigs[currentKey];
      delete rawConfigs[currentKey];
      updateReferences(currentKey, nextKey, rawConfigs);
      currentKey = nextKey;
      expander.title = currentKey;
      keyRow.text = currentKey;
      saveConfigs();
      updateOrigin();
      refreshList();
    };

    renameButton.connect("clicked", tryRename);
    keyRow.connect("activate", tryRename);
    expander.add_row(keyRow);

    let presetRow = null;
    if (!isPreset) {
      presetRow = new Adw.ComboRow({
        title: "Preset",
        model: createPresetModel(presets),
      });
      expander.add_row(presetRow);
    }

    const editor = createConfigEditor();
    editor.resetRow.title = resetTitle;
    for (const row of editor.rows) expander.add_row(row);

    let updating = false;
    let isCustom = true;

    function ensureCustomConfig(fallbackPreset) {
      const rawConfigs = getRawConfigs();
      if (isConfigObject(rawConfigs[currentKey])) return rawConfigs[currentKey];
      if (typeof rawConfigs[currentKey] === "string" && fallbackPreset) {
        const presetValue = rawConfigs[rawConfigs[currentKey]];
        rawConfigs[currentKey] = copyConfig(
          isConfigObject(presetValue) ? presetValue : {},
        );
      } else {
        rawConfigs[currentKey] = {};
      }
      return rawConfigs[currentKey];
    }

    function setConfigValue(updater) {
      const config = ensureCustomConfig(false);
      updater(config);
      saveConfigsDebounced();
      updateOrigin();
    }

    function setConfigObject(config) {
      const rawConfigs = getRawConfigs();
      rawConfigs[currentKey] = config;
      saveConfigs();
      updateOrigin();
    }

    function setPresetSelection() {
      const rawConfigs = getRawConfigs();
      if (isPreset) {
        isCustom = true;
        editor.setCustomSensitive(true);
        editor.applyConfig(
          isConfigObject(rawConfigs[currentKey]) ? rawConfigs[currentKey] : {},
        );
        return;
      }
      const value = rawConfigs[currentKey];
      if (typeof value === "string" && value.startsWith("@")) {
        const index = presets.indexOf(value);
        updating = true;
        presetRow.selected = index >= 0 ? index + 1 : 0;
        updating = false;
        expander.subtitle = `Preset: ${value}`;
        isCustom = false;
        editor.setCustomSensitive(false);
        editor.applyConfig(getPresetConfig(rawConfigs, value));
      } else {
        updating = true;
        presetRow.selected = 0;
        updating = false;
        expander.subtitle = "Custom";
        isCustom = true;
        editor.setCustomSensitive(true);
        editor.applyConfig(isConfigObject(value) ? value : {});
      }
    }

    if (presetRow) {
      presetRow.connect("notify::selected", () => {
        if (updating) return;
        const selected = presetRow.selected;
        if (selected === 0) {
          const config = ensureCustomConfig(true);
          isCustom = true;
          expander.subtitle = "Custom";
          editor.setCustomSensitive(true);
          editor.applyConfig(config);
          saveConfigs();
          updateOrigin();
          return;
        }

        const preset = presets[selected - 1];
        if (!preset) return;
        const rawConfigs = getRawConfigs();
        rawConfigs[currentKey] = preset;
        saveConfigs();
        updateOrigin();
        isCustom = false;
        expander.subtitle = `Preset: ${preset}`;
        editor.setCustomSensitive(false);
        editor.applyConfig(getPresetConfig(rawConfigs, preset));
      });
    }

    editor.connectHandlers({
      isCustom: () => isCustom,
      setConfigValue,
      onReset: () => {
        if (!isCustom) return;
        setConfigObject(getResetValue(currentKey));
        refreshList();
      },
    });

    setPresetSelection();
  }

  expander.connect("notify::expanded", () => {
    if (expander.expanded) buildDetails();
  });
  return expander;
}

function buildConfigsPage(window, configStore) {
  const page = new Adw.PreferencesPage({
    title: "App Configs",
    icon_name: "application-x-executable-symbolic",
  });
  const getRawConfigs = () => configStore.configs;
  const saveConfigs = () => configStore.save(APP_CONFIG_SOURCE);
  const saveConfigsDebounced = () =>
    configStore.scheduleSave(APP_CONFIG_SOURCE);
  const typePrefixes = ["class:", "app:", "regex.class:", "regex.app:"];
  const isValidKey = (candidate) =>
    Boolean(candidate) &&
    !candidate.startsWith("@") &&
    !getConfigMapError({ [candidate]: {} });

  const typeDropDown = Gtk.DropDown.new_from_strings([
    "Window Class",
    "Application ID",
    "Class Regex",
    "App ID Regex",
  ]);
  typeDropDown.valign = Gtk.Align.CENTER;
  const {
    group: addGroup,
    entry: addEntry,
    button: addButton,
  } = createQuickAddGroup({
    description: "Add a key now, then open it to customize optional values.",
    leading: typeDropDown,
    placeholder: "org.gnome.Terminal",
  });

  const listGroup = new Adw.PreferencesGroup({
    title: "App Configs",
    description: "Unset values inherit from global defaults.",
  });
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
  listGroup.add(searchRow);

  const listRows = [];
  const rowsByKey = new Map();

  function getDraftKey() {
    const input = addEntry.text.trim();
    if (!input) return "";
    if (typePrefixes.some((prefix) => input.startsWith(prefix))) return input;
    return `${typePrefixes[typeDropDown.selected]}${input}`;
  }

  function updateAddButtonState() {
    const key = getDraftKey();
    const exists = findEquivalentConfigKey(configStore.configs, key);
    addButton.label = exists ? "Open" : "Add";
    addButton.sensitive = isValidKey(key);
  }

  function applyFilter() {
    const query = searchEntry.text.trim().toLocaleLowerCase();
    let visible = 0;
    for (const [key, row] of rowsByKey) {
      row.visible = !query || key.toLocaleLowerCase().includes(query);
      if (row.visible) visible++;
    }
    countLabel.label = query ? `${visible} of ${rowsByKey.size}` : `${visible}`;
  }

  function refreshList() {
    const expandedKeys = getExpandedKeys(rowsByKey);
    clearGroupRows(listGroup, listRows);
    rowsByKey.clear();

    const rawConfigs = configStore.configs;
    const appKeys = getAppKeys(rawConfigs);
    const presets = getPresetKeys(rawConfigs);
    if (appKeys.length === 0) {
      const row = new Adw.ActionRow({
        title: "No configs yet",
        subtitle: "Add one above to get started.",
      });
      listGroup.add(row);
      listRows.push(row);
      countLabel.label = "0";
      updateAddButtonState();
      return;
    }

    for (const key of appKeys) {
      const row = buildConfigRow({
        key,
        getRawConfigs,
        saveConfigs,
        saveConfigsDebounced,
        refreshList,
        presets,
        getOrigin: (configKey) =>
          getConfigOrigin(
            configStore.rules,
            configKey,
            configStore.baseConfigs,
          ),
        getResetValue: (configKey) =>
          getBaseConfig(configKey, configStore.baseConfigs),
        resetTitle: getResetTitle(
          key,
          "config",
          configStore.baseConfigs,
        ),
        validateKey: isValidKey,
      });
      listGroup.add(row);
      listRows.push(row);
      rowsByKey.set(key, row);
      row.expanded = expandedKeys.has(key);
    }

    applyFilter();
    updateAddButtonState();
  }

  addButton.connect("clicked", () => {
    const key = getDraftKey();
    if (!isValidKey(key)) {
      showToast(window, "Enter a valid config key");
      return;
    }
    const rawConfigs = configStore.configs;
    const existingKey = findEquivalentConfigKey(rawConfigs, key);
    if (!existingKey) {
      rawConfigs[key] = getBaseConfig(key, configStore.baseConfigs);
      saveConfigs();
      refreshList();
      showToast(window, `Added ${key}`);
    }
    searchEntry.text = "";
    rowsByKey.get(existingKey ?? key).expanded = true;
    addEntry.text = "";
    addEntry.grab_focus();
  });

  addEntry.connect("changed", updateAddButtonState);
  addEntry.connect("activate", () => addButton.emit("clicked"));
  typeDropDown.connect("notify::selected", updateAddButtonState);
  searchEntry.connect("search-changed", applyFilter);
  configStore.subscribe(({ source }) => {
    if (source !== APP_CONFIG_SOURCE) {
      refreshList();
      return;
    }
    updateAddButtonState();
  });

  refreshList();

  page.add(addGroup);
  page.add(listGroup);
  return page;
}

function buildPresetsPage(window, configStore) {
  const page = new Adw.PreferencesPage({
    title: "Presets",
    icon_name: "view-list-symbolic",
  });
  const getRawConfigs = () => configStore.configs;
  const saveConfigs = () => configStore.save(PRESET_SOURCE);
  const saveConfigsDebounced = () => configStore.scheduleSave(PRESET_SOURCE);
  const isValidKey = (candidate) =>
    Boolean(candidate?.startsWith("@")) &&
    !getConfigMapError({ [candidate]: {} });

  function updateReferences(oldKey, newKey, configs) {
    for (const [configKey, value] of Object.entries(configs)) {
      if (typeof value === "string" && value === oldKey) {
        configs[configKey] = newKey;
      }
    }
  }

  function removePreset(presetKey, configs) {
    const reference = Object.entries(configs).find(
      ([, value]) => value === presetKey,
    );
    if (reference) {
      showToast(window, `${presetKey} is used by ${reference[0]}`);
      return false;
    }
    delete configs[presetKey];
    return true;
  }

  const {
    group: addGroup,
    entry: addEntry,
    button: addButton,
  } = createQuickAddGroup({
    description: "Add a preset now, then open it to set optional values.",
    leading: new Gtk.Label({ label: "@" }),
    placeholder: "myPreset",
  });

  const listGroup = new Adw.PreferencesGroup({
    title: "Presets",
    description: "Preset definitions can be referenced by app configs.",
  });
  const listRows = [];
  const rowsByKey = new Map();
  let lastPresets = serializePresets(configStore.configs);

  function getDraftKey() {
    const input = addEntry.text.trim();
    if (!input) return "";
    return input.startsWith("@") ? input : `@${input}`;
  }

  function updateAddButtonState() {
    const key = getDraftKey();
    const exists = Object.hasOwn(configStore.configs, key);
    addButton.label = exists ? "Open" : "Add";
    addButton.sensitive = isValidKey(key);
  }

  function refreshList() {
    const expandedKeys = getExpandedKeys(rowsByKey);
    clearGroupRows(listGroup, listRows);
    rowsByKey.clear();

    const rawConfigs = configStore.configs;
    const presetKeys = getPresetKeys(rawConfigs);
    lastPresets = serializePresets(rawConfigs);

    if (presetKeys.length === 0) {
      const row = new Adw.ActionRow({
        title: "No presets yet",
        subtitle: "Add one above to get started.",
      });
      listGroup.add(row);
      listRows.push(row);
      updateAddButtonState();
      return;
    }

    for (const key of presetKeys) {
      const row = buildConfigRow({
        key,
        getRawConfigs,
        saveConfigs,
        saveConfigsDebounced,
        refreshList,
        presets: [],
        removeConfig: removePreset,
        getOrigin: (presetKey) =>
          getConfigOrigin(
            configStore.rules,
            presetKey,
            configStore.baseConfigs,
          ),
        getResetValue: (presetKey) =>
          getBaseConfig(presetKey, configStore.baseConfigs),
        resetTitle: getResetTitle(
          key,
          "preset",
          configStore.baseConfigs,
        ),
        validateKey: isValidKey,
        updateReferences,
      });
      listGroup.add(row);
      listRows.push(row);
      rowsByKey.set(key, row);
      row.expanded = expandedKeys.has(key);
    }

    updateAddButtonState();
  }

  addButton.connect("clicked", () => {
    const key = getDraftKey();
    if (!isValidKey(key)) {
      showToast(window, "Enter a preset name");
      return;
    }
    const rawConfigs = configStore.configs;
    const exists = Object.hasOwn(rawConfigs, key);
    if (!exists) {
      rawConfigs[key] = getBaseConfig(key, configStore.baseConfigs);
      saveConfigs();
      refreshList();
      showToast(window, `Added ${key}`);
    }
    rowsByKey.get(key).expanded = true;
    addEntry.text = "";
    addEntry.grab_focus();
  });

  addEntry.connect("changed", () => {
    updateAddButtonState();
  });
  addEntry.connect("activate", () => addButton.emit("clicked"));

  updateAddButtonState();

  configStore.subscribe(({ configs, source }) => {
    const nextPresets = serializePresets(configs);
    if (source !== PRESET_SOURCE && nextPresets !== lastPresets) {
      refreshList();
    }
  });

  refreshList();

  page.add(addGroup);
  page.add(listGroup);
  return page;
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
  const applyRules = () => {
    let parsed;
    try {
      parsed = JSON.parse(rulesEditor.getText());
    } catch (_error) {
      showToast(window, "Invalid JSON");
      return;
    }
    if (!isConfigObject(parsed)) {
      showToast(window, "Rules must be a JSON object");
      return;
    }
    const validationError = getRulesError(parsed, configStore.baseConfigs);
    if (validationError) {
      showToast(window, validationError);
      return;
    }
    configStore.replaceRules(parsed, RAW_CONFIG_SOURCE);
    setRulesBuffer(parsed);
    showToast(window, "Rules applied");
  };
  rulesEditor = createJsonEditor(window, {
    editable: true,
    apply: applyRules,
  });
  const effectiveEditor = createJsonEditor(window, { editable: false });

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

  exportButton.connect("clicked", () => {
    configStore.flush();
    const chooser = createJsonFileChooser(
      window,
      Gtk.FileChooserAction.SAVE,
      "Export Full Config",
    );
    chooser.set_current_name("p7-borders-config.json");
    chooser.connect("response", (_dialog, response) => {
      if (response === Gtk.ResponseType.ACCEPT) {
        try {
          const contents = new TextEncoder().encode(
            `${JSON.stringify(configStore.configs, null, 2)}\n`,
          );
          chooser
            .get_file()
            .replace_contents(
              contents,
              null,
              false,
              Gio.FileCreateFlags.REPLACE_DESTINATION,
              null,
            );
          showToast(window, "Full config exported");
        } catch (error) {
          showToast(window, `Export failed: ${error.message}`);
        }
      }
      chooser.destroy();
    });
    chooser.show();
  });

  importButton.connect("clicked", () => {
    const chooser = createJsonFileChooser(
      window,
      Gtk.FileChooserAction.OPEN,
      "Import Full Config",
    );
    chooser.connect("response", (_dialog, response) => {
      if (response !== Gtk.ResponseType.ACCEPT) {
        chooser.destroy();
        return;
      }
      try {
        const [loaded, contents] = chooser.get_file().load_contents(null);
        const parsed = JSON.parse(new TextDecoder().decode(contents));
        if (!loaded || !isConfigObject(parsed)) {
          throw new Error("Expected a JSON object");
        }
        const validationError = getConfigMapError(parsed);
        if (validationError) throw new Error(validationError);
        const rules = deriveAppConfigRules(parsed, configStore.baseConfigs);
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
        confirmation.connect("response", (dialog, importResponse) => {
          if (importResponse === Gtk.ResponseType.ACCEPT) {
            configStore.replaceRules(rules, RAW_CONFIG_SOURCE);
            setRulesBuffer(rules);
            showToast(window, "Full config imported");
          }
          dialog.destroy();
        });
        confirmation.present();
      } catch (error) {
        showToast(window, `Import failed: ${error.message}`);
      }
      chooser.destroy();
    });
    chooser.show();
  });

  configStore.subscribe(({ configs, rules }) => {
    setJsonBuffer(effectiveEditor.buffer, configs);
    if (!rulesDirty) setRulesBuffer(rules);
  });

  page.add(fileGroup);
  page.add(jsonGroup);
  return page;
}

export default class P7BordersPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    ensureConfigVersion(settings);
    const configStore = new PreferencesConfigStore(settings);
    window.connect("destroy", () => configStore.destroy());
    window.set_default_size(760, 640);
    window.add(buildGlobalPage(settings, configStore));
    window.add(buildPresetsPage(window, configStore));
    window.add(buildConfigsPage(window, configStore));
    window.add(buildRawConfigPage(window, configStore));
  }
}
