import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";

import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

const APP_CONFIGS_KEY = "app-configs";
const CUSTOM_LABEL = "Custom";
const DEFAULT_PRESET_KEY = "@default";

function parseAppConfigs(settings) {
	const raw = settings.get_string(APP_CONFIGS_KEY);
	if (!raw) return {};

	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch (_err) {
		return {};
	}
}

function saveAppConfigs(settings, rawConfigs) {
	settings.set_string(APP_CONFIGS_KEY, JSON.stringify(rawConfigs));
}

function isObject(value) {
	return value && typeof value === "object" && !Array.isArray(value);
}

function copyObject(value) {
	return JSON.parse(JSON.stringify(value || {}));
}

function setEntryRowPlaceholder(row, text) {
	const delegate = row.get_delegate();
	delegate.set_placeholder_text(text);
}

function createSpinRow({ title, subtitle, lower, upper, step = 1 }) {
	return new Adw.SpinRow({
		title,
		subtitle,
		adjustment: new Gtk.Adjustment({
			lower,
			upper,
			step_increment: step,
		}),
	});
}

function clearGroupChildren(group) {
	let child = group.get_first_child();
	while (child) {
		const next = child.get_next_sibling();
		group.remove(child);
		child = next;
	}
}

function createPresetModel(presets) {
	const model = new Gtk.StringList();
	model.append(CUSTOM_LABEL);
	for (const preset of presets) model.append(preset);
	return model;
}

function getPresetConfig(rawConfigs, presetKey) {
	const presetValue = rawConfigs[presetKey];
	return isObject(presetValue) ? presetValue : {};
}

