// Orchestrator — runs the full pipeline for one date (default: today) and
// streams progress into the synced folder so the GNOME button can show a bar.
//
// Triggered manually from the top-bar button (or `node orchestrate.mjs`).
// Use --date YYYY-MM-DD to backfill a specific day.
import { loadConfig, resolveDate } from "./lib/config.mjs";
import { bundlePaths } from "./lib/paths.mjs";
import { makeBrain } from "./lib/brain.mjs";
import { logger } from "./lib/log.mjs";
import { writeText } from "./lib/util.mjs";
import { makeProgress } from "./lib/progress.mjs";
import { research } from "./a_research.mjs";
import { techdoc, renderTechDoc } from "./b_techdoc.mjs";
import { verify, renderVerificationReport } from "./c_verify.mjs";
import { renderSources } from "./d_sources.mjs";
import { podcast } from "./e_podcast.mjs";
import { linkedin } from "./f_linkedin.mjs";
import { publish } from "./g_publish.mjs";

const log = logger("orchestrate");

async function main() {
  const cfg = loadConfig();
  const date = resolveDate(cfg.runtime.date, cfg.schedule.localTimezone);
  const client = makeBrain(cfg);
  const p = bundlePaths(cfg.runtime.outDir, date).ensure();
  const prog = makeProgress(cfg, date);
  const errors = [];

  const guard = async (key, name, fn, fallback) => {
    prog.begin(key);
    try {
      const r = await log.time(name, fn);
      prog.end(key);
      return r;
    } catch (e) {
      log.error(`${name} failed: ${e.message}`);
      errors.push({ stage: name, error: e.message });
      prog.end(key);
      return fallback;
    }
  };

  log.info(`=== Veille run for ${date} ===`, { dryRun: cfg.runtime.dryRun, engine: cfg.engine });
  prog.start();

  // A — research
  const { items } = await guard("research", "A: research", () => research({ cfg, date, client }), { items: [] });
  writeText(p.curated, JSON.stringify(items, null, 2));
  if (!items.length) {
    log.warn("no items found; publishing an empty notice");
    writeText(p.technicalDoc, `# Veille IA — ${date}\n\nAucune actualité notable détectée.\n`);
    writeText(p.sources, `# Sources — ${date}\n\n_Aucune._\n`);
    writeText(p.verification, `# Vérification — ${date}\n\n_Rien à vérifier._\n`);
    await publish({ cfg, date, items: [], errors });
    prog.finish(false);
    return finish(errors);
  }

  // B — technical doc
  const { sections } = await guard("techdoc", "B: techdoc", () => techdoc({ cfg, date, items, client }), { sections: [] });

  // C — verification
  const ver = await guard("verify", "C: verify", () => verify({ cfg, sections, client }), { verdicts: {}, results: [], stats: { total: 0, supported: 0, unsupported: 0, unclear: 0 } });
  writeText(p.technicalDoc, renderTechDoc({ date, sections, verdicts: ver.verdicts }));
  writeText(p.verification, renderVerificationReport({ date, results: ver.results, stats: ver.stats }));
  writeText(p.sources, renderSources({ date, items, verdicts: ver.verdicts }));

  const briefMd = renderTechDoc({ date, sections, verdicts: ver.verdicts });

  // E — podcast, F — linkedin
  const pod = await guard("podcast", "E: podcast", () => podcast({ cfg, date, brief: briefMd, scriptPath: p.script, outPath: p.podcast, client }), { durationSec: null });
  await guard("linkedin", "F: linkedin", () => linkedin({ cfg, date, brief: briefMd, postPath: p.linkedin, carouselDir: p.carousel, client }), null);

  // G — publish
  await guard("publish", "G: publish", () => publish({ cfg, date, items, durationSec: pod?.durationSec, errors }), null);

  prog.finish(errors.length === 0);
  return finish(errors);
}

function finish(errors) {
  if (errors.length) {
    log.warn(`done with ${errors.length} stage error(s)`, errors.map((e) => e.stage));
    process.exitCode = 2;
  } else {
    log.ok("done — full bundle published");
  }
}

main().catch((e) => {
  log.error(e.stack || e.message);
  process.exit(1);
});
