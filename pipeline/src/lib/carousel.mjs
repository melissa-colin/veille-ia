// Render a polished LinkedIn carousel: gradient slides with data-driven visuals
// (stat / bars / flow / compare), rasterized to PNG via rsvg-convert and bundled
// into a PDF (LinkedIn's document format). No browser / no npm deps.
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { writeText, sh, which } from "./util.mjs";

const T = {
  bg0: "#0b1220",
  bg1: "#131d33",
  card: "#1b2740",
  accent: "#6ea8fe",
  accent2: "#8ce0b0",
  text: "#f2f6ff",
  muted: "#9bb0d0",
  track: "#26344f",
  font: "Inter, 'DejaVu Sans', 'Segoe UI', Arial, sans-serif",
};

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function wrapText(text, fontSize, maxWidth) {
  const cpl = Math.max(6, Math.floor(maxWidth / (fontSize * 0.54)));
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > cpl && line) { lines.push(line); line = w; }
    else line = (line + " " + w).trim();
  }
  if (line) lines.push(line);
  return lines;
}
const tspans = (lines, x, y, lh) => lines.map((l, i) => `<tspan x="${x}" y="${y + i * lh}">${esc(l)}</tspan>`).join("");

function defs(w, h) {
  return `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${T.bg0}"/><stop offset="1" stop-color="${T.bg1}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.12" cy="0.08" r="0.5">
      <stop offset="0" stop-color="${T.accent}" stop-opacity="0.20"/><stop offset="1" stop-color="${T.accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect width="${w}" height="${h}" fill="url(#glow)"/>`;
}

// ---- visual blocks (return SVG positioned within a content area) ----------
function visualSVG(v, x, y, w) {
  if (!v || !v.type) return "";
  if (v.type === "stat" && v.stat) {
    return `<g>
      <rect x="${x}" y="${y}" width="${w}" height="240" rx="24" fill="${T.card}"/>
      <text x="${x + 48}" y="${y + 150}" fill="${T.accent2}" font-family="${T.font}" font-size="120" font-weight="800">${esc(v.stat.value)}</text>
      <text x="${x + 48}" y="${y + 205}" fill="${T.muted}" font-family="${T.font}" font-size="34">${esc(v.stat.label)}</text>
    </g>`;
  }
  if (v.type === "bars" && Array.isArray(v.bars)) {
    const bars = v.bars.slice(0, 4);
    const rowH = 86;
    const rows = bars.map((b, i) => {
      const by = y + 20 + i * rowH;
      const pct = Math.max(0, Math.min(100, Number(b.value) || 0));
      const barW = Math.round((w - 96) * (pct / 100));
      return `<text x="${x}" y="${by}" fill="${T.text}" font-family="${T.font}" font-size="30" font-weight="600">${esc(b.label)}</text>
        <rect x="${x}" y="${by + 14}" width="${w - 96}" height="26" rx="13" fill="${T.track}"/>
        <rect x="${x}" y="${by + 14}" width="${barW}" height="26" rx="13" fill="${T.accent}"/>
        <text x="${x + w - 80}" y="${by + 36}" fill="${T.accent2}" font-family="${T.font}" font-size="28" font-weight="700">${pct}</text>`;
    }).join("");
    return `<g>${rows}</g>`;
  }
  if (v.type === "flow" && Array.isArray(v.steps)) {
    const steps = v.steps.slice(0, 4);
    const rowH = 96;
    const rows = steps.map((s, i) => {
      const sy = y + i * rowH;
      const lines = wrapText(s, 30, w - 120);
      const arrow = i < steps.length - 1 ? `<text x="${x + 30}" y="${sy + 86}" fill="${T.accent}" font-family="${T.font}" font-size="34">↓</text>` : "";
      return `<rect x="${x}" y="${sy}" width="${w}" height="68" rx="16" fill="${T.card}"/>
        <circle cx="${x + 34}" cy="${sy + 34}" r="16" fill="${T.accent}"/>
        <text x="${x + 34}" y="${sy + 44}" text-anchor="middle" fill="${T.bg0}" font-family="${T.font}" font-size="26" font-weight="800">${i + 1}</text>
        <text x="${x + 70}" y="${sy + 43}" fill="${T.text}" font-family="${T.font}" font-size="30">${esc(lines[0] || "")}</text>${arrow}`;
    }).join("");
    return `<g>${rows}</g>`;
  }
  if (v.type === "compare" && v.compare) {
    const c = v.compare, colW = (w - 32) / 2;
    const col = (cx, title, items) => {
      const head = `<rect x="${cx}" y="${y}" width="${colW}" height="64" rx="14" fill="${T.card}"/>
        <text x="${cx + 24}" y="${y + 42}" fill="${T.accent}" font-family="${T.font}" font-size="30" font-weight="700">${esc(title)}</text>`;
      const lis = (items || []).slice(0, 3).map((it, i) => {
        const ly = y + 96 + i * 70;
        const lines = wrapText(it, 27, colW - 56);
        return `<circle cx="${cx + 18}" cy="${ly - 8}" r="5" fill="${T.accent2}"/><text x="${cx + 40}" y="${ly}" fill="${T.text}" font-family="${T.font}" font-size="27">${esc(lines[0] || "")}</text>`;
      }).join("");
      return head + lis;
    };
    return `<g>${col(x, c.leftTitle, c.left)}${col(x + colW + 32, c.rightTitle, c.right)}</g>`;
  }
  return "";
}