function createConfigEditor() {
	const enabledRow = new Adw.SwitchRow({ title: "Enabled" });
	const maximizedRow = new Adw.SwitchRow({ title: "Show when maximized" });
	const widthRow = createSpinRow({
		title: "Border width",
		lower: 0,
		upper: 50,
	});

	const marginsTopRow = createSpinRow({
		title: "Margin top",
		lower: -100,
		upper: 100,
	});
	const marginsRightRow = createSpinRow({
		title: "Margin right",
		lower: -100,
		upper: 100,
	});
	const marginsBottomRow = createSpinRow({
		title: "Margin bottom",
		lower: -100,
		upper: 100,
	});
	const marginsLeftRow = createSpinRow({
		title: "Margin left",
		lower: -100,
		upper: 100,
	});

	const radiusTlRow = createSpinRow({
		title: "Radius top-left",
		lower: 0,
		upper: 200,
	});
	const radiusTrRow = createSpinRow({
		title: "Radius top-right",
		lower: 0,
		upper: 200,
	});
	const radiusBrRow = createSpinRow({
		title: "Radius bottom-right",
		lower: 0,
		upper: 200,
	});
	const radiusBlRow = createSpinRow({
		title: "Radius bottom-left",
		lower: 0,
		upper: 200,
	});

	const activeColorRow = new Adw.EntryRow({
		title: "Active border color",
	});
	const inactiveColorRow = new Adw.EntryRow({
		title: "Inactive border color",
	});
	setEntryRowPlaceholder(activeColorRow, "inherit or rgba(...)");
	setEntryRowPlaceholder(inactiveColorRow, "inherit or rgba(...)");

	const resetRow = new Adw.ActionRow({
		title: "Reset overrides",
		subtitle: "Inherit all global defaults",
	});
	const resetButton = new Gtk.Button({ label: "Reset", css_classes: ["flat"] });
	resetRow.add_suffix(resetButton);

	const customRows = [
		enabledRow,
		maximizedRow,
		widthRow,
		marginsTopRow,
		marginsRightRow,
		marginsBottomRow,
		marginsLeftRow,
		radiusTlRow,
		radiusTrRow,
		radiusBrRow,
		radiusBlRow,
		activeColorRow,
		inactiveColorRow,
		resetRow,
	];

	let updating = false;

	function setCustomSensitive(sensitive) {
		for (const row of customRows) row.sensitive = sensitive;
	}

	function applyConfig(config) {
		const margins = isObject(config.margins) ? config.margins : {};
		const radius = isObject(config.radius) ? config.radius : {};
		updating = true;
		enabledRow.active = config.enabled ?? true;
		maximizedRow.active = config.maximizedBorder ?? false;
		widthRow.value = config.width ?? 0;
		marginsTopRow.value = margins.top ?? 0;
		marginsRightRow.value = margins.right ?? 0;
		marginsBottomRow.value = margins.bottom ?? 0;
		marginsLeftRow.value = margins.left ?? 0;
		radiusTlRow.value = radius.tl ?? 0;
		radiusTrRow.value = radius.tr ?? 0;
		radiusBrRow.value = radius.br ?? 0;
		radiusBlRow.value = radius.bl ?? 0;
		activeColorRow.text = config.activeColor ?? "";
		inactiveColorRow.text = config.inactiveColor ?? "";
		updating = false;
	}

	function connectHandlers({ isCustom, setConfigValue, onReset }) {
		resetButton.connectObject(
			"clicked",
			() => {
				if (!isCustom()) return;
				onReset();
			},
			resetButton,
		);

		enabledRow.connectObject(
			"notify::active",
			() => {
				if (updating || !isCustom()) return;
				setConfigValue((config) => {
					config.enabled = enabledRow.active;
				});
			},
			enabledRow,
		);
		maximizedRow.connectObject(
			"notify::active",
			() => {
				if (updating || !isCustom()) return;
				setConfigValue((config) => {
					config.maximizedBorder = maximizedRow.active;
				});
			},
			maximizedRow,
		);
		widthRow.connectObject(
			"notify::value",
			() => {
				if (updating || !isCustom()) return;
				setConfigValue((config) => {
					config.width = Math.round(widthRow.value);
				});
			},
			widthRow,
		);

		const marginsRows = [
			[marginsTopRow, "top"],
			[marginsRightRow, "right"],
			[marginsBottomRow, "bottom"],
			[marginsLeftRow, "left"],
		];
		for (const [row, side] of marginsRows) {
			row.connectObject(
				"notify::value",
				() => {
					if (updating || !isCustom()) return;
					setConfigValue((config) => {
						if (!isObject(config.margins)) config.margins = {};
						config.margins[side] = Math.round(row.value);
					});
				},
				row,
			);
		}

		const radiusRows = [
			[radiusTlRow, "tl"],
			[radiusTrRow, "tr"],
			[radiusBrRow, "br"],
			[radiusBlRow, "bl"],
		];
		for (const [row, corner] of radiusRows) {
			row.connectObject(
				"notify::value",
				() => {
					if (updating || !isCustom()) return;
					setConfigValue((config) => {
						if (!isObject(config.radius)) config.radius = {};
						config.radius[corner] = Math.round(row.value);
					});
				},
				row,
			);
		}

		activeColorRow.connectObject(
			"notify::text",
			() => {
				if (updating || !isCustom()) return;
				const text = activeColorRow.text.trim();
				setConfigValue((config) => {
					if (text) config.activeColor = text;
					else delete config.activeColor;
				});
			},
			activeColorRow,
		);
		inactiveColorRow.connectObject(
			"notify::text",
			() => {
				if (updating || !isCustom()) return;
				const text = inactiveColorRow.text.trim();
				setConfigValue((config) => {
					if (text) config.inactiveColor = text;
					else delete config.inactiveColor;
				});
			},
			inactiveColorRow,
		);
	}

	return {
		rows: customRows,
		applyConfig,
		setCustomSensitive,
		connectHandlers,
	};
}

