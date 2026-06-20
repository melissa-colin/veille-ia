// Veille IA — GNOME top-bar news indicator (GNOME 45–48, ESM).
//
// Reads ~/gdrive/veille/feed.json (written by the cloud pipeline and pulled by
// Drive sync). Shows a 📰 badge with the count of UNHEARD episodes; clicking an
// episode plays its podcast and opens its brief. "Heard" state is tracked
// locally (Drive overwrites feed.json, so we never rely on its `heard` flag).

import GObject from "gi://GObject";
import St from "gi://St";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

// Where the synced Drive folder appears locally. Edit if your mirror differs.
const VEILLE_DIR = GLib.build_filenamev([GLib.get_home_dir(), "gdrive", "veille"]);
const HEARD_FILE = GLib.build_filenamev([GLib.get_user_state_dir(), "veille-news", "heard.json"]);
const POLL_SECONDS = 120;

function readJson(path) {
  try {
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok) return null;
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (_e) {
    return null;
  }
}

function writeJson(path, obj) {
  try {
    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
    GLib.file_set_contents(path, JSON.stringify(obj));
  } catch (_e) {}
}

function openUri(path) {
  try {
    Gio.AppInfo.launch_default_for_uri(`file://${path}`, null);
  } catch (e) {
    Main.notify("Veille IA", `Could not open: ${path}`);
  }
}

const Indicator = GObject.registerClass(
  class VeilleIndicator extends PanelMenu.Button {
    _init() {
      super._init(0.0, "Veille IA", false);

      const box = new St.BoxLayout({ style_class: "panel-status-menu-box veille-box" });
      this._icon = new St.Label({ text: "📰", y_align: Clutter.ActorAlign.CENTER, style_class: "veille-icon" });
      this._badge = new St.Label({ text: "", style_class: "veille-badge" });
      box.add_child(this._icon);
      box.add_child(this._badge);
      this.add_child(box);

      this._heard = new Set((readJson(HEARD_FILE)?.heard) || []);
      this._buildMenu();
      this._startWatching();
      this.refresh();
    }

    _saveHeard() {
      writeJson(HEARD_FILE, { heard: [...this._heard] });
    }

    _buildMenu() {
      this._listSection = new PopupMenu.PopupMenuSection();
      this.menu.addMenuItem(this._listSection);
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      const markAll = new PopupMenu.PopupMenuItem("Mark all as heard");
      markAll.connect("activate", () => {
        const feed = readJson(GLib.build_filenamev([VEILLE_DIR, "feed.json"]));
        for (const ep of feed?.episodes || []) this._heard.add(ep.date);
        this._saveHeard();
        this.refresh();
      });
      this.menu.addMenuItem(markAll);

      const openFolder = new PopupMenu.PopupMenuItem("Open veille folder");
      openFolder.connect("activate", () => openUri(VEILLE_DIR));
      this.menu.addMenuItem(openFolder);
    }

    _startWatching() {
      // Monitor the directory (Drive sync writes via temp files + rename).
      try {
        const dir = Gio.File.new_for_path(VEILLE_DIR);
        this._monitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
        this._monitor.connect("changed", () => this.refresh());
      } catch (_e) {}
      // Backup poll in case the monitor misses a sync event.
      this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_SECONDS, () => {
        this.refresh();
        return GLib.SOURCE_CONTINUE;
      });
    }

    refresh() {
      const feed = readJson(GLib.build_filenamev([VEILLE_DIR, "feed.json"]));
      const episodes = (feed?.episodes || []).slice(0, 14);
      this._listSection.removeAll();

      const unheard = episodes.filter((e) => !this._heard.has(e.date));
      this._badge.text = unheard.length ? String(unheard.length) : "";
      this._icon.style_class = unheard.length ? "veille-icon veille-active" : "veille-icon";

      if (!episodes.length) {
        const empty = new PopupMenu.PopupMenuItem("No episodes yet");
        empty.setSensitive(false);
        this._listSection.addMenuItem(empty);
        return;
      }

      for (const ep of episodes) {
        const isNew = !this._heard.has(ep.date);
        const dur = ep.durationSec ? ` · ${Math.round(ep.durationSec / 60)} min` : "";
        const item = new PopupMenu.PopupMenuItem(`${isNew ? "● " : "  "}${ep.date} — ${ep.headline || "Veille IA"}${dur}`);
        if (isNew) item.label.style_class = "veille-new";
        item.connect("activate", () => this._openEpisode(ep));
        this._listSection.addMenuItem(item);
      }
    }

    _openEpisode(ep) {
      const base = GLib.build_filenamev([VEILLE_DIR, ep.date]);
      const podcast = GLib.build_filenamev([base, "podcast.mp3"]);
      if (GLib.file_test(podcast, GLib.FileTest.EXISTS)) openUri(podcast);
      else openUri(base); // no audio yet → open the day's folder/brief
      this._heard.add(ep.date);
      this._saveHeard();
      this.refresh();
    }

    destroy() {
      if (this._timer) GLib.source_remove(this._timer);
      if (this._monitor) this._monitor.cancel();
      super.destroy();
    }
  }
);

export default class VeilleExtension extends Extension {
  enable() {
    this._indicator = new Indicator();
    Main.panel.addToStatusArea(this.uuid, this._indicator);
  }
  disable() {
    this._indicator?.destroy();
    this._indicator = null;
  }
}
