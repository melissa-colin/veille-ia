// Stage E — write the French podcast script, synthesize it with ElevenLabs
// (chunked, with prosody continuity), and concat to a single mp3 via ffmpeg.
import { writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { makeBrain } from "./lib/brain.mjs";
import { logger } from "./lib/log.mjs";
import { sh, which, writeText, mapLimit } from "./lib/util.mjs";
import { podcastSystem, podcastPrompt } from "./prompts.mjs";

const log = logger("podcast");
const TTS_URL = (voiceId, fmt) => `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${fmt}`;

export async function writeScript({ cfg, date, brief, client }) {
  const ai = client || makeBrain(cfg);
  const cast = cfg.podcast.cast || [{ id: "ALEX", role: "host", voice: cfg.podcast.tts.edgeVoice }];
  const { text } = await ai.chat({
    system: podcastSystem({ cast }),
    messages: [{ role: "user", content: podcastPrompt({ date, brief, discourseMinutes: cfg.podcast.discourseMinutes || 30, otherMinutes: cfg.podcast.otherMinutes || 40, cast }) }],
    model: cfg.podcast.model,
    maxTokens: 32000,
    temperature: 0.6,
  });
  const m = text.match(/^TITRE:\s*(.+)$/m);
  const title = m ? m[1].trim() : `Veille IA — ${date}`;
  const body = text.replace(/^TITRE:.*$/m, "").trim();
  log.ok(`script written (~${Math.round(body.split(/\s+/).length / 150)} min, ${body.length} chars)`);
  return { title, script: body, full: text };
}

// Parse "SPEAKER: text" lines into voiced turns; merge consecutive same-speaker
// lines; lines with no speaker prefix attach to the previous turn.
export function parseTurns(scriptText, cast) {
  const byId = Object.fromEntries(cast.map((c) => [c.id.toUpperCase(), c.voice]));
  const fallback = cast[0]?.voice;
  const turns = [];
  for (const rawLine of scriptText.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(/^([A-ZÀ-Ÿ][A-ZÀ-Ÿ_ '-]{1,18}):\s*(.+)$/);
    if (m && byId[m[1].toUpperCase().trim()]) {
      const id = m[1].toUpperCase().trim();
      turns.push({ speaker: id, voice: byId[id], text: m[2].trim() });
    } else if (turns.length) {
      turns[turns.length - 1].text += " " + line.replace(/^[A-ZÀ-Ÿ_ '-]{1,18}:\s*/, "");
    } else {
      turns.push({ speaker: "?", voice: fallback, text: line });
    }
  }
  // merge consecutive same-speaker turns
  const merged = [];
  for (const t of turns) {
    const last = merged[merged.length - 1];
    if (last && last.voice === t.voice) last.text += " " + t.text;
    else merged.push({ ...t });
  }
  return merged;
}

// Split into TTS-sized chunks at sentence/paragraph boundaries.
export function chunkScript(text, maxChars) {
  const sentences = text.replace(/\n{2,}/g, "\n\n").split(/(?<=[.!?…])\s+|\n\n/);
  const chunks = [];
  let cur = "";
  for (const s of sentences) {
    if (!s.trim()) continue;
    if ((cur + " " + s).trim().length > maxChars && cur) {
      chunks.push(cur.trim());
      cur = s;
    } else {
      cur = (cur + " " + s).trim();
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

export async function synthesize({ cfg, scriptText, outPath }) {
  const t = cfg.podcast.tts;
  const cast = cfg.podcast.cast || [];
  const hasTurns = cast.length > 1 && /^[A-ZÀ-Ÿ][A-ZÀ-Ÿ_ '-]{1,18}:\s/m.test(scriptText);
  if ((t.provider || "elevenlabs") === "edge") {
    return hasTurns ? synthesizeEdgeMulti({ cfg, scriptText, outPath, cast }) : synthesizeEdge({ cfg, scriptText, outPath });
  }
  if (!cfg.secrets.elevenlabs) {
    log.warn("no ELEVENLABS_API_KEY — skipping TTS (script still delivered)");
    return { ok: false, durationSec: null, reason: "no-key" };
  }
  if (!t.voiceId || t.voiceId.startsWith("REPLACE_")) {
    log.warn("no ElevenLabs voiceId set in config — skipping TTS");
    return { ok: false, durationSec: null, reason: "no-voice" };
  }
  if (!(await which("ffmpeg"))) {
    log.warn("ffmpeg not found — skipping TTS concat");
    return { ok: false, durationSec: null, reason: "no-ffmpeg" };
  }

  const chunks = chunkScript(scriptText, t.maxCharsPerRequest);
  const work = join(tmpdir(), `veille-tts-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  log.info(`synthesizing ${chunks.length} chunk(s) with ${t.modelId}`);

  try {
    for (let i = 0; i < chunks.length; i++) {
      const buf = await ttsRequest({
        key: cfg.secrets.elevenlabs,
        voiceId: t.voiceId,
        fmt: t.format,
        modelId: t.modelId,
        text: chunks[i],
        previous_text: chunks[i - 1] || undefined,
        next_text: chunks[i + 1] || undefined,
        settings: { stability: t.stability, similarity_boost: t.similarityBoost },
      });
      writeFileSync(join(work, `chunk_${String(i).padStart(3, "0")}.mp3`), buf);
      if ((i + 1) % 5 === 0 || i === chunks.length - 1) log.step(`  ${i + 1}/${chunks.length}`);
    }

    // Concat with ffmpeg (stream copy).
    const files = readdirSync(work).filter((f) => f.endsWith(".mp3")).sort();
    const listPath = join(work, "list.txt");
    writeFileSync(listPath, files.map((f) => `file '${join(work, f)}'`).join("\n"));
    const r = await sh("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath]);
    if (r.code !== 0) throw new Error(`ffmpeg concat failed: ${r.stderr.slice(-300)}`);

    const durationSec = await probeDuration(outPath);
    log.ok(`podcast.mp3 written (${durationSec ? Math.round(durationSec / 60) + " min" : "?"})`);
    return { ok: true, durationSec, chunks: chunks.length };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// Free neural TTS via Microsoft Edge voices (no key). edge-tts handles long
// text itself; we invoke it as a Python module so it works regardless of PATH.
async function synthesizeEdge({ cfg, scriptText, outPath }) {
  const t = cfg.podcast.tts;
  const voice = t.edgeVoice || "fr-FR-HenriNeural";
  const work = join(tmpdir(), `veille-edge-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  const txt = join(work, "script.txt");
  writeFileSync(txt, scriptText, "utf8");
  log.info(`synthesizing with edge-tts (${voice})`);
  try {
    const r = await sh("python3", ["-m", "edge_tts", "--voice", voice, "--file", txt, "--write-media", outPath], {
      env: { PYTHONIOENCODING: "utf-8" },
    });
    if (r.code !== 0 || !existsSync(outPath)) {
      log.warn(`edge-tts failed (install: pip install --user edge-tts): ${r.stderr.slice(-200)}`);
      return { ok: false, durationSec: null, reason: "edge-failed" };
    }
    const durationSec = await probeDuration(outPath);
    log.ok(`podcast.mp3 written via edge-tts (${durationSec ? Math.round(durationSec / 60) + " min" : "?"})`);
    return { ok: true, durationSec, provider: "edge" };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// Multi-voice radio show: one edge-tts call per turn (its speaker's voice),
// short pauses between turns, then a normalized concat.
async function synthesizeEdgeMulti({ cfg, scriptText, outPath, cast }) {
  if (!(await which("ffmpeg"))) {
    log.warn("ffmpeg not found — falling back to single-voice");
    return synthesizeEdge({ cfg, scriptText, outPath });
  }
  const turns = parseTurns(scriptText, cast);
  if (!turns.length) return synthesizeEdge({ cfg, scriptText, outPath });
  const work = join(tmpdir(), `veille-multi-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  log.info(`synthesizing ${turns.length} turn(s) across ${new Set(turns.map((t) => t.voice)).size} voice(s)`);

  try {
    // A short silence clip to separate turns (natural radio pacing).
    const silence = join(work, "sil.mp3");
    await sh("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "0.32", "-c:a", "libmp3lame", "-b:a", "64k", silence]);

    let ok = 0;
    await mapLimit(turns, 4, async (turn, i) => {
      const f = join(work, `turn_${String(i).padStart(4, "0")}.mp3`);
      const r = await sh("python3", ["-m", "edge_tts", "--voice", turn.voice, "--text", turn.text, "--write-media", f], { env: { PYTHONIOENCODING: "utf-8" } });
      if (r.code === 0 && existsSync(f)) ok++;
      else log.warn(`turn ${i} (${turn.speaker}) failed: ${r.stderr.slice(-120)}`);
      if ((i + 1) % 20 === 0) log.step(`  ${i + 1}/${turns.length}`);
    });
    if (!ok) return { ok: false, durationSec: null, reason: "all-turns-failed" };

    // Build ordered concat list: turn, silence, turn, silence…
    const list = [];
    for (let i = 0; i < turns.length; i++) {
      const f = join(work, `turn_${String(i).padStart(4, "0")}.mp3`);
      if (existsSync(f)) {
        list.push(`file '${f}'`);
        list.push(`file '${silence}'`);
      }
    }
    const listPath = join(work, "list.txt");
    writeFileSync(listPath, list.join("\n"));
    const r = await sh("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c:a", "libmp3lame", "-b:a", "64k", outPath]);
    if (r.code !== 0 || !existsSync(outPath)) throw new Error(`ffmpeg concat failed: ${r.stderr.slice(-200)}`);

    const durationSec = await probeDuration(outPath);
    log.ok(`podcast.mp3 written (multi-voice, ${durationSec ? Math.round(durationSec / 60) + " min" : "?"}, ${ok}/${turns.length} turns)`);
    return { ok: true, durationSec, turns: turns.length, provider: "edge-multi" };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function ttsRequest({ key, voiceId, fmt, modelId, text, previous_text, next_text, settings }) {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(TTS_URL(voiceId, fmt), {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: modelId, previous_text, next_text, voice_settings: settings }),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const retryable = res.status === 429 || res.status >= 500;
    const msg = await res.text().catch(() => "");
    if (!retryable || i === 3) throw new Error(`ElevenLabs ${res.status}: ${msg.slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 1500 * 2 ** i));
  }
}

async function probeDuration(file) {
  if (!(await which("ffprobe"))) return null;
  const r = await sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  const d = parseFloat(r.stdout.trim());
  return Number.isFinite(d) ? Math.round(d) : null;
}

// Full stage: script -> mp3.
export async function podcast({ cfg, date, brief, scriptPath, outPath, client }) {
  const { title, script } = await writeScript({ cfg, date, brief, client });
  writeText(scriptPath, `# ${title}\n\n${script}\n`);
  if (cfg.runtime.dryRun) {
    log.warn("dry-run: script written, skipping TTS");
    return { title, durationSec: null, audio: false };
  }
  const tts = await synthesize({ cfg, scriptText: script, outPath });
  return { title, durationSec: tts.durationSec, audio: tts.ok };
}
