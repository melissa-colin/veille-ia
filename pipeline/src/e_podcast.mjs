// Stage E — write the French podcast script, synthesize it with ElevenLabs
// (chunked, with prosody continuity), and concat to a single mp3 via ffmpeg.
import { writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { makeBrain } from "./lib/brain.mjs";
import { logger } from "./lib/log.mjs";
import { sh, which, writeText } from "./lib/util.mjs";
import { podcastSystem, podcastPrompt } from "./prompts.mjs";

const log = logger("podcast");
const TTS_URL = (voiceId, fmt) => `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${fmt}`;

export async function writeScript({ cfg, date, brief, client }) {
  const ai = client || makeBrain(cfg);
  const { text } = await ai.chat({
    system: podcastSystem({ targetMinutes: cfg.podcast.targetMinutes }),
    messages: [{ role: "user", content: podcastPrompt({ date, brief, targetMinutes: cfg.podcast.targetMinutes }) }],
    model: cfg.podcast.model,
    maxTokens: 16000,
    temperature: 0.6,
  });
  const m = text.match(/^TITRE:\s*(.+)$/m);
  const title = m ? m[1].trim() : `Veille IA — ${date}`;
  const body = text.replace(/^TITRE:.*$/m, "").trim();
  log.ok(`script written (~${Math.round(body.split(/\s+/).length / 150)} min, ${body.length} chars)`);
  return { title, script: body, full: text };
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
  if ((t.provider || "elevenlabs") === "edge") return synthesizeEdge({ cfg, scriptText, outPath });
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
