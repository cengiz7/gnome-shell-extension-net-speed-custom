// gsettings-helper.js
// Utility for GSettings read/write operations for GNOME Shell extensions

import Gio from 'gi://Gio';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const SCHEMA = 'org.gnome.shell.extensions.net-speed-custom';

let _settings = null;
let _extension = null;

let _settingsAvailable = true;

export function init(extension) {
    _extension = extension;
}

export function isAvailable() {
    return _settingsAvailable;
}

export function getSettings() {
    if (!_settings && _settingsAvailable) {
        const GioSSS = Gio.SettingsSchemaSource;
        let schemaSource = GioSSS.get_default();
        let schemaObj = null;
        if (schemaSource) schemaObj = schemaSource.lookup(SCHEMA, true);
        if (!schemaObj) {
            try {
                const schemaDir = _extension.dir.get_child('schemas').get_path();
                const schemaSource2 = GioSSS.new_from_directory(schemaDir, schemaSource, false);
                schemaObj = schemaSource2.lookup(SCHEMA, true);
            } catch (e) {
                // Schema not found - disable settings
                console.warn(`GSettings schema ${SCHEMA} not found. Extension will run with default settings (no persistence).`);
                _settingsAvailable = false;
                return null;
            }
        }
        if (!schemaObj) {
            console.warn(`Schema ${SCHEMA} could not be found. Extension will run with default settings (no persistence).`);
            _settingsAvailable = false;
            return null;
        }
        try {
            _settings = new Gio.Settings({ settings_schema: schemaObj });
        } catch (e) {
            console.warn(`Failed to create GSettings: ${e}. Extension will run with default settings (no persistence).`);
            _settingsAvailable = false;
            return null;
        }
    }
    return _settings;
}

export function getValue(key) {
    let settings = getSettings();
    return settings.get_value(key).deep_unpack();
}

export function setValue(key, value) {
    let settings = getSettings();
    let current = settings.get_value(key);
    current = current.dup();
    current.init(value);
    settings.set_value(key, current);
}

export function getString(key) {
    try {
        const settings = getSettings();
        return settings ? settings.get_string(key) : null;
    } catch (e) {
        console.warn(`Failed to get string '${key}': ${e}`);
        return null;
    }
}

export function setString(key, value) {
    try {
        const settings = getSettings();
        if (settings) settings.set_string(key, value);
    } catch (e) {
        console.warn(`Failed to set string '${key}': ${e}`);
    }
}

export function getInt(key) {
    try {
        const settings = getSettings();
        return settings ? settings.get_int(key) : null;
    } catch (e) {
        console.warn(`Failed to get int '${key}': ${e}`);
        return null;
    }
}

export function setInt(key, value) {
    try {
        const settings = getSettings();
        if (settings) settings.set_int(key, value);
    } catch (e) {
        console.warn(`Failed to set int '${key}': ${e}`);
    }
}

export function getBoolean(key) {
    try {
        const settings = getSettings();
        return settings ? settings.get_boolean(key) : null;
    } catch (e) {
        console.warn(`Failed to get boolean '${key}': ${e}`);
        return null;
    }
}

export function setBoolean(key, value) {
    try {
        const settings = getSettings();
        if (settings) settings.set_boolean(key, value);
    } catch (e) {
        console.warn(`Failed to set boolean '${key}': ${e}`);
    }
}

export function getDouble(key) {
    try {
        const settings = getSettings();
        return settings ? settings.get_double(key) : null;
    } catch (e) {
        console.warn(`Failed to get double '${key}': ${e}`);
        return null;
    }
}

export function setDouble(key, value) {
    try {
        const settings = getSettings();
        if (settings) settings.set_double(key, value);
    } catch (e) {
        console.warn(`Failed to set double '${key}': ${e}`);
    }
}
