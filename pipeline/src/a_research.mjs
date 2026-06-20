// Stage A — fan out one web-search research agent per domain, then curate
// (dedup + rank + select) into a tight brief.
import { loadConfig, resolveDate } from "./lib/config.mjs";
import { makeBrain, engineConcurrency } from "./lib/brain.mjs";
import { logger } from "./lib/log.mjs";
import { slugify, mapLimit } from "./lib/util.mjs";
import { researchSystem, researchPrompt, curateSystem, curatePrompt } from "./prompts.mjs";

const log = logger("research");

export async function research({ cfg, date, client }) {
  const ai = client || makeBrain(cfg);
  const r = cfg.research;

  const domainRuns = await mapLimit(r.domains, engineConcurrency(cfg), async (d) => {
      try {
        const { data, citations } = await ai.json({
          system: researchSystem(),
          prompt: researchPrompt({ date, domain: d.key, lookbackHours: r.lookbackHours, wantNiche: r.wantNiche }),
          model: r.model,
          maxSearches: r.maxWebSearchesPerAgent,
          maxTokens: 8000,
        });
        const items = data?.notable === false ? [] : data?.items || [];
        // attach any web_search URLs the agent actually used, as a fallback source pool
        for (const it of items) it._agentCitations = citations;
        log[items.length ? "ok" : "info"](`${d.key}: ${items.length} item(s)`);
        return { domain: d.key, items };
      } catch (e) {
        log.warn(`${d.key} agent failed: ${e.message}`);
        return { domain: d.key, items: [], error: e.message };
      }
  });

  const findings = domainRuns.flatMap((x) => x.items);
  if (findings.length === 0) {
    log.warn("no findings from any domain");
    return { date, items: [], byDomain: domainRuns };
  }

  // Curate: dedup, rank, select. Fall back to raw findings if curation fails.
  let items = findings;
  try {
    const { data } = await ai.json({
      system: curateSystem(),
      prompt: curatePrompt({ date, min: r.targetItems.min, max: r.targetItems.max, findings }),
      model: r.model,
      maxTokens: 8000,
    });
    if (Array.isArray(data?.items) && data.items.length) items = data.items;
  } catch (e) {
    log.warn(`curation fell back to raw findings: ${e.message}`);
  }

  // Ensure every item has a stable id.
  items = items.map((it, i) => ({ ...it, id: it.id || `${it.domain || "item"}-${slugify(it.title || String(i))}` }));
  log.ok(`curated ${items.length} item(s)`, { domains: [...new Set(items.map((i) => i.domain))] });
  return { date, items, byDomain: domainRuns };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  const date = resolveDate(cfg.runtime.date, cfg.schedule.localTimezone);
  research({ cfg, date })
    .then((r) => console.log(JSON.stringify(r.items, null, 2)))
    .catch((e) => {
      log.error(e.stack || e.message);
      process.exit(1);
    });
}
