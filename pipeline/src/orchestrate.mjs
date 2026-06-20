// Orchestrator — runs the full daily pipeline for one date (default: today).
//
// Multi-day catch-up is handled by design WITHOUT re-generating history: the
// cloud cron produces one bundle per day into Drive, so a PC that was off for
// days simply syncs every missed bundle on power-on, and the GNOME extension
// badges all unheard episodes. Use --date YYYY-MM-DD to backfill manually.
import { writeFileSync } from "node:fs";
import { loadConfig, resolveDate } from "./lib/config.mjs";
import { bundlePaths } from "./lib/paths.mjs";
import { makeBrain } from "./lib/brain.mjs";
import { logger } from "./lib/log.mjs";
import { writeText } from "./lib/util.mjs";
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
  const errors = [];
  const guard = async (name, fn, fallback) => {
    try {
      return await log.time(name, fn);
    } catch (e) {
      log.error(`${name} failed: ${e.message}`);
      errors.push({ stage: name, error: e.message });
      return fallback;
    }
  };

  log.info(`=== Veille run for ${date} ===`, { dryRun: cfg.runtime.dryRun });

  // A — research
  const { items } = (await guard("A: research", () => research({ cfg, date, client }), { items: [] }));
  writeText(p.curated, JSON.stringify(items, null, 2));
  if (!items.length) {
    log.warn("no items found; publishing an empty notice");
    writeText(p.technicalDoc, `# Veille IA — ${date}\n\nAucune actualité notable détectée sur la fenêtre.\n`);
    writeText(p.sources, `# Sources — ${date}\n\n_Aucune._\n`);
    writeText(p.verification, `# Vérification — ${date}\n\n_Rien à vérifier._\n`);
    await publish({ cfg, date, items: [], errors });
    return finish(errors);
  }

  // B — technical doc (draft sections + claims)
  const { sections } = await guard("B: techdoc", () => techdoc({ cfg, date, items, client }), { sections: [] });

  // C — verification
  const ver = await guard("C: verify", () => verify({ cfg, sections, client }), { verdicts: {}, results: [], stats: { total: 0, supported: 0, unsupported: 0, unclear: 0 } });
  writeText(p.technicalDoc, renderTechDoc({ date, sections, verdicts: ver.verdicts }));
  writeText(p.verification, renderVerificationReport({ date, results: ver.results, stats: ver.stats }));

  // D — sources
  writeText(p.sources, renderSources({ date, items, verdicts: ver.verdicts }));

  const briefMd = renderTechDoc({ date, sections, verdicts: ver.verdicts });

  // E + F run independently off the verified brief.
  const pod = await guard("E: podcast", () => podcast({ cfg, date, brief: briefMd, scriptPath: p.script, outPath: p.podcast, client }), { durationSec: null });
  await guard("F: linkedin", () => linkedin({ cfg, date, brief: briefMd, postPath: p.linkedin, carouselDir: p.carousel, client }), null);

  // G — publish + deliver
  await guard("G: publish", () => publish({ cfg, date, items, durationSec: pod?.durationSec, errors }), null);

  return finish(errors);
}

function finish(errors) {
  if (errors.length) {
    log.warn(`done with ${errors.length} stage error(s)`, errors.map((e) => e.stage));
    process.exitCode = 2; // non-fatal: a partial bundle was still published
  } else {
    log.ok("done — full bundle published");
  }
}

main().catch((e) => {
  log.error(e.stack || e.message);
  process.exit(1);
});
