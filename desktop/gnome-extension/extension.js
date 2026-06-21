// Veille IA — GNOME top-bar control panel (GNOME 45–48, ESM).
//
// One 📰 button. Click it to:
//   • Generate a new veille on demand (with a live progress bar)
//   • Listen to the latest podcast
//   • Open the carousel (PDF) and the LinkedIn post
//   • Browse history
// Reads ~/gdrive/veille/{feed.json,_progress.json}; spawns the local pipeline.

import GObject from "gi://GObject";
import St from "gi://St";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

const HOME = GLib.get_home_dir();
const VEILLE_DIR = GLib.build_filenamev([HOME, "gdrive", "veille"]);
const REPO_DIR = GLib.build_filenamev([HOME, "gdrive", "Work", "veille"]);
const RUN_SCRIPT = GLib.build_filenamev([REPO_DIR, "desktop", "run-veille.sh"]);
const HEARD_FILE = GLib.build_filenamev([GLib.get_user_state_dir(), "veille-news", "heard.json"]);
const BAR_W = 280;

const readJson = (path) => {
  try {
    const [ok, bytes] = GLib.file_get_contents(path);
    return ok ? JSON.parse(new TextDecoder().decode(bytes)) : null;
  } catch (_e) {
    return null;
  }
};
const writeJson = (path, obj) => {
  try {
    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
    GLib.file_set_contents(path, JSON.stringify(obj));
  } catch (_e) {}
};
const exists = (p) => GLib.file_test(p, GLib.FileTest.EXISTS);
const openPath = (p) => {
  if (!exists(p)) return Main.notify("Veille IA", `Introuvable : ${p}`);
  try { Gio.AppInfo.launch_default_for_uri(`file://${p}`, null); } catch (_e) {}
};

