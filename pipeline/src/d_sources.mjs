// Stage D — compile the sources document from the curated items' primary
// sources, deduped, grouped by domain, annotated with verification status.
export function renderSources({ date, items, verdicts = {} }) {
  // Map url -> best verification verdict seen for any claim citing it.
  const urlVerdict = {};
  for (const r of Object.values(verdicts)) {
    const cur = urlVerdict[r.source_url];
    const rank = { supported: 2, unclear: 1, unsupported: 0 };
    if (!cur || rank[r.verdict] > rank[cur]) urlVerdict[r.source_url] = r.verdict;
  }
  const badge = { supported: "✅", unsupported: "❌", unclear: "❔" };

  const byDomain = {};
  const seen = new Set();
  for (const it of items) {
    for (const s of it.primary_sources || []) {
      if (!s.url || seen.has(s.url)) continue;
      seen.add(s.url);
      (byDomain[it.domain] ||= []).push({ ...s, supports: it.title, verdict: urlVerdict[s.url] });
    }
  }

  const lines = [
    `# Sources — ${date}`,
    "",
    `_Accès le ${date}. ${seen.size} source(s) primaire(s)._`,
    "",
  ];
  for (const [domain, srcs] of Object.entries(byDomain)) {
    lines.push(`## ${domain}`, "");
    for (const s of srcs) {
      const mark = s.verdict ? ` ${badge[s.verdict] || ""}` : "";
      const pub = [s.publisher, s.date].filter(Boolean).join(", ");
      lines.push(`- [${s.title || s.url}](${s.url})${pub ? ` — ${pub}` : ""}${mark}  \n  ↳ _${s.supports}_`);
    }
    lines.push("");
  }
  lines.push("---", "", "Légende : ✅ confirmée · ❔ indéterminée · ❌ non confirmée.");
  return lines.join("\n");
}