function buildGlobalPage(settings) {
	const page = new Adw.PreferencesPage({
		title: "Global",
		icon_name: "preferences-system-symbolic",
	});

	const behaviorGroup = new Adw.PreferencesGroup({ title: "Behavior" });
	const radiusEnabledRow = new Adw.SwitchRow({
		title: "Enable rounded corners",
		subtitle: "Toggle border radius rendering",
	});
	const defaultEnabledRow = new Adw.SwitchRow({
		title: "Enable borders by default",
	});
	const maximizedBordersRow = new Adw.SwitchRow({
		title: "Show borders on maximized windows",
	});
	behaviorGroup.add(radiusEnabledRow);
	behaviorGroup.add(defaultEnabledRow);
	behaviorGroup.add(maximizedBordersRow);

	settings.bind(
		"radius-enabled",
		radiusEnabledRow,
		"active",
		Gio.SettingsBindFlags.DEFAULT,
	);
	settings.bind(
		"default-enabled",
		defaultEnabledRow,
		"active",
		Gio.SettingsBindFlags.DEFAULT,
	);
	settings.bind(
		"default-maximized-borders",
		maximizedBordersRow,
		"active",
		Gio.SettingsBindFlags.DEFAULT,
	);

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

	settings.bind(
		"default-width",
		widthRow,
		"value",
		Gio.SettingsBindFlags.DEFAULT,
	);
	settings.bind(
		"default-margins",
		marginsRow,
		"value",
		Gio.SettingsBindFlags.DEFAULT,
	);
	settings.bind(
		"default-radius",
		radiusRow,
		"value",
		Gio.SettingsBindFlags.DEFAULT,
	);

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
	colorsGroup.add(activeColorRow);
	colorsGroup.add(inactiveColorRow);

	settings.bind(
		"default-active-color",
		activeColorRow,
		"text",
		Gio.SettingsBindFlags.DEFAULT,
	);
	settings.bind(
		"default-inactive-color",
		inactiveColorRow,
		"text",
		Gio.SettingsBindFlags.DEFAULT,
	);

	page.add(behaviorGroup);
	page.add(defaultsGroup);
	page.add(colorsGroup);
	return page;
}

function getPresetKeys(rawConfigs, includeDefault) {
	const presets = Object.keys(rawConfigs).filter(
		(key) =>
			key.startsWith("@") && (includeDefault || key !== DEFAULT_PRESET_KEY),
	);
	presets.sort((a, b) => {
		if (a === DEFAULT_PRESET_KEY) return -1;
		if (b === DEFAULT_PRESET_KEY) return 1;
		return a.localeCompare(b);
	});
	return presets;
}

