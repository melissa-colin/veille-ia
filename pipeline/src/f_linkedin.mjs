// Stage F — choose the most recruiter-worthy item, write an English LinkedIn
// post, and render a carousel (SVG -> PNG). `--demo` renders sample slides with
// no API call so you can eyeball the design.
import { join } from "node:path";
import { makeBrain } from "./lib/brain.mjs";
import { logger } from "./lib/log.mjs";
import { writeText } from "./lib/util.mjs";
import { renderCarousel } from "./lib/carousel.mjs";
import { linkedinSystem, linkedinPrompt } from "./prompts.mjs";
import { loadConfig } from "./lib/config.mjs";

const log = logger("linkedin");
const BRAND = "@melissacolin · AI research notes";

export async function linkedin({ cfg, date, brief, postPath, carouselDir, client }) {
  const ai = client || makeBrain(cfg);
  const { data } = await ai.json({
    system: linkedinSystem(),
    prompt: linkedinPrompt({ date, brief }),
    model: cfg.linkedin.model,
    maxTokens: 3000,
  });

  const post = data.post || "";
  writeText(postPath, postMarkdown({ date, data }));

  let render = { pngCount: 0, svgCount: 0, rasterized: false };
  if (data.carousel?.slides?.length) {
    render = await renderCarousel({
      carousel: data.carousel,
      dir: carouselDir,
      width: cfg.linkedin.carousel.width,
      height: cfg.linkedin.carousel.height,
      brand: BRAND,
    });
  }
  log.ok(`post + carousel ready`, { item: data.chosen_item_id, slides: render.pngCount || render.svgCount });
  return { chosenItemId: data.chosen_item_id, post, render };
}

function postMarkdown({ date, data }) {
  const lines = [
    `# LinkedIn post — ${date}`,
    "",
    `_Chosen item: ${data.chosen_item_id || "?"}. English. Review, tweak the voice, then post with the carousel PNGs._`,
    "",
    "## Post",
    "",
    "```",
    data.post || "",
    "```",
    "",
    "## Carousel outline",
    "",
    `**Cover:** ${data.carousel?.title || ""} — _${data.carousel?.subtitle || ""}_`,
    "",
    ...(data.carousel?.slides || []).map((s, i) => `${i + 1}. **${s.heading}** — ${s.body}`),
    "",
    `**Outro:** ${data.carousel?.outro?.heading || ""} — ${data.carousel?.outro?.body || ""}`,
  ];
  return lines.join("\n");
}

// --- demo: render a sample carousel without hitting the API ---
async function demo() {
  const cfg = loadConfig();
  const dir = join(cfg.runtime.outDir, "_carousel-demo");
  const carousel = {
    kicker: "AI RESEARCH BRIEF",
    title: "Post-Transformer Models Are Getting Real",
    subtitle: "What this week's state-space results mean for long-context inference",
    slides: [
      { heading: "The bottleneck", body: "Attention is quadratic in sequence length. Past ~100k tokens, that cost dominates everything else." },
      { heading: "State-space idea", body: "SSMs carry a fixed-size recurrent state, giving linear-time inference and constant memory per token." },
      { heading: "Why it matters", body: "Linear scaling unlocks document-, codebase-, and agent-trace-length contexts without exploding cost." },
      { heading: "The catch", body: "Pure SSMs can lag on exact recall. Hybrids interleave a few attention layers to recover it." },
    ],
    outro: { heading: "Follow along", body: "I write a short, source-checked AI brief most days. Wrong takes welcome — tell me where I'm off." },
  };
  const r = await renderCarousel({ carousel, dir, width: cfg.linkedin.carousel.width, height: cfg.linkedin.carousel.height, brand: BRAND });
  log.ok("demo carousel rendered", { dir, ...r });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  demo().catch((e) => {
    log.error(e.stack || e.message);
    process.exit(1);
  });
}