function coverSVG({ w, h, cover, brand }) {
  const M = 96, inner = w - 2 * M;
  const tl = wrapText(cover.title, 96, inner);
  const sl = wrapText(cover.subtitle, 40, inner);
  const titleY = 470;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    ${defs(w, h)}
    <rect x="0" y="0" width="14" height="${h}" fill="${T.accent}"/>
    <text x="${M}" y="240" fill="${T.accent2}" font-family="${T.font}" font-size="32" font-weight="800" letter-spacing="4">${esc((cover.kicker || "AI RESEARCH").toUpperCase())}</text>
    <rect x="${M}" y="290" width="84" height="6" rx="3" fill="${T.accent}"/>
    <text fill="${T.text}" font-family="${T.font}" font-size="96" font-weight="800">${tspans(tl, M, titleY, 110)}</text>
    <text fill="${T.muted}" font-family="${T.font}" font-size="40" font-weight="400">${tspans(sl, M, titleY + tl.length * 110 + 60, 56)}</text>
    <text x="${M}" y="${h - 80}" fill="${T.muted}" font-family="${T.font}" font-size="28" font-weight="600">${esc(brand)}</text>
    <text x="${w - M}" y="${h - 80}" text-anchor="end" fill="${T.accent}" font-family="${T.font}" font-size="30" font-weight="700">swipe →</text>
  </svg>`;
}

function contentSVG({ w, h, index, total, heading, body, visual, brand }) {
  const M = 96, inner = w - 2 * M;
  const hl = wrapText(heading, 58, inner);
  const bl = wrapText(body, 36, inner);
  let yc = 300;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    defs(w, h),
    `<rect x="0" y="0" width="14" height="${h}" fill="${T.accent}"/>`,
    `<text x="${M}" y="190" fill="${T.accent}" font-family="${T.font}" font-size="30" font-weight="700">${String(index).padStart(2, "0")} / ${String(total).padStart(2, "0")}</text>`,
    `<text fill="${T.text}" font-family="${T.font}" font-size="58" font-weight="800">${tspans(hl, M, yc, 70)}</text>`,
  ];
  yc += hl.length * 70 + 30;
  parts.push(`<text fill="${T.muted}" font-family="${T.font}" font-size="36" font-weight="400">${tspans(bl, M, yc, 52)}</text>`);
  yc += bl.length * 52 + 60;
  if (visual) parts.push(visualSVG(visual, M, yc, inner));
  parts.push(
    `<text x="${M}" y="${h - 80}" fill="${T.muted}" font-family="${T.font}" font-size="26" font-weight="600">${esc(brand)}</text>`,
    `<text x="${w - M}" y="${h - 80}" text-anchor="end" fill="${T.accent}" font-family="${T.font}" font-size="28">→</text>`,
    `</svg>`
  );
  return parts.join("");
}

// carousel = {kicker,title,subtitle, slides:[{heading,body,visual?}], outro:{heading,body}}
export async function renderCarousel({ carousel, dir, width = 1080, height = 1350, brand = "" }) {
  mkdirSync(dir, { recursive: true });
  const rsvg = await which("rsvg-convert");
  const slides = [];
  slides.push(coverSVG({ w: width, h: height, cover: { kicker: carousel.kicker, title: carousel.title, subtitle: carousel.subtitle }, brand }));
  const content = [...carousel.slides];
  if (carousel.outro) content.push({ heading: carousel.outro.heading, body: carousel.outro.body });
  const total = carousel.slides.length;
  content.forEach((s, i) => slides.push(contentSVG({ w: width, h: height, index: i + 1, total, heading: s.heading, body: s.body, visual: s.visual, brand })));

  const pngs = [];
  const pdfPages = [];
  for (let i = 0; i < slides.length; i++) {
    const n = String(i + 1).padStart(2, "0");
    const svgPath = join(dir, `${n}.svg`);
    writeText(svgPath, slides[i]);
    if (rsvg) {
      const png = join(dir, `${n}.png`);
      if ((await sh("rsvg-convert", ["-w", String(width), "-h", String(height), "-o", png, svgPath])).code === 0) pngs.push(png);
      const pdf = join(dir, `.${n}.pdf`);
      if ((await sh("rsvg-convert", ["-f", "pdf", "-o", pdf, svgPath])).code === 0) pdfPages.push(pdf);
    }
  }

  const pdfPath = await buildPdf(pdfPages, pngs, join(dir, "carousel.pdf"));
  return { pngCount: pngs.length, pdf: pdfPath, rasterized: !!rsvg };
}

// Merge per-slide PDFs (pdfunite > gs), else fall back to PNG->PDF (ImageMagick).
async function buildPdf(pdfPages, pngs, out) {
  if (pdfPages.length && (await which("pdfunite"))) {
    if ((await sh("pdfunite", [...pdfPages, out])).code === 0 && existsSync(out)) return out;
  }
  if (pdfPages.length && (await which("gs"))) {
    const r = await sh("gs", ["-q", "-dNOPAUSE", "-dBATCH", "-sDEVICE=pdfwrite", `-sOutputFile=${out}`, ...pdfPages]);
    if (r.code === 0 && existsSync(out)) return out;
  }
  if (pngs.length && (await which("convert"))) {
    if ((await sh("convert", [...pngs, out])).code === 0 && existsSync(out)) return out;
  }
  return null;
}
