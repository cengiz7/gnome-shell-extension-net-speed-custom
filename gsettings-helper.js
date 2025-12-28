import Gio from "gi://Gio";

const SCHEMA_ID = "org.gnome.shell.extensions.net-speed-custom";

export function createSettings(extension) {
  const GioSSS = Gio.SettingsSchemaSource;
  let schemaSource = GioSSS.get_default();
  let schemaObj = null;

  if (schemaSource) {
    schemaObj = schemaSource.lookup(SCHEMA_ID, true);
  }

  if (!schemaObj && extension) {
    try {
      const schemaDir = extension.dir.get_child("schemas").get_path();
      const customSource = GioSSS.new_from_directory(
        schemaDir,
        schemaSource,
        false
      );
      schemaObj = customSource.lookup(SCHEMA_ID, true);
    } catch (e) {
      console.warn(`Schema ${SCHEMA_ID} lookup failed: ${e}`);
      return null;
    }
  }

  if (!schemaObj) {
    console.warn(`Schema ${SCHEMA_ID} not found`);
    return null;
  }

  try {
    return new Gio.Settings({ settings_schema: schemaObj });
  } catch (e) {
    console.warn(`Settings creation failed: ${e}`);
    return null;
  }
}

export function readDouble(settings, key) {
  if (!settings) return null;
  try {
    return settings.get_double(key);
  } catch (e) {
    console.warn(`Read double '${key}' failed: ${e}`);
    return null;
  }
}

export function writeDouble(settings, key, value) {
  if (!settings) return;
  try {
    settings.set_double(key, value);
  } catch (e) {
    console.warn(`Write double '${key}' failed: ${e}`);
  }
}

export function readString(settings, key) {
  if (!settings) return null;
  try {
    return settings.get_string(key);
  } catch (e) {
    console.warn(`Read string '${key}' failed: ${e}`);
    return null;
  }
}

export function writeString(settings, key, value) {
  if (!settings) return;
  try {
    settings.set_string(key, value);
  } catch (e) {
    console.warn(`Write string '${key}' failed: ${e}`);
  }
}
