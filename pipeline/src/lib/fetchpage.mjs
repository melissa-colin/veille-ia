// Fetch a URL and reduce it to readable plain text for claim verification.
// Dependency-free: native fetch + a conservative HTML->text strip.
export async function fetchPageText(url, { maxChars = 18000, timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (veille-ia bot; +https://github.com) AppleWebKit/537.36", accept: "text/html,*/*" },
    });
    if (!res.ok) return { ok: false, status: res.status, text: "", url: res.url };
    const ctype = res.headers.get("content-type") || "";
    const body = await res.text();
    const text = ctype.includes("html") ? htmlToText(body) : body;
    return { ok: true, status: res.status, text: text.slice(0, maxChars), url: res.url };
  } catch (e) {
    return { ok: false, status: 0, text: "", url, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|br|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}
