/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */


import GObject from "gi://GObject";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Clutter from "gi://Clutter";
import St from "gi://St";

// Import GSettings helper
import * as GSettingsHelper from './gsettings-helper.js';

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import { PopupBaseMenuItem } from "resource:///org/gnome/shell/ui/popupMenu.js";
import {Extension} from "resource:///org/gnome/shell/extensions/extension.js";


// Use bytes per second units
const SPEED_UNITS = [
  "B/s", "KB/s", "MB/s", "GB/s", "TB/s", "PB/s", "EB/s", "ZB/s", "YB/s"
];
// Compute unit column width from defined units so unit strings occupy a fixed space
const UNIT_WIDTH = Math.max(...SPEED_UNITS.map(u => u.length));
// Default interval. Use decimal refresh interval (e.g., 0.5 seconds)
const REFRESH_INTERVAL = 1.0; 
// Choose a fixed width for the amount column (characters).
// This width should be large enough to hold values like "999.99".
const BYTES_AMOUNT_WIDTH = 4;
const DOWN_ARROW_ALTERNATIVES = ['⇣', '↡', '⬇', '↓', '⇓', '⇩', '↧', '⇊'];
const UP_ARROW_ALTERNATIVES = ['⇡', '↟', '⬆', '↑', '⇑', '⇧', '↥', '⇈'];
const DEFAULT_DOWN_ARROW = '⇣';
const DEFAULT_UP_ARROW = '⇡';
const DEFAULT_DOWNLOAD_COLOR = '#3fd7e5';
const DEFAULT_UPLOAD_COLOR = '#ffb84d';
const DEFAULT_FONT_SIZE = 'inherit';

// We want arrows and units to stay in fixed positions.
// Format returns {amount, unit}. We'll left-align the numeric `amount` part
// by padding it on the right with NBSPs so its width is stable while
// arrows (on the left) and unit strings (on the right) remain static.
const NBSP = '\u00A0';


// `ifb`: Created by python-based bandwidth manager "traffictoll".
// `lxdbr`: Created by lxd container manager.
// Add more virtual interface prefixes here.
const virtualIfacePrefixes = [
  "lo", "ifb", "lxdbr", "virbr", "br", "vnet", "tun", "tap", "docker", "utun",
  "wg", "veth"
];

const isVirtualIface = (name) => {
  return virtualIfacePrefixes.some((prefix) => {
    return name.startsWith(prefix);
  });
};

const formatSpeedWithUnit = (amount) => {
  // amount is in bytes per second
  let unitIndex = 0;
  while (amount >= 1000 && unitIndex < SPEED_UNITS.length - 1) {
    amount /= 1000;
    ++unitIndex;
  }

  let digits = 0;
  if (amount >= 100 || amount - 0 < 0.01) {
    digits = 0;
  } else if (amount >= 10) {
    digits = 1;
  } else {
    digits = 2;
  }

  // Return amount and unit separately so we can align amount only
  return { amount: amount.toFixed(digits), unit: SPEED_UNITS[unitIndex] };
};

const padRight = (s, width) => {
  const padCount = Math.max(0, width - s.length);
  return s + NBSP.repeat(padCount);
};

const toSpeedParts = (speed, downArrow, upArrow) => {
  const downParts = formatSpeedWithUnit(speed["down"]);
  const upParts = formatSpeedWithUnit(speed["up"]);

  // Use provided arrows or defaults
  const dArrow = downArrow || DEFAULT_DOWN_ARROW;
  const uArrow = upArrow || DEFAULT_UP_ARROW;

  // Build each side: arrow + space + amount (left-aligned in fixed width) + space + unit (right-aligned in fixed width)
  const downloadText = `${dArrow}${padRight(downParts.amount, BYTES_AMOUNT_WIDTH)}${padRight(downParts.unit, UNIT_WIDTH)}`;
  const uploadText = `${uArrow}${padRight(upParts.amount, BYTES_AMOUNT_WIDTH)}${padRight(upParts.unit, UNIT_WIDTH)}`;
  return { downloadText, uploadText };
};