function buildConfigRow({
	key,
	getRawConfigs,
	saveConfigs,
	refreshList,
	presets,
	allowPresetSelection,
	allowRemove,
	allowRename,
	validateKey = () => true,
	updateReferences = () => {},
}) {
	const isPreset = key.startsWith("@");
	let currentKey = key;
	const expander = new Adw.ExpanderRow({ title: currentKey });
	if (allowRemove) {
		const removeButton = new Gtk.Button({
			icon_name: "user-trash-symbolic",
			tooltip_text: "Remove",
			css_classes: ["destructive-action"],
		});
		removeButton.connectObject(
			"clicked",
			() => {
				const rawConfigs = getRawConfigs();
				delete rawConfigs[currentKey];
				saveConfigs();
				refreshList();
			},
			removeButton,
		);
		expander.add_suffix(removeButton);
	}

	const keyRow = new Adw.EntryRow({
		title: "Key",
		text: currentKey,
	});
	if (allowRename) {
		const renameButton = new Gtk.Button({
			label: "Rename",
			css_classes: ["flat"],
		});
		keyRow.add_suffix(renameButton);
		keyRow.activatable_widget = keyRow;

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
			if (rawConfigs[nextKey]) {
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
			refreshList();
		};

		renameButton.connectObject("clicked", tryRename, renameButton);
		keyRow.connectObject("activate", tryRename, keyRow);
	} else {
		keyRow.sensitive = false;
	}
	expander.add_row(keyRow);

	const availablePresets = presets || [];
	let presetRow = null;
	if (allowPresetSelection && !isPreset) {
		presetRow = new Adw.ComboRow({
			title: "Preset",
			model: createPresetModel(availablePresets),
		});
		expander.add_row(presetRow);
	}

	const editor = createConfigEditor();
	for (const row of editor.rows) expander.add_row(row);

	let updating = false;
	let isCustom = true;

	function setCustomSensitive(sensitive) {
		editor.setCustomSensitive(sensitive);
	}

	function ensureCustomConfig(fallbackPreset) {
		const rawConfigs = getRawConfigs();
		if (isObject(rawConfigs[currentKey])) return rawConfigs[currentKey];
		if (typeof rawConfigs[currentKey] === "string" && fallbackPreset) {
			const presetValue = rawConfigs[rawConfigs[currentKey]];
			rawConfigs[currentKey] = copyObject(
				isObject(presetValue) ? presetValue : {},
			);
		} else {
			rawConfigs[currentKey] = {};
		}
		return rawConfigs[currentKey];
	}

	function setConfigValue(updater) {
		const config = ensureCustomConfig(false);
		updater(config);
		saveConfigs();
	}

	function setConfigObject(config) {
		const rawConfigs = getRawConfigs();
		rawConfigs[currentKey] = config;
		saveConfigs();
	}

	function getPresetConfigForKey(presetKey) {
		return getPresetConfig(getRawConfigs(), presetKey);
	}

	function applyConfig(config) {
		editor.applyConfig(config);
	}

	function setPresetSelection() {
		const rawConfigs = getRawConfigs();
		if (isPreset) {
			expander.subtitle =
				currentKey === DEFAULT_PRESET_KEY
					? "Default preset"
					: "Preset definition";
			isCustom = true;
			setCustomSensitive(true);
			applyConfig(
				isObject(rawConfigs[currentKey]) ? rawConfigs[currentKey] : {},
			);
			return;
		}
		const value = rawConfigs[currentKey];
		if (typeof value === "string" && value.startsWith("@")) {
			const index = availablePresets.indexOf(value);
			updating = true;
			presetRow.selected = index >= 0 ? index + 1 : 0;
			updating = false;
			expander.subtitle = `Preset: ${value}`;
			isCustom = false;
			setCustomSensitive(false);
			applyConfig(getPresetConfigForKey(value));
		} else {
			updating = true;
			presetRow.selected = 0;
			updating = false;
			expander.subtitle = "Custom";
			isCustom = true;
			setCustomSensitive(true);
			applyConfig(isObject(value) ? value : {});
		}
	}

	if (presetRow) {
		presetRow.connectObject(
			"notify::selected",
			() => {
				if (updating) return;
				const selected = presetRow.selected;
				if (selected === 0) {
					const config = ensureCustomConfig(true);
					isCustom = true;
					expander.subtitle = "Custom";
					setCustomSensitive(true);
					applyConfig(config);
					saveConfigs();
					return;
				}

				const preset = availablePresets[selected - 1];
				if (!preset) return;
				const rawConfigs = getRawConfigs();
				rawConfigs[currentKey] = preset;
				saveConfigs();
				isCustom = false;
				expander.subtitle = `Preset: ${preset}`;
				setCustomSensitive(false);
				applyConfig(getPresetConfigForKey(preset));
			},
			presetRow,
		);
	}

	editor.connectHandlers({
		isCustom: () => isCustom,
		setConfigValue,
		onReset: () => {
			if (!isCustom) return;
			setConfigObject({});
			applyConfig({});
		},
	});

	setPresetSelection();
	return expander;
}

