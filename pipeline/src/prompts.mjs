// All LLM prompts for the pipeline, as builder functions. Kept together so the
// "editorial voice" of the system is reviewable in one place.

const TODAY = (date) => `Today is ${date}.`;

// ---- Stage A: per-domain research ----------------------------------------
export function researchSystem() {
  return [
    "You are a senior AI research analyst doing daily technical intelligence.",
    "You use web search to find GENUINELY RECENT developments and report them precisely.",
    "Hard rules:",
    "- Only report things you can tie to a real, citable primary source (paper, official blog, repo, reputable outlet).",
    "- Prefer primary sources (arXiv, lab blogs, GitHub) over secondhand coverage.",
    "- Capture BOTH headline items AND under-the-radar / niche items a specialist would value.",
    "- Never invent benchmarks, dates, names, or numbers. If unsure, omit it.",
    "- Each atomic factual claim must carry the source URL that supports it.",
  ].join("\n");
}

export function researchPrompt({ date, domain, lookbackHours, wantNiche, covered = [], targetItems }) {
  const focus = {
    general:
      "Worldwide state-of-the-art AI: major model releases, new training/inference techniques, AND policy/politics/regulation/geopolitics of AI.",
    architecture:
      "Model ARCHITECTURE, with emphasis on POST-TRANSFORMER directions: state-space models (Mamba/S4), linear/sub-quadratic attention, diffusion LLMs, RWKV, mixture-of-experts advances, long-context mechanisms, new normalization/optimizer/positional ideas.",
    discourse:
      "Notable CLAIMS / STATEMENTS / predictions by influential figures (researchers, lab leads, policymakers). Capture WHO said WHAT, WHERE, and the exact gist. No paraphrase that distorts.",
    vision3d:
      "Computer vision, 3D, and motion: generative video, 3D reconstruction/Gaussian splatting, pose/motion, NeRF successors, vision-language-action. CONDITIONAL domain.",
    wildcard:
      "One deeper technical AI area with real fresh news this window (e.g. RL, agentic systems, inference kernels/hardware, theory, interpretability). CONDITIONAL domain.",
  }[domain];

  const isCore = domain === "general" || domain === "architecture" || domain === "discourse";
  const fallback = isCore
    ? `If you cannot find enough genuinely fresh (<${lookbackHours}h) well-sourced items, DO fill the rest with slightly OLDER but still highly valuable, evergreen-ish items that have NOT already been covered (see the avoid-list). Never return an empty list for this domain — always surface real, sourced, useful items.`
    : `This is a CONDITIONAL domain. If nothing genuinely noteworthy & well-sourced exists in the last ${lookbackHours}h, you MAY pick one excellent slightly-older uncovered item; if truly nothing worthwhile, return {"notable": false, "items": []}. Never pad with filler.`;

  const target = targetItems ? `Aim for about ${targetItems} substantial items.` : "";
  const avoid = covered.length
    ? `\nALREADY COVERED — do NOT repeat these (find different angles/topics):\n- ${covered.slice(0, 60).join("\n- ")}`
    : "";

  return [
    TODAY(date),
    `Research focus: ${focus}`,
    `Time window: prefer developments from the last ${lookbackHours} hours.`,
    target,
    fallback,
    wantNiche ? "Include at least one niche / specialist item if a credible one exists." : "",
    avoid,
    "",
    "Search the web, then return JSON of this exact shape:",
    `{"notable": true, "items": [{
  "title": string,
  "domain": "${domain}",
  "one_liner": string,
  "summary": string,                // 3-6 sentences, technical, neutral
  "why_it_matters": string,         // 1-3 sentences
  "technical_details": [string],    // concrete specifics: sizes, methods, benchmarks (only if sourced)
  "primary_sources": [{"title": string, "url": string, "publisher": string, "date": string}],
  "claims": [{"text": string, "source_url": string}],  // atomic, each independently checkable
  "date": string,                   // ISO date of the development
  "importance": 1,                  // 1=niche .. 5=major
  "is_niche": false,
  "confidence": "high"              // high|medium|low
}]}`,
  ].filter(Boolean).join("\n");
}

// ---- Stage A: curation / dedup / ranking ---------------------------------
export function curateSystem() {
  return "You are the editor-in-chief of a daily AI intelligence brief. You deduplicate, rank, and select a tight, high-signal set of items, balancing major news with valuable niche items. You never fabricate; you only reorganize and select from the provided findings.";
}
export function curatePrompt({ date, min, max, findings }) {
  return [
    TODAY(date),
    `From the following raw findings (JSON), produce a curated brief of between ${min} and ${max} items.`,
    "Rules: merge duplicates/near-duplicates (keep the richest version and union their sources); drop anything unsourced or stale; ensure a mix of headline AND niche; order by importance then specificity; keep every primary_source and claim from the merged items.",
    "Return JSON: {\"items\": [ <same item shape as input, plus a stable \"id\" slug> ]}",
    "",
    "RAW FINDINGS:",
    JSON.stringify(findings),
  ].join("\n");
}

