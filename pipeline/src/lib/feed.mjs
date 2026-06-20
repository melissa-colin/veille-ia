// feed.json = the index the GNOME extension reads. One entry per episode (day),
// newest first, each with a `heard` flag the desktop side flips locally.
import { readJSONSafe, writeJSON } from "./util.mjs";

export function buildManifest({ date, items, hasPodcast, hasCarousel, durationSec, errors }) {
  return {
    date,
    generatedAt: `${date}T00:00:00Z`, // stamped by date; CI passes the real time via env if needed
    headline: items?.[0]?.title || "Veille IA",
    itemCount: items?.length || 0,
    domains: [...new Set((items || []).map((i) => i.domain))],
    files: {
      podcast: hasPodcast ? "podcast.mp3" : null,
      technicalDoc: "technical_doc.md",
      sources: "sources.md",
      verification: "verification_report.md",
      linkedin: "linkedin_post.md",
      carousel: hasCarousel ? "carousel/" : null,
    },
    podcastDurationSec: durationSec || null,
    errors: errors || [],
  };
}

export function upsertFeed(feedPath, manifest) {
  const feed = readJSONSafe(feedPath, { version: 1, episodes: [] });
  const entry = {
    date: manifest.date,
    headline: manifest.headline,
    itemCount: manifest.itemCount,
    domains: manifest.domains,
    hasPodcast: !!manifest.files.podcast,
    durationSec: manifest.podcastDurationSec,
    heard: false,
    publishedAt: manifest.generatedAt,
  };
  feed.episodes = [entry, ...feed.episodes.filter((e) => e.date !== manifest.date)].sort((a, b) =>
    a.date < b.date ? 1 : -1
  );
  writeJSON(feedPath, feed);
  return feed;
}

export const readState = (statePath) => readJSONSafe(statePath, { lastRun: null, runs: [] });
export function writeState(statePath, date, ok) {
  const st = readState(statePath);
  if (ok) st.lastRun = date;
  st.runs = [{ date, ok, at: `${date}T00:00:00Z` }, ...st.runs].slice(0, 60);
  writeJSON(statePath, st);
  return st;
}
