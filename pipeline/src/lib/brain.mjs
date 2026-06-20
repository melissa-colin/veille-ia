// Picks the LLM engine: "claude-code" (local CLI, your Max plan, no token billing)
// or "api" (Anthropic REST, pay-per-token, works in the cloud). Both expose the
// same {chat, research, json} interface.
import { makeClient } from "./anthropic.mjs";
import { makeClaudeCodeClient } from "./claudecode.mjs";

export function makeBrain(cfg) {
  const engine = cfg.engine || "claude-code";
  if (engine === "api") return makeClient(cfg.secrets.anthropic);
  return makeClaudeCodeClient(cfg);
}

// How many LLM calls to run at once. Max quota is tighter than the API, so the
// claude-code engine is capped lower by default.
export function engineConcurrency(cfg) {
  if (cfg.engineConcurrency) return cfg.engineConcurrency;
  return (cfg.engine || "claude-code") === "api" ? 6 : 2;
}