const Indicator = GObject.registerClass(
  class VeilleIndicator extends PanelMenu.Button {
    _init() {
      super._init(0.0, "Veille IA", false);
      const box = new St.BoxLayout({ style_class: "panel-status-menu-box" });
      this._icon = new St.Label({ text: "📰", y_align: Clutter.ActorAlign.CENTER, style_class: "veille-icon" });
      this._badge = new St.Label({ text: "", y_align: Clutter.ActorAlign.CENTER, style_class: "veille-badge" });
      box.add_child(this._icon);
      box.add_child(this._badge);
      this.add_child(box);

      this._heard = new Set(readJson(HEARD_FILE)?.heard || []);
      this._buildMenu();
      this._watch();
      this.refresh();
    }

    _saveHeard() { writeJson(HEARD_FILE, { heard: [...this._heard] }); }

    _buildMenu() {
      // --- progress (hidden unless a run is active) ---
      this._progItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
      const pbox = new St.BoxLayout({ vertical: true, x_expand: true, style_class: "veille-prog" });
      this._progLabel = new St.Label({ text: "" });
      const track = new St.Bin({ style_class: "veille-bar-track" });
      track.set_width(BAR_W);
      this._barFill = new St.Widget({ style_class: "veille-bar-fill" });
      track.set_child(this._barFill);
      pbox.add_child(this._progLabel);
      pbox.add_child(track);
      this._progItem.add_child(pbox);
      this._progItem.visible = false;
      this.menu.addMenuItem(this._progItem);

      // --- actions ---
      this._generate = new PopupMenu.PopupMenuItem("⚡  Générer une nouvelle veille");
      this._generate.connect("activate", () => this._startRun());
      this.menu.addMenuItem(this._generate);

      this._listen = new PopupMenu.PopupMenuItem("▶  Écouter le dernier podcast");
      this._listen.connect("activate", () => this._openLatest("podcast.mp3"));
      this.menu.addMenuItem(this._listen);

      const pdf = new PopupMenu.PopupMenuItem("📄  Carrousel (PDF)");
      pdf.connect("activate", () => this._openLatest("carousel/carousel.pdf"));
      this.menu.addMenuItem(pdf);

      const post = new PopupMenu.PopupMenuItem("📝  Post LinkedIn");
      post.connect("activate", () => this._openLatest("linkedin_post.md"));
      this.menu.addMenuItem(post);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      // --- history submenu ---
      this._history = new PopupMenu.PopupSubMenuMenuItem("🕘  Historique");
      this.menu.addMenuItem(this._history);

      const markAll = new PopupMenu.PopupMenuItem("Marquer tout comme écouté");
      markAll.connect("activate", () => {
        for (const e of readJson(this._feedPath())?.episodes || []) this._heard.add(e.date);
        this._saveHeard();
        this.refresh();
      });
      this.menu.addMenuItem(markAll);

      const folder = new PopupMenu.PopupMenuItem("Ouvrir le dossier veille");
      folder.connect("activate", () => openPath(VEILLE_DIR));
      this.menu.addMenuItem(folder);
    }

    _feedPath() { return GLib.build_filenamev([VEILLE_DIR, "feed.json"]); }
    _progPath() { return GLib.build_filenamev([VEILLE_DIR, "_progress.json"]); }

    _latestDate() {
      const feed = readJson(this._feedPath());
      return feed?.episodes?.[0]?.date || null;
    }
    _openLatest(rel) {
      const d = this._latestDate();
      if (!d) return Main.notify("Veille IA", "Aucun épisode pour l'instant.");
      const path = GLib.build_filenamev([VEILLE_DIR, d, ...rel.split("/")]);
      if (rel === "podcast.mp3" && d) { this._heard.add(d); this._saveHeard(); this.refresh(); }
      openPath(path);
    }

    _startRun() {
      const prog = readJson(this._progPath());
      if (prog?.running) return Main.notify("Veille IA", "Une génération est déjà en cours…");
      try {
        const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
        launcher.spawnv(["bash", RUN_SCRIPT]);
      } catch (e) {
        return Main.notify("Veille IA", `Lancement impossible : ${e.message}`);
      }
      Main.notify("Veille IA", "Génération de la veille lancée…");
      this._setProgress({ running: true, pct: 0, message: "Démarrage…" });
      this._pollProgress();
    }

    _pollProgress() {
      if (this._pollTimer) GLib.source_remove(this._pollTimer);
      this._pollTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
        const prog = readJson(this._progPath());
        if (!prog) return GLib.SOURCE_CONTINUE;
        this._setProgress(prog);
        if (prog.done || prog.running === false) {
          this._pollTimer = 0;
          this._setProgress(null);
          Main.notify("Veille IA", prog.ok === false ? "Veille terminée (avec des erreurs)." : "✅ Nouvelle veille prête !");
          this.refresh();
          return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
      });
    }

    _setProgress(prog) {
      if (!prog || prog.running === false) {
        this._progItem.visible = false;
        this._generate.setSensitive(true);
        this._icon.text = "📰";
        return;
      }
      const pct = Math.max(0, Math.min(100, Math.round(prog.pct || 0)));
      this._progItem.visible = true;
      this._generate.setSensitive(false);
      this._progLabel.text = `⏳ ${prog.message || "…"} — ${pct}%`;
      this._barFill.set_width(Math.round((pct / 100) * BAR_W));
      this._icon.text = `📰 ${pct}%`;
    }

    _watch() {
      try {
        this._monitor = Gio.File.new_for_path(VEILLE_DIR).monitor_directory(Gio.FileMonitorFlags.NONE, null);
        this._monitor.connect("changed", () => this.refresh());
      } catch (_e) {}
      // If a run is already active when the shell starts, resume polling.
      if (readJson(this._progPath())?.running) this._pollProgress();
    }

    refresh() {
      const feed = readJson(this._feedPath());
      const episodes = (feed?.episodes || []).slice(0, 20);
      const unheard = episodes.filter((e) => !this._heard.has(e.date));
      if (!this._icon.text.includes("%")) this._badge.text = unheard.length ? String(unheard.length) : "";

      const latest = episodes[0];
      this._listen.setSensitive(!!latest?.hasPodcast);
      this._listen.label.text = latest
        ? `▶  Dernier podcast — ${latest.date}${latest.durationSec ? ` (${Math.round(latest.durationSec / 60)} min)` : ""}`
        : "▶  Aucun podcast";

      this._history.menu.removeAll();
      if (!episodes.length) {
        const empty = new PopupMenu.PopupMenuItem("Aucun épisode");
        empty.setSensitive(false);
        this._history.menu.addMenuItem(empty);
      }
      for (const ep of episodes) {
        const isNew = !this._heard.has(ep.date);
        const it = new PopupMenu.PopupMenuItem(`${isNew ? "● " : "   "}${ep.date} — ${ep.headline || "Veille"}`);
        it.connect("activate", () => {
          this._heard.add(ep.date);
          this._saveHeard();
          openPath(GLib.build_filenamev([VEILLE_DIR, ep.date, ep.hasPodcast ? "podcast.mp3" : ""]));
          this.refresh();
        });
        this._history.menu.addMenuItem(it);
      }
    }

    destroy() {
      if (this._pollTimer) GLib.source_remove(this._pollTimer);
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