// ---- Stage B: technical deep-dive doc ------------------------------------
export function techdocSystem(language) {
  return [
    "You are a technical writer producing a deep, precise daily AI brief for an ML-literate reader aiming to become a research scientist.",
    `Write in ${language === "fr" ? "FRENCH prose, keeping technical terms in English where that is standard usage" : "ENGLISH"}.`,
    "Be concrete and technical: architectures, objectives, training/inference specifics, benchmarks, limitations.",
    "Every non-obvious factual claim must map to a source URL drawn from the item's primary_sources. Do not introduce facts that aren't in the provided material.",
  ].join("\n");
}
export function techdocPrompt({ date, item }) {
  return [
    TODAY(date),
    "Write one section of the brief for this item. Return JSON:",
    `{"id": "${item.id}", "title": string, "markdown": string, "claims": [{"id": string, "text": string, "source_url": string}]}`,
    "- markdown: a rich technical section (use ## heading, prose, bullet points where useful). 200-450 words.",
    "- claims: every checkable factual assertion in your markdown, each tied to one source_url from the item's sources.",
    "",
    "ITEM:",
    JSON.stringify(item),
  ].join("\n");
}

// ---- Stage C: claim verification -----------------------------------------
export function verifySystem() {
  return "You are a meticulous fact-checker. You are given ONE claim and the extracted text of its cited source. Decide strictly whether the source text supports the claim. Do not use outside knowledge. If the text does not clearly support it, say so.";
}
export function verifyPrompt({ claim, sourceUrl, sourceText }) {
  return [
    `CLAIM: ${claim}`,
    `SOURCE URL: ${sourceUrl}`,
    "SOURCE TEXT (may be truncated):",
    '"""',
    sourceText || "(could not fetch source text)",
    '"""',
    "",
    'Return JSON: {"verdict": "supported"|"unsupported"|"unclear", "quote": string, "note": string}',
    "- quote: a short verbatim span from the source text that supports the claim, or \"\" if none.",
    "- verdict 'unclear' if the source could not be fetched or is ambiguous.",
  ].join("\n");
}

// ---- Stage C (batched): verify several claims in one call ----------------
export function verifyBatchPrompt({ claims }) {
  // claims: [{id, text, source_url, source_excerpt}]
  const blocks = claims
    .map(
      (c, i) =>
        `### CLAIM ${c.id}\nassertion: ${c.text}\nsource: ${c.source_url}\nsource_text:\n"""\n${c.source_excerpt || "(could not fetch source text)"}\n"""`
    )
    .join("\n\n");
  return [
    "Fact-check EACH claim below strictly against ITS OWN source_text only. No outside knowledge.",
    'Return JSON: {"verdicts": [{"id": string, "verdict": "supported"|"unsupported"|"unclear", "quote": string, "note": string}]}',
    "- quote: short verbatim span from that claim's source_text, or \"\" if none.",
    "- 'unclear' if the source text is missing or ambiguous.",
    "",
    blocks,
  ].join("\n");
}

// ---- Stage E: interactive multi-voice radio-show script ------------------
export function podcastSystem({ cast }) {
  const roster = cast.map((c) => `- ${c.id}: ${c.role}`).join("\n");
  return [
    "You are the head writer of a FRENCH daily AI radio show — lively, intelligent, and genuinely interactive, in the spirit of a great public-radio panel.",
    "It is NOT a monologue. A central host drives the show, asks pointed questions, hands off to correspondents/experts for deep dives, and the panel reacts, debates, and builds on each other.",
    "CAST (use these speaker IDs exactly):",
    roster,
    "Writing rules:",
    "- Output ONE turn per line, formatted exactly: `SPEAKER: spoken text`. No markdown, no stage directions in brackets, no URLs, no bullet lists.",
    "- Natural spoken French. Real dialogue: questions, short reactions ('Exactement.', 'Attends, ça veut dire quoi concrètement ?'), disagreements, follow-ups. Vary turn length; avoid long uninterrupted monologues (break them with host interjections).",
    "- The HOST opens with a cold-open hook and a quick run-of-show, introduces each segment, and closes the show. Spell out acronyms on first use.",
    "- Keep it accurate: ONLY use facts from the provided brief. Do not invent. Flag uncertainty naturally ('c'est encore à confirmer').",
  ].join("\n");
}
export function podcastPrompt({ date, brief, discourseMinutes, otherMinutes, cast }) {
  const total = discourseMinutes + otherMinutes;
  const words = Math.round(total * 150);
  const ids = cast.map((c) => c.id).join(", ");
  return [
    TODAY(date),
    `Write the FULL French radio-show script as a dialogue between: ${ids}.`,
    `Total length ≈ ${total} minutes (~${words} words).`,
    `Structure & budget:`,
    `1) Cold-open + run-of-show (host).`,
    `2) DISCOURSE / actualité & déclarations de figures influentes — the main block, ≈ ${discourseMinutes} min: treat each item as a mini-segment with host questions + panel reactions + an expert hand-off.`,
    `3) The OTHER topics (architecture, general/policy, vision/3D, wildcard if present) — ≈ ${otherMinutes} min total, as deeper technical segments with at least one back-and-forth each.`,
    `4) Short outro (host): what to watch next + sign-off.`,
    "Return PLAIN TEXT, one `SPEAKER: text` per line. The FIRST line must be `TITRE: <titre de l'épisode>`.",
    "",
    "VERIFIED BRIEF (markdown):",
    brief,
  ].join("\n");
}