const Indicator = GObject.registerClass(
  class Indicator extends PanelMenu.Button {
    _init() {
      super._init(0.0, "Net Speed Custom", false);

      // Settings for color/font size/arrows
      this._refreshInterval = REFRESH_INTERVAL;
      this._downloadColor = DEFAULT_DOWNLOAD_COLOR;
      this._uploadColor = DEFAULT_UPLOAD_COLOR;
      this._fontSize = DEFAULT_FONT_SIZE;
      this._downArrow = DEFAULT_DOWN_ARROW;
      this._upArrow = DEFAULT_UP_ARROW;

      this._signalHandlers = [];

      const defaultLabelStyle = 'font-size: 15px; font-weight: 500; margin-right: 0.5em; align-items: center;';
      const defaultInputSettings = {
        text: 'Placeholder',
        can_focus: true,
        x_expand: false,
        track_hover: true,
        style: 'min-width: 60px; max-width: 80px; padding: 2px 6px; border-radius: 6px; font-size: 14px; background-color: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.15); color: #ffffff;'
      };

      // Helper to make a row with label and input/button, vertically centered
      function makeInputRow(label, widget) {
        let row = new St.BoxLayout({
          vertical: false,
          x_align: Clutter.ActorAlign.FILL,
          y_align: Clutter.ActorAlign.CENTER,
          style: 'spacing: 10px; min-width: 280px;'
        });
        label.set_x_align(Clutter.ActorAlign.START);
        label.set_x_expand(true);
        widget.set_x_align(Clutter.ActorAlign.END);
        widget.set_x_expand(false);
        row.add_child(label);
        row.add_child(widget);
        return row;
      }

      /*##############  Begin Net Speed Display Box  ##############*/

      this._box = new St.BoxLayout({ vertical: false });
      this._downloadLabel = new St.Label({
        y_align: Clutter.ActorAlign.CENTER,
        style: this._getLabelStyle('download')
      });
      this._uploadLabel = new St.Label({
        y_align: Clutter.ActorAlign.CENTER,
        style: this._getLabelStyle('upload')
      });
      this._box.add_child(this._downloadLabel);
      this._box.add_child(this._uploadLabel);
      this.add_child(this._box);

      /*##############  End Net Speed Display Box  ##############*/

      /*##############  Begin Popup Menu Display  ##############*/

      // Refresh interval input Menu Box
      this._refreshLabel = new St.Label({text: 'Refresh Secs (1.0): ', style: defaultLabelStyle, y_align: Clutter.ActorAlign.CENTER });
      this._refreshEntry = new St.Entry({
        ...defaultInputSettings,
        text: REFRESH_INTERVAL.toString()
      });
      let refreshRow = makeInputRow(this._refreshLabel, this._refreshEntry);
      let menuItem = new PopupBaseMenuItem({ activate: false, can_focus: false, reactive: false });
      menuItem.add_child(refreshRow);
      this.menu.addMenuItem(menuItem);

      // Color and font size settings Menu Box
      this._colorFontBox = new St.BoxLayout({ vertical: true, x_align: Clutter.ActorAlign.START });
      this._downloadColorLabel = new St.Label({ text: 'Download Color (Hex):', style: defaultLabelStyle, y_align: Clutter.ActorAlign.CENTER });
      this._downloadColorEntry = new St.Entry({
        ...defaultInputSettings,
        text: this._downloadColor.replace('#',''),
        style: defaultInputSettings.style + `color: #3fd7e5 !important;`
      });
      this._uploadColorLabel = new St.Label({ text: 'Upload Color (Hex):', style: defaultLabelStyle, y_align: Clutter.ActorAlign.CENTER });
      this._uploadColorEntry = new St.Entry({
        ...defaultInputSettings,
        text: this._uploadColor.replace('#',''),
        style: defaultInputSettings.style + `color: #ffb84d !important;`
      });
      this._fontSizeLabel = new St.Label({ text: 'Font Size (px|em|pt|%):', style: defaultLabelStyle, y_align: Clutter.ActorAlign.CENTER });
      this._fontSizeEntry = new St.Entry({
        ...defaultInputSettings,
        text: this._fontSize
      });
      
      // Combined arrow selection button
      this._arrowLabel = new St.Label({ text: `Change Icons (1-${DOWN_ARROW_ALTERNATIVES.length}):`, style: defaultLabelStyle, y_align: Clutter.ActorAlign.CENTER });
      this._arrowIndex = 0;
      // Find initial index based on down arrow
      const initialIndex = DOWN_ARROW_ALTERNATIVES.indexOf(this._downArrow);
      if (initialIndex !== -1) this._arrowIndex = initialIndex;
      
      this._arrowButton = new St.Button({
        label: `${this._arrowIndex + 1}) ${this._downArrow}  -  ${this._upArrow}`,
        style_class: 'button',
        can_focus: true,
        track_hover: true,
        style: 'min-width: 100px; padding: 4px 12px; border-radius: 6px; font-size: 16px; background-color: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.15); color: #ffffff;'
      });
      
      this._colorFontBox.add_child(makeInputRow(this._downloadColorLabel, this._downloadColorEntry));
      this._colorFontBox.add_child(makeInputRow(this._uploadColorLabel, this._uploadColorEntry));
      this._colorFontBox.add_child(makeInputRow(this._fontSizeLabel, this._fontSizeEntry));
      this._colorFontBox.add_child(makeInputRow(this._arrowLabel, this._arrowButton));
      let colorFontMenuItem = new PopupBaseMenuItem({ activate: false, can_focus: false, reactive: false });
      colorFontMenuItem.add_child(this._colorFontBox);
      this.menu.addMenuItem(colorFontMenuItem);

      /*##############  End Popup Menu Display  ##############*/

      // Set initial net speed to 0
      const { downloadText, uploadText } = toSpeedParts({ down: 0, up: 0 }, this._downArrow, this._upArrow);
      this._downloadLabel.set_text(downloadText);
      this._uploadLabel.set_text(uploadText);

      // Handlers for color/font size changes
      const updateColorsAndFont = () => {
        // Prevent running if destroyed
        if (!this._downloadColorEntry || this._downloadColorEntry.destroyed ||
            !this._uploadColorEntry || this._uploadColorEntry.destroyed ||
            !this._fontSizeEntry || this._fontSizeEntry.destroyed)
          return;
        let dColor = this._downloadColorEntry.get_text().trim().replace(/^#/, '');
        let uColor = this._uploadColorEntry.get_text().trim().replace(/^#/, '');
        let fSize = this._fontSizeEntry.get_text().trim().toLowerCase();
        if (/^[0-9a-fA-F]{6}$/.test(dColor)) {
          this._downloadColor = '#' + dColor;
          this._downloadColorEntry.set_style(this._getEntryStyle(this._downloadColor));
        }
        if (/^[0-9a-fA-F]{6}$/.test(uColor)) {
          this._uploadColor = '#' + uColor;
          this._uploadColorEntry.set_style(this._getEntryStyle(this._uploadColor));
        }
        // Accept 'inherit', or a number (treated as px), or a valid CSS size
        if (fSize === '' || fSize === 'inherit') {
          this._fontSize = 'inherit';
        } else if (/^[0-9]+$/.test(fSize)) {
          this._fontSize = fSize + 'px';
        } else if (/^[0-9]+(px|em|pt|%)$/.test(fSize)) {
          this._fontSize = fSize;
        } // else ignore invalid
        // Now update label styles and notify
        if (this._downloadLabel && !this._downloadLabel.destroyed)
          this._updateLabelStyles(this._downloadLabel, this._getLabelStyle('download'));
        if (this._uploadLabel && !this._uploadLabel.destroyed)
          this._updateLabelStyles(this._uploadLabel, this._getLabelStyle('upload'));
        if (this._onColorFontChanged)
          this._onColorFontChanged();
        if (global.stage) global.stage.set_key_focus(null);
      };

      // Handler for refresh interval changes
      const updateRefreshInterval = () => {
        // Prevent running if destroyed
        if (!this._refreshEntry || this._refreshEntry.destroyed)
          return;
        let val = parseFloat(this._refreshEntry.get_text().trim());
        if (isNaN(val) || val <= 0) {
          // fallback to default if invalid
          val = REFRESH_INTERVAL;
        }
        this._refreshInterval = val;
        if (this._onRefreshChanged) this._onRefreshChanged();
      };

      // Connect signals and track all in _signalHandlers for cleanup
      this._connectSignal(this._downloadColorEntry.get_clutter_text(), 'activate', updateColorsAndFont);
      this._connectSignal(this._downloadColorEntry.get_clutter_text(), 'key-focus-out', (actor) => { updateColorsAndFont(); return Clutter.EVENT_PROPAGATE; });
      this._connectSignal(this._uploadColorEntry.get_clutter_text(), 'activate', updateColorsAndFont);
      this._connectSignal(this._uploadColorEntry.get_clutter_text(), 'key-focus-out', (actor) => { updateColorsAndFont(); return Clutter.EVENT_PROPAGATE; });
      this._connectSignal(this._fontSizeEntry.get_clutter_text(), 'activate', updateColorsAndFont);
      this._connectSignal(this._fontSizeEntry.get_clutter_text(), 'key-focus-out', (actor) => { updateColorsAndFont(); return Clutter.EVENT_PROPAGATE; });
      
      // Combined arrow button click handler - cycle through arrow pairs
      this._connectSignal(this._arrowButton, 'clicked', () => {
        this._arrowIndex = (this._arrowIndex + 1) % DOWN_ARROW_ALTERNATIVES.length;
        this._downArrow = DOWN_ARROW_ALTERNATIVES[this._arrowIndex];
        this._upArrow = UP_ARROW_ALTERNATIVES[this._arrowIndex];
        this._arrowButton.set_label(`${this._arrowIndex + 1}) ${this._downArrow}  -  ${this._upArrow}`);
        if (this._onColorFontChanged) this._onColorFontChanged();
      });
      
      this._connectSignal(this._refreshEntry.get_clutter_text(), 'activate', updateRefreshInterval);
      this._connectSignal(this._refreshEntry.get_clutter_text(), 'notify::text', () => {
        if (this._refreshTimeoutId) GLib.source_remove(this._refreshTimeoutId);
        this._refreshTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
          updateRefreshInterval();
          this._refreshTimeoutId = null;
          return GLib.SOURCE_REMOVE;
        });
      });
      if (this.menu && this.menu.actor) {
        this._connectSignal(this.menu.actor, 'button-press-event', () => {
          global.stage.set_key_focus(null);
          return Clutter.EVENT_PROPAGATE;
        });
      }
    }

    _connectSignal(object, signal, handler) {
      if (!object) return;
      const id = object.connect(signal, handler);
      this._signalHandlers.push({ object, id });
    }

    _disconnectAllSignals() {
      this._signalHandlers.forEach(({ object, id }) => {
        if (object && id) object.disconnect(id);
      });
      this._signalHandlers = [];
    }

    destroy() {
      // Remove any pending refresh timeout
      if (this._refreshTimeoutId) {
        GLib.source_remove(this._refreshTimeoutId);
        this._refreshTimeoutId = null;
      }
      // Disconnect all signal handlers
      this._disconnectAllSignals();
      // Destroy child widgets
      [this._downloadColorEntry, this._uploadColorEntry, this._fontSizeEntry, this._arrowButton, this._downloadLabel, this._uploadLabel].forEach(w => {
        if (w && w.destroy) w.destroy();
      });
      super.destroy();
    }

    _getEntryStyle(color) {
      return `min-width: 60px; max-width: 80px; padding: 2px 5px; border-radius: 5px; background-color: rgba(255,255,255,0.07); color: ${color}; border: 1px solid rgba(255,255,255,0.15); font-size: 13px;`;
    }

    _getLabelStyle(which) {
      let color = which === 'download' ? this._downloadColor : this._uploadColor;
      let fontSize = this._fontSize;
      let margin = which === 'upload' ? 'margin-left: 10px;' : '';
      return `font-family: monospace; font-weight: 500; font-size: ${fontSize}; ${margin} color: ${color};`;
    }

    // Reusable update label styles and notify
    _updateLabelStyles = (label, style) => {
      label.set_style(style);
      label.queue_relayout();
      label.queue_redraw();
    }


    setText({ downloadText, uploadText }) {
      this._downloadLabel.set_text(downloadText);
      this._uploadLabel.set_text(uploadText);
    }

    getArrows() {
      return { downArrow: this._downArrow, upArrow: this._upArrow };
    }

    setOnRefreshChanged(cb) {
      this._onRefreshChanged = cb;
    }

    setOnColorFontChanged(cb) {
      this._onColorFontChanged = cb;
    }

    setColorFontSettings({ downloadColor, uploadColor, fontSize, downArrow, upArrow }) {
      this._downloadColor = downloadColor || DEFAULT_DOWNLOAD_COLOR;
      this._uploadColor = uploadColor || DEFAULT_UPLOAD_COLOR;
      this._fontSize = fontSize || DEFAULT_FONT_SIZE;
      this._downArrow = downArrow || DEFAULT_DOWN_ARROW;
      this._upArrow = upArrow || DEFAULT_UP_ARROW;
      
      // Update arrow index
      this._arrowIndex = DOWN_ARROW_ALTERNATIVES.indexOf(this._downArrow);
      if (this._arrowIndex === -1) this._arrowIndex = 0;
      
      this._downloadColorEntry.set_text(this._downloadColor.replace('#',''));
      this._downloadColorEntry.set_style(this._getEntryStyle(this._downloadColor));
      this._uploadColorEntry.set_text(this._uploadColor.replace('#',''));
      this._uploadColorEntry.set_style(this._getEntryStyle(this._uploadColor));
      this._fontSizeEntry.set_text(this._fontSize);
      this._fontSizeEntry.set_style(this._getEntryStyle("#ffffff"));
      this._arrowButton.set_label(`${this._arrowIndex + 1}:  ${this._downArrow}  -  ${this._upArrow}`);
      this._downloadLabel.set_style(this._getLabelStyle('download'));
      this._downloadLabel.queue_relayout();
      this._downloadLabel.queue_redraw();
      this._uploadLabel.set_style(this._getLabelStyle('upload'));
      this._uploadLabel.queue_relayout();
      this._uploadLabel.queue_redraw();
    }

    setRefreshInterval(val) {
      if (typeof val !== 'number' || isNaN(val) || val <= 0) val = REFRESH_INTERVAL;
      this._refreshInterval = val;
      this._refreshEntry.set_text(val.toString());
    }
  });

