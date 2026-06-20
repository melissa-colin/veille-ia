// Generate (or regenerate) the podcast audio for an already-produced bundle,
// from its podcast_script.md — useful to add audio after the fact or to switch
// voices without re-running the whole pipeline. Patches manifest + feed and
// re-copies into the synced Drive mirror so the GNOME indicator picks it up.
//
// Usage: node pipeline/src/make_podcast.mjs [--date YYYY-MM-DD]
import { readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig, resolveDate } from "./lib/config.mjs";
import { bundlePaths } from "./lib/paths.mjs";
import { logger } from "./lib/log.mjs";
import { readJSONSafe, writeJSON, copyInto } from "./lib/util.mjs";
import { synthesize } from "./e_podcast.mjs";

const log = logger("make-podcast");

async function main() {
  const cfg = loadConfig();
  const date = resolveDate(cfg.runtime.date, cfg.schedule.localTimezone);
  const p = bundlePaths(cfg.runtime.outDir, date);

  if (!existsSync(p.script)) {
    throw new Error(`no script at ${p.script} — run the pipeline first (it writes podcast_script.md even without a voice)`);
  }
  // Strip the leading "# title" line; the rest is the spoken script.
  const raw = readFileSync(p.script, "utf8");
  const scriptText = raw.replace(/^#.*\n+/, "").trim();
  log.info(`script: ${scriptText.length} chars (~${Math.round(scriptText.split(/\s+/).length / 150)} min)`);

  const r = await synthesize({ cfg, scriptText, outPath: p.podcast });
  if (!r.ok) throw new Error(`TTS failed: ${r.reason || "unknown"}`);

  // Patch manifest.
  const manifest = readJSONSafe(p.manifest, {});
  manifest.files = { ...(manifest.files || {}), podcast: "podcast.mp3" };
  manifest.podcastDurationSec = r.durationSec;
  writeJSON(p.manifest, manifest);

  // Patch feed entry.
  const feed = readJSONSafe(p.feed, { version: 1, episodes: [] });
  const ep = feed.episodes.find((e) => e.date === date);
  if (ep) {
    ep.hasPodcast = true;
    ep.durationSec = r.durationSec;
    writeJSON(p.feed, feed);
  }

  // Re-deliver to the synced Drive mirror.
  const mirror = cfg.delivery.localMirror;
  if (mirror && (existsSync(mirror) || existsSync(dirname(mirror)))) {
    copyInto(`${cfg.runtime.outDir}/.`, mirror);
    log.ok(`audio added & mirror updated: ${mirror}`);
  }
  log.ok(`podcast.mp3 ready (${r.durationSec ? Math.round(r.durationSec / 60) + " min" : "?"})`, { date });
}

main().catch((e) => {
  log.error(e.stack || e.message);
  process.exit(1);
});
