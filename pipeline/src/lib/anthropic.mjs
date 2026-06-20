// Dependency-free Anthropic Messages API client (native fetch). Supports the
// server-side web_search tool and schema-checked JSON output, with bounded
// retries on transient errors. No SDK — keeps the repo install-free.
const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export function makeClient(apiKey) {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is missing");

  const post = async (body, { tries = 4, base = 1500 } = {}) => {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetch(API_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": API_VERSION,
          },
          body: JSON.stringify(body),
        });
        if (res.ok) return await res.json();
        const retryable = res.status === 429 || res.status === 529 || res.status >= 500;
        const text = await res.text().catch(() => "");
        lastErr = new Error(`Anthropic ${res.status}: ${text.slice(0, 300)}`);
        if (!retryable || i === tries - 1) throw lastErr;
      } catch (e) {
        lastErr = e;
        if (i === tries - 1) throw e;
      }
      await new Promise((r) => setTimeout(r, base * 2 ** i + ((i * 997) % 500)));
    }
    throw lastErr;
  };

  const textOf = (msg) =>
    (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();

  const searchCitations = (msg) => {
    const urls = new Set();
    for (const b of msg.content || []) {
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const r of b.content) if (r.url) urls.add(r.url);
      }
      for (const c of b.citations || []) if (c.url) urls.add(c.url);
    }
    return [...urls];
  };

  const api = {
    async chat({ system, messages, model, maxTokens = 4096, tools, temperature = 0.4 }) {
      const msg = await post({ model, max_tokens: maxTokens, temperature, system, tools, messages });
      return { text: textOf(msg), citations: searchCitations(msg), raw: msg };
    },

    async research({ system, prompt, model, maxSearches = 8, maxTokens = 8000 }) {
      const msg = await post({
        model,
        max_tokens: maxTokens,
        system,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearches }],
        messages: [{ role: "user", content: prompt }],
      });
      return { text: textOf(msg), citations: searchCitations(msg), raw: msg };
    },

    async json({ system, prompt, model, maxTokens = 8000, maxSearches }) {
      const sys = `${system}\n\nReturn ONLY valid JSON. No prose, no markdown fences.`;
      const call = (extra = "") =>
        maxSearches
          ? api.research({ system: sys, prompt: prompt + extra, model, maxSearches, maxTokens })
          : api.chat({ system: sys, messages: [{ role: "user", content: prompt + extra }], model, maxTokens, temperature: 0.2 });

      let res = await call();
      let parsed = tryParse(res.text);
      if (!parsed) {
        res = await call("\n\nYour previous reply was not valid JSON. Reply again with ONLY valid JSON.");
        parsed = tryParse(res.text);
      }
      if (!parsed) throw new Error("Model did not return parseable JSON");
      return { data: parsed, citations: res.citations, raw: res.raw };
    },
  };
  return api;
}

export function tryParse(text) {
  if (!text) return null;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const first = Math.min(...["{", "["].map((c) => (s.indexOf(c) === -1 ? Infinity : s.indexOf(c))));
  const last = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (first !== Infinity && last > first) s = s.slice(first, last + 1);
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