export default class NetSpeedCustom extends Extension {
  constructor(metadata) {
    super(metadata);

    this._metadata = metadata;
    this._uuid = metadata.uuid;
  }


  _loadSettings() {
    // Try to use GSettings for persistence, fall back to defaults
    try {
      this._refreshInterval = GSettingsHelper.getDouble('refresh-interval') || REFRESH_INTERVAL;
      this._downloadColor = GSettingsHelper.getString('download-color') || DEFAULT_DOWNLOAD_COLOR;
      this._uploadColor = GSettingsHelper.getString('upload-color') || DEFAULT_UPLOAD_COLOR;
      this._fontSize = GSettingsHelper.getString('font-size') || DEFAULT_FONT_SIZE;
      this._downArrow = GSettingsHelper.getString('down-arrow') || DEFAULT_DOWN_ARROW;
      this._upArrow = GSettingsHelper.getString('up-arrow') || DEFAULT_UP_ARROW;
    } catch (e) {
      console.warn('Failed to load settings, using defaults: ' + e);
      this._refreshInterval = REFRESH_INTERVAL;
      this._downloadColor = DEFAULT_DOWNLOAD_COLOR;
      this._uploadColor = DEFAULT_UPLOAD_COLOR;
      this._fontSize = DEFAULT_FONT_SIZE;
      this._downArrow = DEFAULT_DOWN_ARROW;
      this._upArrow = DEFAULT_UP_ARROW;
    }
  }

