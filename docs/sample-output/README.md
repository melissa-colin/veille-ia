# Sample output

Illustrative artifacts so you can see what the pipeline produces without running
it. The carousel PNGs here are rendered by `node pipeline/src/f_linkedin.mjs --demo`
(no API call). A real daily run additionally produces `podcast.mp3`,
`technical_doc.md`, `verification_report.md`, and `sources.md` in a dated folder.

- `carousel/01.png … 06.png` — a 6-slide English LinkedIn carousel (1080×1350),
  cover → content → outro.
- `linkedin_post.md` — the kind of post that ships alongside the carousel.

> These are samples for display. Live runs are generated daily and delivered to
> Google Drive, not committed here.
