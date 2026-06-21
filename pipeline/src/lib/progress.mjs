// Writes a live _progress.json into the synced folder so the GNOME button can
// render a progress bar while a veille is being generated. Cheap, atomic-ish.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeJSON } from "./util.mjs";

// Weighted stages → a 0..100 percentage as each completes.
const STAGES = [
  { key: "research", label: "Recherche des actualités", weight: 40 },
  { key: "techdoc", label: "Rédaction du brief technique", weight: 15 },
  { key: "verify", label: "Vérification des sources", weight: 15 },
  { key: "podcast", label: "Script + voix du podcast", weight: 18 },
  { key: "linkedin", label: "Post LinkedIn + carrousel", weight: 10 },
  { key: "publish", label: "Publication", weight: 2 },
];

export function makeProgress(cfg, date) {
  const mirror = cfg.delivery.localMirror;
  const base = mirror && (existsSync(mirror) || existsSync(dirname(mirror))) ? mirror : cfg.runtime.outDir;
  if (!existsSync(base)) mkdirSync(base, { recursive: true });
  const path = join(base, "_progress.json");

  let done = 0; // cumulative weight of completed stages
  const startedAt = `${date}T00:00:00Z`;
  const write = (extra) =>
    writeJSON(path, { date, running: true, startedAt, stages: STAGES.map((s) => s.label), ...extra });

  const idxOf = (key) => STAGES.findIndex((s) => s.key === key);

  return {
    path,
    start() {
      done = 0;
      write({ pct: 0, stageIndex: 0, message: "Démarrage…" });
    },
    // Mark a stage as started (pct = work done so far).
    begin(key) {
      const i = idxOf(key);
      write({ pct: Math.round(done), stageIndex: i, message: STAGES[i]?.label || key });
    },
    // Mark a stage finished (adds its weight).
    end(key) {
      const s = STAGES[idxOf(key)];
      if (s) done += s.weight;
      write({ pct: Math.round(done), stageIndex: idxOf(key) + 1, message: s ? `${s.label} ✓` : key });
    },
    finish(ok = true) {
      writeJSON(path, { date, running: false, done: true, ok, pct: 100, finishedAt: `${date}T00:00:00Z` });
    },
    fail(err) {
      writeJSON(path, { date, running: false, done: true, ok: false, pct: Math.round(done), error: String(err).slice(0, 300) });
    },
  };
}
