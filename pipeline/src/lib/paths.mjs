// Bundle layout for a given date. One folder per day; a top-level feed.json indexes them.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export function bundlePaths(outRoot, date) {
  const dir = join(outRoot, date);
  const carousel = join(dir, "carousel");
  return {
    dir,
    carousel,
    curated: join(dir, "_curated.json"), // internal, not shipped to users but kept for audit
    technicalDoc: join(dir, "technical_doc.md"),
    verification: join(dir, "verification_report.md"),
    sources: join(dir, "sources.md"),
    script: join(dir, "podcast_script.md"),
    podcast: join(dir, "podcast.mp3"),
    linkedin: join(dir, "linkedin_post.md"),
    manifest: join(dir, "manifest.json"),
    feed: join(outRoot, "feed.json"), // index of all episodes (top-level)
    state: join(outRoot, "_state.json"), // last successful run, etc.
    ensure() {
      mkdirSync(carousel, { recursive: true });
      return this;
    },
  };
}