  _saveSettings() {
    // Only save if GSettings is available
    if (!GSettingsHelper.isAvailable()) {
      return;
    }
    try {
      GSettingsHelper.setDouble('refresh-interval', this._indicator?._refreshInterval || this._refreshInterval);
      GSettingsHelper.setString('download-color', this._indicator?._downloadColor || this._downloadColor);
      GSettingsHelper.setString('upload-color', this._indicator?._uploadColor || this._uploadColor);
      GSettingsHelper.setString('font-size', this._indicator?._fontSize || this._fontSize);
      GSettingsHelper.setString('down-arrow', this._indicator?._downArrow || this._downArrow);
      GSettingsHelper.setString('up-arrow', this._indicator?._upArrow || this._upArrow);
    } catch (e) {
      console.warn('Failed to save settings: ' + e);
    }
  }

  enable() {
    // Initialize GSettings helper with extension object
    try {
      GSettingsHelper.init(this);
    } catch (e) {
      console.warn('GSettings initialization failed, extension will use defaults: ' + e);
    }
    
    // No external stylesheet needed; colors are set inline.
    this._textDecoder = new TextDecoder();
    this._lastSum = {"down": 0, "up": 0};
    this._lastTime = GLib.get_monotonic_time() / 1e6; // seconds
    this._timeout = null;

    // Load persisted settings (if any) before creating UI so entry shows saved value
    this._loadSettings();

    this._indicator = new Indicator();
    // If refresh interval/color/font/arrow settings loaded, apply to indicator
    if (this._downloadColor || this._uploadColor || this._fontSize || this._downArrow || this._upArrow) {
      this._indicator.setColorFontSettings({
        downloadColor: this._downloadColor,
        uploadColor: this._uploadColor,
        fontSize: this._fontSize,
        downArrow: this._downArrow,
        upArrow: this._upArrow
      });
    }
    if (this._refreshInterval) {
      this._indicator.setRefreshInterval(this._refreshInterval);
    }
    Main.panel.addToStatusArea(this._uuid, this._indicator, 0, "right");

    this._indicator.setOnRefreshChanged(() => {
      // Update our value from indicator
      this._refreshInterval = this._indicator._refreshInterval;
      this._restartTimeout();
      this._saveSettings();
    });

    this._indicator.setOnColorFontChanged(() => {
      this._saveSettings();
    });

    this._startTimeout();
  }

