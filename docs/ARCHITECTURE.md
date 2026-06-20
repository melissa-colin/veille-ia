# Architecture

## Goals

1. **Autonomous** — produce a complete daily AI brief with no human in the loop.
2. **Trustworthy** — no hallucinated facts; every claim is tied to (and checked
   against) a primary source.
3. **Cloud-first** — runs while the user's machine is off; the user receives it on
   next power-on, with multi-day backlogs handled gracefully.
4. **Low-maintenance** — minimal moving parts, no dependency rot.

## Pipeline stages

The orchestrator (`pipeline/src/orchestrate.mjs`) runs eight stages for one date.
Each stage is an importable function and a standalone CLI, so any stage can be run
and debugged in isolation.

### A — Research & curation (`a_research.mjs`)
One research agent per domain (`config.research.domains`) runs concurrently, each
with the Anthropic **server-side web search** tool. Agents return **structured JSON
findings** (`title`, `summary`, `why_it_matters`, `technical_details`,
`primary_sources`, `claims`, `importance`, `is_niche`, `confidence`). Conditional
domains return `{notable:false}` to opt out. A curation pass deduplicates, merges
sources, ranks, and selects 5–12 items balancing headline and niche.

### B — Technical document (`b_techdoc.mjs`)
A writer agent per item produces a deep technical section **plus the atomic claims**
it makes, each tagged with the source URL that backs it. This claim list is the
contract Stage C verifies.

### C — Verification — *the anti-hallucination core* (`c_verify.mjs`)
For each claim, the source page is fetched (`lib/fetchpage.mjs`, native `fetch` +
HTML→text) and a strict checker (Opus) decides `supported | unsupported | unclear`
using **only** that source text, returning a supporting quote. High-stakes claims
(numbers, "SOTA", benchmarks) get independent re-checks and are downgraded on any
disagreement. Page fetches are cached across claims sharing a URL. Output: the
verification report + inline ⚠ flags on the brief.

### D — Sources (`d_sources.mjs`)
Pure compilation: dedup primary sources, group by domain, annotate each with the
best verification verdict seen for claims citing it.

### E — Podcast (`e_podcast.mjs`)
A French script (~`targetMinutes`×150 words) is written from the **verified** brief,
then synthesized: split into ≤2.5k-char chunks at sentence boundaries, each TTS'd
with `previous_text`/`next_text` for prosody continuity, concatenated with `ffmpeg`
stream-copy, duration probed with `ffprobe`.

### F — LinkedIn (`f_linkedin.mjs`)
Picks the most research-worthy item; writes an English post in a genuine, non-hype
student-researcher voice; emits a carousel spec rendered to 1080×1350 PNGs as SVG →
`rsvg-convert` (`lib/carousel.mjs`, with manual word-wrapping since SVG has none).

### G — Publish (`g_publish.mjs`)
Writes `manifest.json`, upserts the top-level `feed.json` (the index the desktop
reads), records run state, and delivers the whole tree to Google Drive — via a
locally-synced mirror if present (dev), otherwise `rclone` with a **service account**
synthesized from secrets (CI).

### H — Desktop indicator (`desktop/gnome-extension/`)
A GNOME Shell extension watches `~/gdrive/veille/feed.json`, badges the count of
**unheard** episodes (tracked in a *local* state file so Drive overwrites of
`feed.json` never reset it), and on click plays the podcast / opens the brief.

## Why the multi-day backlog "just works"
Catch-up is **not** re-generation. The cloud cron writes one bundle per day to
Drive regardless of the laptop's state. A laptop that was off for N days syncs N
bundles on boot; `feed.json` already lists them all; the extension badges every
unheard one. This keeps the pipeline stateless and avoids the impossible task of
re-researching historical news windows.

## Failure handling
Every stage is wrapped so a failure is logged, recorded in `manifest.errors`, and
the run continues — a partial bundle (e.g. brief without audio) is still published
rather than losing the whole day. Exit code 2 signals partial success.

## Security
No secrets in the repo. Locally they live in `.env` (gitignored); in CI they are
GitHub Secrets injected as env vars. The Drive service-account JSON is written to a
`0600` temp file only for the rclone call.