function buildConfigsPage(settings) {
	const page = new Adw.PreferencesPage({
		title: "App Configs",
		icon_name: "application-x-executable-symbolic",
	});
	let rawConfigs = parseAppConfigs(settings);
	const getRawConfigs = () => rawConfigs;
	const saveConfigs = () => saveAppConfigs(settings, rawConfigs);
	const isValidKey = (candidate) => candidate && !candidate.startsWith("@");

	const addGroup = new Adw.PreferencesGroup({ title: "Add App Config" });
	const addExpander = new Adw.ExpanderRow({
		title: "New app config",
		subtitle: "Set key and overrides before adding.",
		expanded: false,
	});
	addGroup.add(addExpander);

	const addKeyInfoRow = new Adw.ActionRow({
		title: "Key",
		subtitle: "Use app:ID, class:WM_CLASS, or regex.class:pattern",
	});
	addExpander.add_row(addKeyInfoRow);
	const addEntry = new Gtk.Entry({
		hexpand: true,
		halign: Gtk.Align.FILL,
		placeholder_text: "class:org.gnome.Terminal",
	});
	const addEntryRow = new Adw.PreferencesRow({ hexpand: true });
	addEntryRow.set_child(addEntry);
	addExpander.add_row(addEntryRow);

	const addPresetRow = new Adw.ComboRow({
		title: "Preset",
		model: createPresetModel(getPresetKeys(rawConfigs, false)),
	});
	addExpander.add_row(addPresetRow);

	let addDraftConfig = {};
	let addDraftPreset = null;
	let addIsCustom = true;
	let addPresetUpdating = false;
	const addEditor = createConfigEditor();
	for (const row of addEditor.rows) addExpander.add_row(row);

	const addActionRow = new Adw.ActionRow({
		title: "Add config",
		subtitle: "Creates the config and adds it to the list.",
	});
	const addButton = new Gtk.Button({
		label: "Add",
		css_classes: ["suggested-action"],
	});
	addActionRow.add_suffix(addButton);
	addExpander.add_row(addActionRow);

	const listGroup = new Adw.PreferencesGroup({
		title: "App Configs",
		description: "Unset values inherit from global defaults.",
	});

	function getPresetConfigForKey(presetKey) {
		return getPresetConfig(rawConfigs, presetKey);
	}

	function updateAddPresetModel() {
		addPresetUpdating = true;
		const presets = getPresetKeys(rawConfigs, false);
		addPresetRow.model = createPresetModel(presets);
		if (addDraftPreset && presets.includes(addDraftPreset)) {
			addPresetRow.selected = presets.indexOf(addDraftPreset) + 1;
		} else {
			addDraftPreset = null;
			addPresetRow.selected = 0;
		}
		addPresetUpdating = false;
	}

	function updateAddButtonState() {
		const key = addEntry.text.trim();
		addButton.sensitive = isValidKey(key) && !rawConfigs[key];
	}

	function resetAddForm() {
		addEntry.text = "";
		addDraftConfig = {};
		addDraftPreset = null;
		addIsCustom = true;
		addEditor.setCustomSensitive(true);
		addEditor.applyConfig(addDraftConfig);
		addPresetRow.selected = 0;
		updateAddButtonState();
	}

	function refreshList() {
		clearGroupChildren(listGroup);

		const appKeys = Object.keys(rawConfigs)
			.filter((key) => !key.startsWith("@"))
			.sort((a, b) => a.localeCompare(b));

		if (appKeys.length === 0) {
			listGroup.add(
				new Adw.ActionRow({
					title: "No configs yet",
					subtitle: "Add one above to get started.",
				}),
			);
			return;
		}

		const presets = getPresetKeys(rawConfigs, false);
		for (const key of appKeys) {
			listGroup.add(
				buildConfigRow({
					key,
					getRawConfigs,
					saveConfigs,
					refreshList,
					presets,
					allowPresetSelection: true,
					allowRemove: true,
					allowRename: true,
					validateKey: isValidKey,
					updateReferences: null,
				}),
			);
		}

		updateAddPresetModel();
		updateAddButtonState();
	}

	addButton.connectObject(
		"clicked",
		() => {
			const key = addEntry.text.trim();
			if (!key || key.startsWith("@")) return;
			if (rawConfigs[key]) return;
			if (addIsCustom) {
				rawConfigs[key] = copyObject(addDraftConfig);
			} else if (addDraftPreset) {
				rawConfigs[key] = addDraftPreset;
			} else {
				rawConfigs[key] = {};
			}
			saveConfigs();
			refreshList();
			resetAddForm();
		},
		addButton,
	);

	addEntry.connectObject("changed", updateAddButtonState, addEntry);
	addEntry.connectObject("activate", () => addButton.emit("clicked"), addEntry);

	addPresetRow.connectObject(
		"notify::selected",
		() => {
			if (addPresetUpdating) return;
			const presets = getPresetKeys(rawConfigs, false);
			const selected = addPresetRow.selected;
			if (selected === 0) {
				addIsCustom = true;
				addDraftPreset = null;
				addEditor.setCustomSensitive(true);
				addEditor.applyConfig(addDraftConfig);
				return;
			}

			const preset = presets[selected - 1];
			if (!preset) return;
			addIsCustom = false;
			addDraftPreset = preset;
			addEditor.setCustomSensitive(false);
			addEditor.applyConfig(getPresetConfigForKey(preset));
		},
		addPresetRow,
	);

	addEditor.connectHandlers({
		isCustom: () => addIsCustom,
		setConfigValue: (updater) => {
			updater(addDraftConfig);
		},
		onReset: () => {
			addDraftConfig = {};
			addEditor.applyConfig(addDraftConfig);
		},
	});

	addEditor.applyConfig(addDraftConfig);

	settings.connectObject(
		`changed::${APP_CONFIGS_KEY}`,
		() => {
			rawConfigs = parseAppConfigs(settings);
			refreshList();
		},
		settings,
	);

	refreshList();

	page.add(addGroup);
	page.add(listGroup);
	return page;
}

