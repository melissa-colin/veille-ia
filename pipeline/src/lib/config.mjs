// Loads config.json, expands ~, and exposes runtime flags + env-backed secrets.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(__dirname, "..", "..", ".."); // pipeline/src/lib -> repo root
export const PIPELINE_DIR = join(REPO_ROOT, "pipeline");

export const expandHome = (p) => (p?.startsWith("~") ? join(homedir(), p.slice(1)) : p);

// Load a local .env (simple parser, no dependency) if present. CI uses real env vars.
function loadDotEnv() {
  const envPath = join(REPO_ROOT, ".env");
  if (!existsSync(envPath)) return;
  for (const raw of readFileSync(envPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
}

let _config;
export function loadConfig() {
  if (_config) return _config;
  loadDotEnv();
  const cfg = JSON.parse(readFileSync(join(PIPELINE_DIR, "config.json"), "utf8"));

  // Runtime flags (CLI/env) layered on top of file config.
  const argv = process.argv.slice(2);
  cfg.runtime = {
    dryRun: argv.includes("--dry-run") || process.env.VEILLE_DRY_RUN === "1",
    only: valueOf(argv, "--only"), // run a single stage, e.g. --only research
    date: valueOf(argv, "--date") || "today",
    outDir: process.env.VEILLE_OUT_DIR || join(REPO_ROOT, "out"),
  };
  cfg.delivery.localMirror = expandHome(cfg.delivery.localMirror);

  cfg.secrets = {
    anthropic: process.env.ANTHROPIC_API_KEY || "",
    elevenlabs: process.env.ELEVENLABS_API_KEY || "",
    gdriveSaJson: process.env.GDRIVE_SA_JSON || "",
    gdriveFolderId: process.env.GDRIVE_FOLDER_ID || "",
  };
  _config = cfg;
  return cfg;
}

function valueOf(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}

// Resolve "today" / "yesterday" / ISO date to YYYY-MM-DD using the configured tz.
export function resolveDate(token, tz) {
  const now = new Date();
  if (token === "yesterday") now.setUTCDate(now.getUTCDate() - 1);
  if (token && token !== "today" && token !== "yesterday") return token; // assume ISO
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
