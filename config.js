// config.js

import Gio from 'gi://Gio';

export class ConfigManager {
    constructor() {
        this.appConfigFallback = {
            margins: 0,
            radius: 0,
            width: 0,
            activeColor: this._getAccentColor(),
            inactiveColor: 'rgba(102, 102, 102, 0.2)',
            enabled: false,
        };

        this.radiusEnabled = true;
        this.maximizedBordersEnabled = true;

        const rawAppConfigs = {
            '@default': {
                width: 4,
            },
            // Preset definitions
            '@electronPreset': {},
            '@chromePreset': {
                margins: { top: -10, right: -16, bottom: -32, left: -16 },
                radius: { tl: 12, tr: 12, br: 0, bl: 0 },
            },
            '@gnomePreset': {
                margins: { top: -25, right: -25, bottom: -25, left: -25 },
                radius: 18,
            },
            '@gtk3Preset': {
                margins: { top: -22, right: -25, bottom: -28, left: -25 },
                radius: { tl: 12, tr: 12, br: 0, bl: 0 }
            },
            '@firefoxPreset': {
                margins: { top: -22, right: -25, bottom: -28, left: -25 },
                radius: { tl: 18, tr: 18, br: 0, bl: 0 }
            },
            '@zedPreset': {
                margins: { top: -10, right: -10, bottom: -10, left: -10 },
                radius: 14,
            },
            '@qtPreset': {
                margins: { top: -25, right: -25, bottom: -24, left: -25 },
                radius: { tl: 18, tr: 18, br: 0, bl: 0 },
            },
            'regex.class:^org.gnome*': '@gnomePreset',
            'regex.class:^google-chrome*': '@chromePreset',
            'regex.class:^chrome-*': '@chromePreset',
            'class:org.gnome.Terminal': '@gtk3Preset',
            'class:vlc': '@qtPreset',
            'class:firefox': '@firefoxPreset',
            'class:dev.zed.Zed': '@zedPreset',
            'class:io.ente.auth': '@gtk3Preset',
            'class:obsidian': '@electronPreset',
            'class:zulip': '@electronPreset',
            'class:slack': '@electronPreset',
            'class:code': '@electronPreset',
            'class:mpv': '@electronPreset',
            'class:spotify': '@electronPreset',
            'class:discord': '@electronPreset',
            'class:org.gimp.GIMP': '@gtk3Preset',
            'class:org.inkscape.Inkscape': '@gtk3Preset',
            'class:krita': '@qtPreset',
            'class:qpwgraph': '@qtPreset',
            'class:foot': {
                margins: { top: 27 },
            },
            'class:Alacritty': {
                margins: { top: 36 },
            },
        };
        
        // Extract presets and resolve preset references
        const resolvedConfigs = this._resolvePresets(rawAppConfigs);
        
        // Normalize all configs during initialization
        this.appConfigs = {};
        
        // First, create a complete @default by merging with fallback
        const defaultRawConfig = rawAppConfigs['@default'] || {};
        const defaultConfig = this.normalizeConfig({ ...this.appConfigFallback, ...defaultRawConfig });
        this.appConfigs['@default'] = defaultConfig;
        
        // Then normalize all other configs using the complete @default as base
        for (const [key, rawConfig] of Object.entries(resolvedConfigs)) {
            if (!key.startsWith('@')) {
                this.appConfigs[key] = this.normalizeConfig({ 
                    ...defaultConfig, 
                    ...{ enabled: true }, 
                    ...rawConfig });
            }
        }
    }

    _getAccentColor() {
        // Custom color that works well for all dark and light themes
        const defaultAccent = 'rgba(51, 153, 230, 0.4)'; 
        try {
            // Try to get GNOME's accent color preference
            const interfaceSettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });
            const accentColor = interfaceSettings.get_string('accent-color');
            
            // Map GNOME accent colors to RGBA values with alpha 0.4
            const accentColorMap = {
                'blue': 'rgba(53, 132, 228, 0.4)',
                'teal': 'rgba(51, 209, 122, 0.4)', 
                'green': 'rgba(46, 194, 126, 0.4)',
                'yellow': 'rgba(248, 228, 92, 0.4)',
                'orange': 'rgba(255, 120, 0, 0.4)',
                'red': 'rgba(237, 51, 59, 0.4)',
                'pink': 'rgba(224, 27, 36, 0.4)',
                'purple': 'rgba(145, 65, 172, 0.4)',
                'slate': 'rgba(99, 104, 128, 0.4)',
            };
            
            return accentColorMap[accentColor] || defaultAccent; // Default to our custom color
        } catch (_err) {
            // Fallback to blue if accent color detection fails
            return defaultAccent;
        }
    }

    _resolvePresets(rawConfigs) {
        // First, extract all presets (keys starting with @)
        const presets = {};
        const appConfigs = {};
        
        for (const [key, value] of Object.entries(rawConfigs)) {
            if (key.startsWith('@')) {
                presets[key] = value;
            } else {
                appConfigs[key] = value;
            }
        }
        
        // Resolve preset references in app configs
        const resolvedConfigs = {};
        for (const [key, value] of Object.entries(appConfigs)) {
            if (typeof value === 'string' && value.startsWith('@')) {
                // This is a preset reference
                const presetConfig = presets[value];
                if (presetConfig !== undefined) {
                    resolvedConfigs[key] = presetConfig;
                } else {
                    console.warn(`[p7-borders] Unknown preset reference: ${value} for ${key}`);
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
        const appId = metaWindow.get_gtk_application_id?.() || '';
        const wmClass = (metaWindow.get_wm_class?.() || '');

        // Try exact matches first
        const exactMatch = this.appConfigs[`app:${appId}`] || 
                          this.appConfigs[`class:${wmClass}`];
        
        if (exactMatch) return exactMatch;
        
        // Try pattern matches  
        for (const [key, config] of Object.entries(this.appConfigs)) {
            if (key === '@default' || !key.startsWith('regex.')) continue;
            
            if (key.startsWith('regex.app:') && appId && this._matches(appId, key.slice(11))) {
                return config;
            }
            if (key.startsWith('regex.class:') && wmClass && this._matches(wmClass, key.slice(13))) {
                return config;
            }
        }
        
        return this.appConfigs['@default'];
    }

    _matches(text, pattern) {
        try {
            return new RegExp(pattern, 'i').test(text);
        } catch {
            return false; // Invalid regex patterns don't match
        }
    }

    normalizeConfig(config = {}) {
        // Normalize margins and radius to proper object format
        const normalized = { ...config };
        normalized.margins = this.normalizeMargins(normalized.margins);
        normalized.radius = this.normalizeRadius(normalized.radius);
        
        return normalized;
    }

    normalizeMargins(margins) {
        // Handle single number input
        if (typeof margins === 'number') {
            const value = margins | 0;
            return { top: value, right: value, bottom: value, left: value };
        }
        
        // Handle object input - allow negative values
        return {
            top: (margins.top ?? 0) | 0,
            right: (margins.right ?? 0) | 0,
            bottom: (margins.bottom ?? 0) | 0,
            left: (margins.left ?? 0) | 0
        };
    }

    normalizeRadius(radius) {
        // Handle single number input
        if (typeof radius === 'number') {
            const value = Math.max(0, radius | 0);
            return { tl: value, tr: value, br: value, bl: value };
        }
        
        // Handle object input
        return {
            tl: Math.max(0, (radius.tl ?? 0) | 0),
            tr: Math.max(0, (radius.tr ?? 0) | 0),
            br: Math.max(0, (radius.br ?? 0) | 0),
            bl: Math.max(0, (radius.bl ?? 0) | 0)
        };
    }
}