// ---- Stage F: LinkedIn post + carousel -----------------------------------
export function linkedinSystem() {
  return [
    "You are a world-class LinkedIn ghostwriter for a brilliant AI/ML student whose long-term goal is to become a research scientist (Google-caliber). Every post must read as authentically hers, while being engineered to perform.",
    "Write in ENGLISH. Voice: first-person, human, curious, sharp, humble-confident. Absolutely NOT corporate, NOT hype-bro, NOT ChatGPT-generic, NOT emoji-spam.",
    "",
    "VIRALITY & ENGAGEMENT RULES (follow ALL):",
    "1. HOOK: the first line must stop the scroll on its own — a bold claim, a counter-intuitive take, a sharp question, or a vivid stat. ≤ 12 words. No 'I'm excited to share'.",
    "2. SECOND line: amplify the hook / create a curiosity gap so people click 'see more'. Keep the first ~210 characters carrying the whole tension (that's the preview LinkedIn shows).",
    "3. FORMAT for mobile: very short paragraphs (1–2 sentences), generous line breaks, lots of white space. No walls of text. Optionally one tight list with line-break bullets (— or →).",
    "4. SUBSTANCE: one clear idea, a genuine technical insight, and HER point of view / takeaway. Teach one thing precisely. Show taste, not a press release.",
    "5. CTA: end with ONE genuine, low-friction question that invites replies (comments > likes for reach). No 'thoughts?' cliché — make it specific.",
    "6. HASHTAGS: exactly 3–5, specific and mixed reach (e.g. #MachineLearning + a niche one like #StateSpaceModels). On their own last line.",
    "7. MENTIONS: if a lab/company/researcher is central AND clearly identifiable, you MAY add 1–2 @mentions inline (as plain @Name — a human will link them). Never force it.",
    "8. NO outbound links in the body (LinkedIn suppresses reach) — tell the reader the source is 'in the comments'.",
    "9. Length 120–220 words. Authentic > polished. A small, specific personal angle ('I spent the morning re-reading the paper and…') beats grand claims.",
    "Only use facts from the provided brief. Never fabricate.",
  ].join("\n");
}
export function linkedinPrompt({ date, brief }) {
  return [
    TODAY(date),
    "Pick the SINGLE most compelling item for a research-minded audience and produce a viral-engineered LinkedIn post + a designed carousel (the carousel is a teaching asset that complements the post).",
    "Return JSON:",
    `{
  "chosen_item_id": string,
  "post": string,                 // follow ALL virality rules from the system prompt. Hashtags on the last line.
  "first_comment": string,        // the source link + one-line context, to be posted as the first comment (keeps links out of the body)
  "carousel": {
    "kicker": string,            // tiny eyebrow label, e.g. "AI RESEARCH" (<= 3 words)
    "title": string,             // cover title (<= 8 words), punchy
    "subtitle": string,          // cover subtitle (<= 14 words)
    "slides": [                  // 5-8 content slides AFTER the cover, each teaching ONE point
      {
        "heading": string,        // <= 7 words
        "body": string,           // <= 30 words, plain text
        "visual": {               // OPTIONAL — include only when it genuinely clarifies; else omit
          "type": "stat" | "bars" | "flow" | "compare",
          "stat": {"value": string, "label": string},                 // for type "stat"
          "bars": [{"label": string, "value": number}],               // for type "bars" (values 0..100, <=4)
          "steps": [string],                                          // for type "flow" (<=4 short steps)
          "compare": {"leftTitle": string, "left": [string], "rightTitle": string, "right": [string]}  // for type "compare" (<=3 each)
        }
      }
    ],
    "outro": {"heading": string, "body": string}  // follow/CTA slide
  }
}`,
    "Design intent: at least 2-3 slides SHOULD use a visual (stat/bars/flow/compare) so the carousel is graphic, not walls of text.",
    "",
    "VERIFIED BRIEF (markdown):",
    brief,
  ].join("\n");
}
