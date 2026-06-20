// Small fs + shell helpers shared across stages.
import { writeFileSync, readFileSync, existsSync, mkdirSync, cpSync } from "node:fs";
import { dirname } from "node:path";
import { execFile } from "node:child_process";

export function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
  return path;
}
export const writeJSON = (path, obj) => writeText(path, JSON.stringify(obj, null, 2));

export function readJSONSafe(path, fallback = null) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

export const copyInto = (src, dest) => cpSync(src, dest, { recursive: true });

// Promise-based command runner. Returns {code, stdout, stderr}; never throws on
// non-zero unless `must` is set — callers decide how strict to be.
export function sh(cmd, args = [], { must = false, env } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = { code: err?.code ?? 0, stdout: stdout || "", stderr: stderr || "" };
      if (err && must) reject(Object.assign(new Error(`${cmd} failed: ${stderr || err.message}`), out));
      else resolve(err ? { ...out, code: err.code ?? 1 } : out);
    });
  });
}

export async function which(bin) {
  const r = await sh("which", [bin]);
  return r.code === 0 ? r.stdout.trim() : null;
}

// Run fn over items with bounded concurrency, preserving order.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

export const slugify = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
