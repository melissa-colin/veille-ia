// Stage C — anti-hallucination pass. Fetch each cited source, then have a strict
// checker decide (per claim) whether the source supports it, quoting evidence.
// Claims are verified in BATCHES (one LLM call per group) to stay fast and light
// on quota; high-stakes numeric claims get one independent re-check.
import { makeBrain, engineConcurrency } from "./lib/brain.mjs";
import { mapLimit } from "./lib/util.mjs";
import { fetchPageText } from "./lib/fetchpage.mjs";
import { logger } from "./lib/log.mjs";
import { verifySystem, verifyBatchPrompt } from "./prompts.mjs";

const log = logger("verify");
const BATCH = 6;
const EXCERPT = 4000;
const isHighStakes = (t) => /\d/.test(t) && /(%|x\b|times|sota|state[- ]of[- ]the[- ]art|fps|tokens|params?|billion|million|benchmark)/i.test(t);

export async function verify({ cfg, sections, client }) {
  const ai = client || makeBrain(cfg);
  const claims = sections.flatMap((s) => s.claims.map((c) => ({ ...c, sectionId: s.id })));
  if (!claims.length) {
    log.warn("no claims to verify");
    return { verdicts: {}, results: [], stats: { total: 0, supported: 0, unsupported: 0, unclear: 0 } };
  }

  // Fetch each unique source once.
  const urls = [...new Set(claims.map((c) => c.source_url).filter(Boolean))];
  const pages = new Map();
  await mapLimit(urls, 6, async (u) => pages.set(u, await fetchPageText(u)));
  const excerptFor = (u) => (pages.get(u)?.text || "").slice(0, EXCERPT);
  const fetchedFor = (u) => !!pages.get(u)?.ok;

  const verdictMap = await runBatches(ai, cfg, claims, excerptFor);

  // Independent re-check for high-stakes claims currently marked supported.
  if ((cfg.verify.independentVotersForHighStakes || 0) > 0) {
    const recheck = claims.filter((c) => isHighStakes(c.text) && verdictMap[c.id]?.verdict === "supported");
    if (recheck.length) {
      const again = await runBatches(ai, cfg, recheck, excerptFor);
      for (const c of recheck) {
        if (again[c.id] && again[c.id].verdict !== "supported") {
          verdictMap[c.id] = { ...again[c.id], note: `downgraded on independent recheck: ${again[c.id].note || ""}` };
        }
      }
    }
  }

  const results = claims.map((c) => ({
    ...c,
    verdict: verdictMap[c.id]?.verdict || "unclear",
    quote: verdictMap[c.id]?.quote || "",
    note: verdictMap[c.id]?.note || (fetchedFor(c.source_url) ? "" : "source not fetched"),
    fetched: fetchedFor(c.source_url),
  }));
  const verdicts = Object.fromEntries(results.map((r) => [r.id, r]));
  const stats = {
    total: results.length,
    supported: results.filter((r) => r.verdict === "supported").length,
    unsupported: results.filter((r) => r.verdict === "unsupported").length,
    unclear: results.filter((r) => r.verdict === "unclear").length,
  };
  log.ok("verification complete", stats);
  return { verdicts, results, stats };
}

// Verify claims in chunks; returns { claimId: {verdict, quote, note} }.
async function runBatches(ai, cfg, claims, excerptFor) {
  const groups = [];
  for (let i = 0; i < claims.length; i += BATCH) groups.push(claims.slice(i, i + BATCH));

  const grouped = await mapLimit(groups, engineConcurrency(cfg), async (group) => {
    try {
      const { data } = await ai.json({
        system: verifySystem(),
        prompt: verifyBatchPrompt({
          claims: group.map((c) => ({ id: c.id, text: c.text, source_url: c.source_url, source_excerpt: excerptFor(c.source_url) })),
        }),
        model: cfg.verify.model,
        maxTokens: 3000,
      });
      return data.verdicts || [];
    } catch (e) {
      log.warn(`verify batch failed: ${e.message}`);
      return group.map((c) => ({ id: c.id, verdict: "unclear", quote: "", note: `checker error: ${e.message}` }));
    }
  });

  const map = {};
  for (const v of grouped.flat()) if (v && v.id) map[v.id] = v;
  return map;
}

export function renderVerificationReport({ date, results, stats }) {
  const lines = [
    `# Rapport de vérification — ${date}`,
    "",
    `**${stats.supported}/${stats.total}** affirmations confirmées · ${stats.unsupported} non confirmées · ${stats.unclear} indéterminées.`,
    "",
    "| Verdict | Affirmation | Source | Citation / note |",
    "|---|---|---|---|",
  ];
  const icon = { supported: "✅", unsupported: "❌", unclear: "❔" };
  for (const r of results) {
    const cell = (s) => String(s || "").replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 240);
    const evidence = r.quote ? `“${cell(r.quote)}”` : cell(r.note);
    lines.push(`| ${icon[r.verdict] || "❔"} | ${cell(r.text)} | ${r.source_url ? `[lien](${r.source_url})` : "—"} | ${evidence} |`);
  }
  return lines.join("\n");
}
