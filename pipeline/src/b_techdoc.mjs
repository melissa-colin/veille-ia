// Stage B — turn each curated item into a deep technical section (with the
// atomic claims that Stage C will verify).
import { makeBrain, engineConcurrency } from "./lib/brain.mjs";
import { mapLimit } from "./lib/util.mjs";
import { logger } from "./lib/log.mjs";
import { techdocSystem, techdocPrompt } from "./prompts.mjs";

const log = logger("techdoc");

export async function techdoc({ cfg, date, items, client }) {
  const ai = client || makeBrain(cfg);
  const lang = cfg.techdoc.language;

  const sections = await mapLimit(items, engineConcurrency(cfg), async (item, i) => {
      try {
        const { data } = await ai.json({
          system: techdocSystem(lang),
          prompt: techdocPrompt({ date, item }),
          model: cfg.techdoc.model,
          maxTokens: 4000,
        });
        const claims = (data.claims || []).map((c, j) => ({ ...c, id: c.id || `${item.id}-c${j + 1}` }));
        return { id: item.id, title: data.title || item.title, domain: item.domain, markdown: data.markdown || "", claims, item };
      } catch (e) {
        log.warn(`section failed for ${item.id}: ${e.message}`);
        return { id: item.id, title: item.title, domain: item.domain, markdown: `## ${item.title}\n\n${item.summary || ""}`, claims: [], item };
      }
  });
  log.ok(`wrote ${sections.length} section(s)`);
  return { date, sections };
}

// Render the (draft or verified) markdown doc. `verdicts` maps claimId -> verdict.
export function renderTechDoc({ date, sections, verdicts = {} }) {
  const domains = [...new Set(sections.map((s) => s.domain))];
  const lines = [
    `# Veille IA — brief technique du ${date}`,
    "",
    `*${sections.length} sujet(s) · domaines : ${domains.join(", ")}*`,
    "",
    "> Chaque affirmation factuelle est vérifiée contre sa source primaire (voir `verification_report.md`). Les points non confirmés sont marqués ⚠.",
    "",
    "---",
    "",
  ];
  for (const s of sections) {
    let md = s.markdown.trim();
    // Always surface the development's date AND source so downstream (podcast/post) can cite them aloud.
    const d = s.item?.date;
    const src = (s.item?.primary_sources || [])[0];
    const meta = [d ? `Date : ${d}` : "", src ? `Source : ${src.publisher || src.title || src.url}` : ""].filter(Boolean).join(" · ");
    if (meta) lines.push(`**${meta}**`, "");
    // Annotate unverified/unsupported claims inline by appending a marker after the section.
    const flagged = s.claims.filter((c) => verdicts[c.id] && verdicts[c.id].verdict !== "supported");
    lines.push(md, "");
    if (flagged.length) {
      lines.push("> ⚠ **À confirmer :** " + flagged.map((c) => `_${c.text}_`).join(" · "), "");
    }
    lines.push("---", "");
  }
  return lines.join("\n");
}