function buildPresetsPage(settings) {
	const page = new Adw.PreferencesPage({
		title: "Presets",
		icon_name: "view-list-symbolic",
	});
	let rawConfigs = parseAppConfigs(settings);
	const getRawConfigs = () => rawConfigs;
	const saveConfigs = () => saveAppConfigs(settings, rawConfigs);
	const isValidKey = (candidate) => candidate?.startsWith("@");

	function updateReferences(oldKey, newKey, configs) {
		for (const [configKey, value] of Object.entries(configs)) {
			if (typeof value === "string" && value === oldKey) {
				configs[configKey] = newKey;
			}
		}
	}

	const addGroup = new Adw.PreferencesGroup({ title: "Add Preset" });
	const addExpander = new Adw.ExpanderRow({
		title: "New preset",
		subtitle: "Define the preset before adding.",
		expanded: false,
	});
	addGroup.add(addExpander);

	const addKeyInfoRow = new Adw.ActionRow({
		title: "Key",
		subtitle: "Use @name for preset keys",
	});
	addExpander.add_row(addKeyInfoRow);
	const addEntry = new Gtk.Entry({
		hexpand: true,
		halign: Gtk.Align.FILL,
		placeholder_text: "@myPreset",
	});
	const addEntryRow = new Adw.PreferencesRow({ hexpand: true });
	addEntryRow.set_child(addEntry);
	addExpander.add_row(addEntryRow);

	let addDraftConfig = {};
	const addEditor = createConfigEditor();
	for (const row of addEditor.rows) addExpander.add_row(row);

	const addActionRow = new Adw.ActionRow({
		title: "Add preset",
		subtitle: "Creates the preset and adds it to the list.",
	});
	const addButton = new Gtk.Button({
		label: "Add",
		css_classes: ["suggested-action"],
	});
	addActionRow.add_suffix(addButton);
	addExpander.add_row(addActionRow);

	const listGroup = new Adw.PreferencesGroup({
		title: "Presets",
		description: "Preset definitions can be referenced by app configs.",
	});

	function updateAddButtonState() {
		const key = addEntry.text.trim();
		addButton.sensitive = isValidKey(key) && !rawConfigs[key];
	}

	function refreshList() {
		clearGroupChildren(listGroup);

		const presetKeys = getPresetKeys(rawConfigs, true);

		if (presetKeys.length === 0) {
			listGroup.add(
				new Adw.ActionRow({
					title: "No presets yet",
					subtitle: "Add one above to get started.",
				}),
			);
			return;
		}

		for (const key of presetKeys) {
			listGroup.add(
				buildConfigRow({
					key,
					getRawConfigs,
					saveConfigs,
					refreshList,
					presets: [],
					allowPresetSelection: false,
					allowRemove: key !== DEFAULT_PRESET_KEY,
					allowRename: key !== DEFAULT_PRESET_KEY,
					validateKey: isValidKey,
					updateReferences,
				}),
			);
		}

		updateAddButtonState();
	}

	addButton.connectObject(
		"clicked",
		() => {
			const key = addEntry.text.trim();
			if (!key || !key.startsWith("@")) return;
			if (rawConfigs[key]) return;
			rawConfigs[key] = copyObject(addDraftConfig);
			saveConfigs();
			refreshList();
			addEntry.text = "";
			addDraftConfig = {};
			addEditor.applyConfig(addDraftConfig);
		},
		addButton,
	);

	addEntry.connectObject(
		"changed",
		() => {
			updateAddButtonState();
		},
		addEntry,
	);
	addEntry.connectObject("activate", () => addButton.emit("clicked"), addEntry);

	addEditor.connectHandlers({
		isCustom: () => true,
		setConfigValue: (updater) => {
			updater(addDraftConfig);
		},
		onReset: () => {
			addDraftConfig = {};
			addEditor.applyConfig(addDraftConfig);
		},
	});

	addEditor.applyConfig(addDraftConfig);
	updateAddButtonState();

	settings.connectObject(
		`changed::${APP_CONFIGS_KEY}`,
		() => {
			rawConfigs = parseAppConfigs(settings);
			refreshList();
		},
		settings,
	);

	refreshList();

	page.add(addGroup);
	page.add(listGroup);
	return page;
}

