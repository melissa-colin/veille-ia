// Minimal structured logger with stage scoping and timing.
const COLORS = { gray: 90, red: 31, green: 32, yellow: 33, blue: 34, cyan: 36 };
const paint = (c, s) => (process.stdout.isTTY ? `\x1b[${COLORS[c]}m${s}\x1b[0m` : s);
const ts = () => new Date().toISOString().slice(11, 19);

export function logger(scope = "veille") {
  const tag = paint("cyan", `[${scope}]`);
  const line = (color, level, msg, extra) => {
    const head = `${paint("gray", ts())} ${tag} ${paint(color, level)}`;
    if (extra !== undefined) console.log(head, msg, paint("gray", JSON.stringify(extra)));
    else console.log(head, msg);
  };
  return {
    info: (m, e) => line("blue", "•", m, e),
    ok: (m, e) => line("green", "✓", m, e),
    warn: (m, e) => line("yellow", "!", m, e),
    error: (m, e) => line("red", "✗", m, e),
    step: (m) => line("gray", "→", m),
    async time(label, fn) {
      const t0 = Date.now();
      line("blue", "•", `${label} …`);
      try {
        const r = await fn();
        line("green", "✓", `${label} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
        return r;
      } catch (e) {
        line("red", "✗", `${label} failed: ${e.message}`);
        throw e;
      }
    },
  };
}
