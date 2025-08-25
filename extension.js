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

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import { PopupBaseMenuItem } from "resource:///org/gnome/shell/ui/popupMenu.js";
import {Extension} from "resource:///org/gnome/shell/extensions/extension.js";

// Use decimal refresh interval (e.g., 0.5 seconds)
let refreshInterval = 1.0; // Default in seconds, can be changed by user.

// Use bytes per second units
const speedUnits = [
  "B/s", "KB/s", "MB/s", "GB/s", "TB/s", "PB/s", "EB/s", "ZB/s", "YB/s"
];

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
  while (amount >= 1000 && unitIndex < speedUnits.length - 1) {
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

  return `${amount.toFixed(digits)} ${speedUnits[unitIndex]}`;
};


const toSpeedString = (speed) => {
  return `↓ ${formatSpeedWithUnit(speed["down"])}   ↑ ${formatSpeedWithUnit(speed["up"])}`;
};

const Indicator = GObject.registerClass(
  class Indicator extends PanelMenu.Button {
    _init() {
      super._init(0.0, "Net Speed", false);

      this._label = new St.Label({
        "y_align": Clutter.ActorAlign.CENTER,
        "text": toSpeedString({"down": 0, "up": 0})
      });
      this.add_child(this._label);

      // Popup for refresh interval
      this._refreshItem = new St.BoxLayout({vertical: false, style_class: 'refresh-interval-box'});
      this._refreshLabel = new St.Label({text: 'Refresh Sec. (e.g 1.0): '});
      this._refreshEntry = new St.Entry({
        text: refreshInterval.toString(),
        style_class: 'refresh-interval-entry',
        can_focus: true,
        x_expand: true,
        track_hover: true,
        style: 'min-width: 60px; max-width: 100px; padding: 2px 6px; border-radius: 6px; background-color: rgba(255,255,255,0.07); color: #fff; border: 1px solid rgba(255,255,255,0.15); font-size: 12px;'
      });
      this._refreshItem.add_child(this._refreshLabel);
      this._refreshItem.add_child(this._refreshEntry);
      // Add the refresh interval box as a menu item
      let menuItem = new PopupBaseMenuItem({ activate: false, can_focus: false, reactive: false });
      menuItem.add_child(this._refreshItem);
      this.menu.addMenuItem(menuItem);

      const updateRefreshInterval = () => {
        let val = parseFloat(this._refreshEntry.get_text().replace(',', '.'));
        if (!isNaN(val) && val >= 0.1 && val < 60) {
          refreshInterval = val;
          if (this._onRefreshChanged)
            this._onRefreshChanged();
        } else {
          this._refreshEntry.set_text(refreshInterval.toString());
        }
      };

      this._refreshEntry.get_clutter_text().connect('activate', updateRefreshInterval);
      // Fallback: listen for 'notify::text' and update after short delay if value changed
      let lastValue = this._refreshEntry.get_text();
      this._refreshEntry.get_clutter_text().connect('notify::text', () => {
        let newValue = this._refreshEntry.get_text();
        if (newValue !== lastValue) {
          lastValue = newValue;
          // Debounce: update after 500ms of inactivity
          if (this._refreshTimeoutId)
        GLib.source_remove(this._refreshTimeoutId);
          this._refreshTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
        updateRefreshInterval();
        this._refreshTimeoutId = null;
        return GLib.SOURCE_REMOVE;
          });
        }
      });
    }

    setText(text) {
      return this._label.set_text(text);
    }

    setOnRefreshChanged(cb) {
      this._onRefreshChanged = cb;
    }
  });

export default class NetSpeed extends Extension {
  constructor(metadata) {
    super(metadata);

    this._metadata = metadata;
    this._uuid = metadata.uuid;
  }

  enable() {
    this._textDecoder = new TextDecoder();
    this._lastSum = {"down": 0, "up": 0};
    this._lastTime = GLib.get_monotonic_time() / 1e6; // seconds
    this._timeout = null;

    this._indicator = new Indicator();
    Main.panel.addToStatusArea(this._uuid, this._indicator, 0, "right");

    this._indicator.setOnRefreshChanged(() => {
      this._restartTimeout();
    });

    this._startTimeout();
  }

  _startTimeout() {
    if (this._timeout) {
      GLib.source_remove(this._timeout);
      this._timeout = null;
    }
    this._lastTime = GLib.get_monotonic_time() / 1e6;
    this._timeout = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT, Math.round(refreshInterval * 1000), () => {
        const now = GLib.get_monotonic_time() / 1e6;
        const elapsed = now - this._lastTime;
        this._lastTime = now;
        const speed = this.getCurrentNetSpeed(elapsed > 0 ? elapsed : refreshInterval);
        const text = toSpeedString(speed);
        this._indicator.setText(text);
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

    try {
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

      // Calculate bytes/sec
      speed["down"] = (sumDown - this._lastSum["down"]) / refreshInterval;
      speed["up"] = (sumUp - this._lastSum["up"]) / refreshInterval;

      this._lastSum["down"] = sumDown;
      this._lastSum["up"] = sumUp;
    } catch (e) {
      console.error(e);
    }

    return speed;
  }
};
