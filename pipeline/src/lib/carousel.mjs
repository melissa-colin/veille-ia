// Render LinkedIn carousel slides as SVG and rasterize to PNG via rsvg-convert.
// No browser / no npm deps. SVG has no auto-wrap, so we wrap text ourselves.
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { writeText, sh, which } from "./util.mjs";

// Research-y, recruiter-friendly palette (dark, calm, high-contrast).
const THEME = {
  bg: "#0d1117",
  panel: "#161b22",
  accent: "#58a6ff",
  accent2: "#7ee787",
  text: "#e6edf3",
  muted: "#8b949e",
  font: "Inter, 'DejaVu Sans', 'Segoe UI', Arial, sans-serif",
};

const esc = (s) =>
  String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Greedy word-wrap to an approximate character budget for a given font size.
export function wrapText(text, fontSize, maxWidth) {
  const charsPerLine = Math.max(8, Math.floor(maxWidth / (fontSize * 0.54)));
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > charsPerLine && line) {
      lines.push(line);
      line = w;
    } else line = (line + " " + w).trim();
  }
  if (line) lines.push(line);
  return lines;
}

function tspans(lines, x, startY, lineHeight) {
  return lines
    .map((l, i) => `<tspan x="${x}" y="${startY + i * lineHeight}">${esc(l)}</tspan>`)
    .join("");
}

function slideSVG({ kind, index, total, width, height, cover, heading, body, brand }) {
  const M = 96; // margin
  const inner = width - 2 * M;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="${THEME.bg}"/>`,
    `<rect x="0" y="0" width="14" height="${height}" fill="${THEME.accent}"/>`,
  ];

  if (kind === "cover") {
    const tl = wrapText(cover.title, 92, inner);
    const sl = wrapText(cover.subtitle, 40, inner);
    parts.push(
      `<text x="${M}" y="220" fill="${THEME.accent2}" font-family="${THEME.font}" font-size="34" font-weight="700" letter-spacing="3">${esc(cover.kicker || "AI RESEARCH BRIEF")}</text>`,
      `<text fill="${THEME.text}" font-family="${THEME.font}" font-size="92" font-weight="800">${tspans(tl, M, 360, 108)}</text>`,
      `<text fill="${THEME.muted}" font-family="${THEME.font}" font-size="40" font-weight="400">${tspans(sl, M, 360 + tl.length * 108 + 70, 56)}</text>`
    );
  } else if (kind === "outro") {
    const hl = wrapText(heading, 72, inner);
    const bl = wrapText(body, 38, inner);
    parts.push(
      `<text fill="${THEME.accent}" font-family="${THEME.font}" font-size="72" font-weight="800">${tspans(hl, M, 420, 86)}</text>`,
      `<text fill="${THEME.text}" font-family="${THEME.font}" font-size="38" font-weight="400">${tspans(bl, M, 420 + hl.length * 86 + 50, 54)}</text>`
    );
  } else {
    const hl = wrapText(heading, 60, inner);
    const bl = wrapText(body, 38, inner);
    parts.push(
      `<text x="${M}" y="200" fill="${THEME.accent}" font-family="${THEME.font}" font-size="30" font-weight="700">${String(index).padStart(2, "0")} / ${String(total).padStart(2, "0")}</text>`,
      `<text fill="${THEME.text}" font-family="${THEME.font}" font-size="60" font-weight="800">${tspans(hl, M, 320, 74)}</text>`,
      `<text fill="${THEME.muted}" font-family="${THEME.font}" font-size="38" font-weight="400">${tspans(bl, M, 320 + hl.length * 74 + 50, 54)}</text>`
    );
  }

  // Footer brand on every slide.
  parts.push(
    `<text x="${M}" y="${height - 70}" fill="${THEME.muted}" font-family="${THEME.font}" font-size="28" font-weight="600">${esc(brand || "")}</text>`,
    `<text x="${width - M}" y="${height - 70}" text-anchor="end" fill="${THEME.muted}" font-family="${THEME.font}" font-size="28">→</text>`,
    `</svg>`
  );
  return parts.join("");
}

// carousel = {kicker?, title, subtitle, slides:[{heading,body}], outro:{heading,body}}
export async function renderCarousel({ carousel, dir, width = 1080, height = 1350, brand = "" }) {
  mkdirSync(dir, { recursive: true });
  const rsvg = await which("rsvg-convert");
  const slides = [];
  slides.push({ kind: "cover", cover: { kicker: carousel.kicker, title: carousel.title, subtitle: carousel.subtitle } });
  carousel.slides.forEach((s) => slides.push({ kind: "content", heading: s.heading, body: s.body }));
  if (carousel.outro) slides.push({ kind: "outro", heading: carousel.outro.heading, body: carousel.outro.body });

  const total = carousel.slides.length;
  const written = [];
  for (let i = 0; i < slides.length; i++) {
    const svg = slideSVG({ ...slides[i], index: i, total, width, height, brand });
    const svgPath = join(dir, `${String(i + 1).padStart(2, "0")}.svg`);
    const pngPath = join(dir, `${String(i + 1).padStart(2, "0")}.png`);
    writeText(svgPath, svg);
    if (rsvg) {
      const r = await sh("rsvg-convert", ["-w", String(width), "-h", String(height), "-o", pngPath, svgPath]);
      if (r.code === 0) written.push(pngPath);
    }
  }
  return { svgCount: slides.length, pngCount: written.length, rasterized: !!rsvg };
}
