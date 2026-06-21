// Claude Code engine: drives the local `claude -p` CLI (your Claude Max plan)
// instead of the paid API. Same interface as lib/anthropic.mjs makeClient, so
// stages don't care which engine they got. No per-token billing — uses Max quota.
import { spawn } from "node:child_process";
import { tryParse } from "./anthropic.mjs";

// config models -> claude CLI aliases
function mapModel(m = "") {
  if (m.includes("opus")) return "opus";
  if (m.includes("haiku")) return "haiku";
  return "sonnet";
}

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;

// The `claude -p --output-format json` envelope is one pure-JSON object. Slice
// from the first { to the last } (tolerating stray log lines) and parse as-is.
function parseEnvelope(out) {
  const s = (out || "").trim();
  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  if (i === -1 || j <= i) return null;
  try {
    return JSON.parse(s.slice(i, j + 1));
  } catch {
    return null;
  }
}

export function makeClaudeCodeClient(cfg) {
  const bin = process.env.CLAUDE_BIN || cfg?.claudeBin || "claude";

  const runOnce = ({ system, prompt, model, tools, timeoutMs = 240000 }) =>
    new Promise((resolve, reject) => {
      const args = ["-p", "--output-format", "json", "--model", mapModel(model)];
      if (system) args.push("--append-system-prompt", system);
      if (tools?.length) args.push("--allowedTools", ...tools);
      const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });

      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`claude timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new Error(`failed to spawn '${bin}': ${e.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.slice(-300)}`));
        // Parse the CLI envelope directly. Do NOT use tryParse here: the model's
        // answer (env.result) may contain ```json fences, which tryParse would
        // wrongly extract from inside this JSON string. The envelope itself is
        // always a single pure-JSON object.
        const env = parseEnvelope(out);
        if (!env) return reject(new Error(`claude returned unparseable envelope: ${out.slice(0, 200)}`));
        if (env.is_error) return reject(new Error(`claude error: ${env.result || env.subtype}`));
        const text = String(env.result || "");
        resolve({ text, citations: [...new Set(text.match(URL_RE) || [])], usage: env.usage });
      });

      child.stdin.write(prompt);
      child.stdin.end();
    });

  const withRetry = async (fn, tries = 3) => {
    let last;
    for (let i = 0; i < tries; i++) {
      try {
        return await fn();
      } catch (e) {
        last = e;
        if (i < tries - 1) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
      }
    }
    throw last;
  };

  const api = {
    async chat({ system, messages, model, timeoutMs = 600000 }) {
      // Stages only ever send a single user turn; flatten it. Generous timeout:
      // the podcast script is a long single generation.
      const prompt = (messages || []).map((m) => (typeof m.content === "string" ? m.content : "")).join("\n\n");
      return withRetry(() => runOnce({ system, prompt, model, timeoutMs }), 2);
    },

    async research({ system, prompt, model }) {
      return withRetry(() => runOnce({ system, prompt, model, tools: ["WebSearch", "WebFetch"], timeoutMs: 360000 }));
    },

    async json({ system, prompt, model, maxSearches }) {
      const sys = `${system}\n\nReturn ONLY valid JSON. No prose, no markdown fences.`;
      const call = (extra = "") =>
        maxSearches
          ? api.research({ system: sys, prompt: prompt + extra, model })
          : api.chat({ system: sys, messages: [{ role: "user", content: prompt + extra }], model });
      let res = await call();
      let parsed = tryParse(res.text);
      if (!parsed) {
        res = await call("\n\nYour previous reply was not valid JSON. Reply again with ONLY valid JSON.");
        parsed = tryParse(res.text);
      }
      if (!parsed) throw new Error("Claude Code did not return parseable JSON");
      return { data: parsed, citations: res.citations, raw: res };
    },
  };
  return api;
}