  _startTimeout() {
    if (this._timeout) {
      GLib.source_remove(this._timeout);
      this._timeout = null;
    }
    this._lastTime = GLib.get_monotonic_time() / 1e6;
    const interval = (this._refreshInterval && this._refreshInterval > 0) ? this._refreshInterval : REFRESH_INTERVAL;
    this._timeout = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT, Math.round(interval * 1000), () => {
        const now = GLib.get_monotonic_time() / 1e6;
        const elapsed = now - this._lastTime;
        this._lastTime = now;
        const speed = this.getCurrentNetSpeed(elapsed > 0 ? elapsed : interval);
        const arrows = this._indicator.getArrows();
        const parts = toSpeedParts(speed, arrows.downArrow, arrows.upArrow);
        this._indicator.setText(parts);
        // If refreshInterval changed, restart timer with new interval
        this._restartTimeout();
        return GLib.SOURCE_REMOVE;
      }
    );
  }

  _restartTimeout() {
    if (this._timeout) {
      GLib.source_remove(this._timeout);
      this._timeout = null;
    }
    this._startTimeout();
  }

  disable() {
    // No external stylesheet to unload.
    if (this._indicator != null) {
      this._indicator.destroy();
      this._indicator = null;
    }
    this._textDecoder = null;
    this._lastSum = null;
    this._lastTime = null;
    if (this._timeout != null) {
      GLib.source_remove(this._timeout);
      this._timeout = null;
    }
  }

  getCurrentNetSpeed(refreshInterval) {
    const speed = {"down": 0, "up": 0};

    const inputFile = Gio.File.new_for_path("/proc/net/dev");
    const [, content] = inputFile.load_contents(null);
    const lines = this._textDecoder.decode(content).split("\n");

    let sumDown = 0;
    let sumUp = 0;

    for (const line of lines) {
      const fields = line.trim().split(/[:\s]+/);
      if (fields.length < 17) continue;
      const name = fields[0];
      if (isVirtualIface(name)) continue;

      const downBytes = Number.parseInt(fields[1]);
      const upBytes = Number.parseInt(fields[9]);
      if (isNaN(downBytes) || isNaN(upBytes)) continue;

      sumDown += downBytes;
      sumUp += upBytes;
    }

    if (this._lastSum["down"] === 0) {
      this._lastSum["down"] = sumDown;
    }
    if (this._lastSum["up"] === 0) {
      this._lastSum["up"] = sumUp;
    }

    // Use the passed refreshInterval, or fallback to instance or default
    let interval = (typeof refreshInterval === 'number' && refreshInterval > 0)
      ? refreshInterval
      : (this._refreshInterval && this._refreshInterval > 0 ? this._refreshInterval : REFRESH_INTERVAL);
    // Calculate bytes/sec
    speed["down"] = (sumDown - this._lastSum["down"]) / interval;
    speed["up"] = (sumUp - this._lastSum["up"]) / interval;

    this._lastSum["down"] = sumDown;
    this._lastSum["up"] = sumUp;

    return speed;
  }
};


// Named export for testing purposes (keeps main GNOME export intact)
export { toSpeedParts };