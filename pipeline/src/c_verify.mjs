// Stage C — anti-hallucination pass. For every claim, fetch its cited source,
// ask a strict checker whether the source supports it, and report the verdict.
// High-stakes (numeric) claims get independent re-checks.
import { makeClient } from "./lib/anthropic.mjs";
import { fetchPageText } from "./lib/fetchpage.mjs";
import { logger } from "./lib/log.mjs";
import { verifySystem, verifyPrompt } from "./prompts.mjs";

const log = logger("verify");
const isHighStakes = (t) => /\d/.test(t) && /(%|x\b|times|sota|state[- ]of[- ]the[- ]art|fps|tokens|params?|billion|million|benchmark)/i.test(t);

export async function verify({ cfg, sections, client }) {
  const ai = client || makeClient(cfg.secrets.anthropic);
  const claims = sections.flatMap((s) => s.claims.map((c) => ({ ...c, sectionId: s.id })));
  if (!claims.length) {
    log.warn("no claims to verify");
    return { verdicts: {}, results: [], stats: { total: 0, supported: 0, unsupported: 0, unclear: 0 } };
  }

  // Cache page fetches across claims that share a URL.
  const pageCache = new Map();
  const getPage = async (url) => {
    if (!url) return { ok: false, text: "" };
    if (!pageCache.has(url)) pageCache.set(url, await fetchPageText(url));
    return pageCache.get(url);
  };

  const checkOnce = async (claim) => {
    const page = await getPage(claim.source_url);
    const { data } = await ai.json({
      system: verifySystem(),
      prompt: verifyPrompt({ claim: claim.text, sourceUrl: claim.source_url, sourceText: page.text }),
      model: cfg.verify.model,
      maxTokens: 800,
    });
    return { verdict: data.verdict || "unclear", quote: data.quote || "", note: data.note || "", fetched: page.ok };
  };

  const results = await Promise.all(
    claims.map(async (claim) => {
      try {
        let r = await checkOnce(claim);
        // Independent re-checks for high-stakes claims; downgrade on disagreement.
        if (cfg.verify.independentVotersForHighStakes > 0 && isHighStakes(claim.text) && r.verdict === "supported") {
          for (let v = 0; v < cfg.verify.independentVotersForHighStakes; v++) {
            const again = await checkOnce(claim);
            if (again.verdict !== "supported") {
              r = { ...again, note: `downgraded on independent recheck: ${again.note}` };
              break;
            }
          }
        }
        return { ...claim, ...r };
      } catch (e) {
        return { ...claim, verdict: "unclear", quote: "", note: `checker error: ${e.message}`, fetched: false };
      }
    })
  );

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