function buildRawConfigPage(settings) {
	const page = new Adw.PreferencesPage({
		title: "Raw Config",
		icon_name: "text-x-generic-symbolic",
	});
	const group = new Adw.PreferencesGroup({
		title: "Raw JSON",
		description: "Edit and apply the stored app config JSON.",
	});
	group.hexpand = true;
	group.vexpand = true;

	const applyRow = new Adw.ActionRow({ title: "Apply changes" });
	const applyButton = new Gtk.Button({
		label: "Apply",
		css_classes: ["suggested-action"],
	});
	applyRow.add_suffix(applyButton);
	group.add(applyRow);

	const scroller = new Gtk.ScrolledWindow({
		hexpand: true,
		vexpand: true,
		min_content_height: 320,
	});
	const textBuffer = new Gtk.TextBuffer();
	const textView = new Gtk.TextView({
		buffer: textBuffer,
		monospace: true,
		wrap_mode: Gtk.WrapMode.NONE,
		hexpand: true,
		vexpand: true,
	});
	scroller.set_child(textView);

	const editorRow = new Adw.PreferencesRow({ hexpand: true, vexpand: true });
	editorRow.set_child(scroller);
	group.add(editorRow);

	let updating = false;
	let dirty = false;

	function setBufferFromConfigs(configs) {
		updating = true;
		textBuffer.set_text(JSON.stringify(configs, null, 2), -1);
		updating = false;
		dirty = false;
	}

	function getBufferText() {
		const start = textBuffer.get_start_iter();
		const end = textBuffer.get_end_iter();
		return textBuffer.get_text(start, end, false);
	}

	setBufferFromConfigs(parseAppConfigs(settings));

	textBuffer.connectObject(
		"changed",
		() => {
			if (updating) return;
			dirty = true;
		},
		textBuffer,
	);

	applyButton.connectObject(
		"clicked",
		() => {
			const rawText = getBufferText().trim();
			if (!rawText) return;
			let parsed = null;
			try {
				parsed = JSON.parse(rawText);
			} catch (_err) {
				return;
			}
			if (!isObject(parsed)) return;
			saveAppConfigs(settings, parsed);
			setBufferFromConfigs(parsed);
		},
		applyButton,
	);

	settings.connectObject(
		`changed::${APP_CONFIGS_KEY}`,
		() => {
			if (dirty) return;
			setBufferFromConfigs(parseAppConfigs(settings));
		},
		settings,
	);

	page.add(group);
	return page;
}

export default class P7BordersPreferences extends ExtensionPreferences {
	fillPreferencesWindow(window) {
		const settings = this.getSettings();
		window.set_default_size(760, 640);
		window.add(buildGlobalPage(settings));
		window.add(buildPresetsPage(settings));
		window.add(buildConfigsPage(settings));
		window.add(buildRawConfigPage(settings));
	}
}
