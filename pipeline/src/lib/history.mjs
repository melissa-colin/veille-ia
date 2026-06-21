// Persistent memory of already-covered topics, so the research agents don't
// repeat themselves day to day. Stored in the synced folder.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { readJSONSafe, writeJSON, slugify } from "./util.mjs";

const CAP = 400;

function historyPath(cfg) {
  const mirror = cfg.delivery.localMirror;
  const base = mirror && (existsSync(mirror) || existsSync(dirname(mirror))) ? mirror : cfg.runtime.outDir;
  if (!existsSync(base)) mkdirSync(base, { recursive: true });
  return join(base, "_history.json");
}

export const topicKey = (it) => slugify(`${it.title || ""}`).slice(0, 50);

export function readHistory(cfg) {
  return readJSONSafe(historyPath(cfg), { covered: [] });
}

// Compact list of recently-covered titles (per domain) to inject into prompts.
export function coveredTitles(history, { domain, limit = 60 } = {}) {
  const items = history.covered || [];
  const scoped = domain ? items.filter((c) => c.domain === domain || c.domain === "discourse") : items;
  return scoped.slice(0, limit).map((c) => c.title);
}

export function appendHistory(cfg, items, date) {
  const path = historyPath(cfg);
  const hist = readJSONSafe(path, { covered: [] });
  const seen = new Set(hist.covered.map((c) => c.key));
  for (const it of items) {
    const key = topicKey(it);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    hist.covered.unshift({ date, domain: it.domain || "?", title: it.title || "", key });
  }
  hist.covered = hist.covered.slice(0, CAP);
  writeJSON(path, hist);
  return hist;
}
