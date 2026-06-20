// Stage G — assemble the bundle's manifest, update feed/state, and deliver the
// whole out tree to Google Drive (rclone service account, or a locally-synced
// Drive mirror for dev). Importable as publish(); runnable with --self-test.
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, resolveDate } from "./lib/config.mjs";
import { bundlePaths } from "./lib/paths.mjs";
import { logger } from "./lib/log.mjs";
import { sh, which, writeText, copyInto } from "./lib/util.mjs";
import { buildManifest, upsertFeed, writeState } from "./lib/feed.mjs";

const log = logger("publish");

export async function publish({ cfg, date, items = [], durationSec = null, errors = [] }) {
  const outRoot = cfg.runtime.outDir;
  const p = bundlePaths(outRoot, date);

  const manifest = buildManifest({
    date,
    items,
    hasPodcast: existsSync(p.podcast),
    hasCarousel: existsSync(join(p.carousel, "01.png")),
    durationSec,
    errors,
  });
  writeText(p.manifest, JSON.stringify(manifest, null, 2));
  upsertFeed(p.feed, manifest);
  writeState(p.state, date, errors.length === 0);
  log.ok("manifest + feed + state written", { date, items: manifest.itemCount });

  if (cfg.runtime.dryRun) {
    log.warn("dry-run: skipping Drive delivery");
    return { delivered: false, manifest, outRoot };
  }
  const delivered = await deliver(cfg, outRoot);
  return { delivered, manifest, outRoot };
}

// Try local Drive mirror first (fast dev path), then rclone (CI path).
async function deliver(cfg, outRoot) {
  const mirror = cfg.delivery.localMirror;
  if (mirror && existsSync(mirror)) {
    copyInto(`${outRoot}/.`, mirror);
    log.ok(`copied bundle into synced Drive mirror: ${mirror}`);
    return true;
  }
  const rclone = await which("rclone");
  if (!rclone) {
    log.warn("no local Drive mirror and rclone not installed — bundle stays local only", { outRoot });
    return false;
  }
  const { confPath, remote } = await ensureRcloneConfig(cfg);
  const dest = `${remote}:${cfg.delivery.driveSubdir}`;
  const args = ["copy", outRoot, dest, "--fast-list", "--transfers=4", "--checkers=8"];
  if (confPath) args.unshift("--config", confPath);
  log.step(`rclone ${args.join(" ")}`);
  const r = await sh("rclone", args);
  if (r.code !== 0) {
    log.error("rclone delivery failed", { stderr: r.stderr.slice(-400) });
    return false;
  }
  log.ok(`delivered to Drive (${dest})`);
  return true;
}

// If the user already has an rclone remote named per config, use it. Otherwise
// synthesize a config from the GDRIVE_SA_JSON + GDRIVE_FOLDER_ID secrets (CI).
async function ensureRcloneConfig(cfg) {
  const remote = cfg.delivery.driveRemote;
  const list = await sh("rclone", ["listremotes"]);
  if (list.code === 0 && list.stdout.includes(`${remote}:`)) return { confPath: null, remote };

  const saRaw = cfg.secrets.gdriveSaJson;
  const folderId = cfg.secrets.gdriveFolderId;
  if (!saRaw || !folderId) {
    throw new Error("No rclone remote and no GDRIVE_SA_JSON/GDRIVE_FOLDER_ID to build one");
  }
  const dir = join(tmpdir(), "veille-rclone");
  mkdirSync(dir, { recursive: true });
  const saJson = saRaw.trim().startsWith("{") ? saRaw : Buffer.from(saRaw, "base64").toString("utf8");
  const saPath = join(dir, "sa.json");
  writeFileSync(saPath, saJson, { mode: 0o600 });
  const confPath = join(dir, "rclone.conf");
  writeFileSync(
    confPath,
    `[${remote}]\ntype = drive\nscope = drive\nservice_account_file = ${saPath}\nroot_folder_id = ${folderId}\n`,
    { mode: 0o600 }
  );
  log.step("synthesized rclone config from service account");
  return { confPath, remote };
}

// --- CLI: self-test the delivery plumbing without running any AI stage ---
async function selfTest() {
  const cfg = loadConfig();
  const date = resolveDate(cfg.runtime.date, cfg.schedule.localTimezone);
  const p = bundlePaths(cfg.runtime.outDir, date).ensure();
  const items = [{ title: "Hello-world veille bundle", domain: "general" }];
  writeText(p.technicalDoc, `# Veille IA — ${date}\n\n_Self-test bundle (no AI run)._\n`);
  writeText(p.sources, "# Sources\n\n- self-test, no sources.\n");
  writeText(p.verification, "# Verification\n\n- self-test, nothing to verify.\n");
  writeText(p.linkedin, "Self-test post.\n");
  writeText(join(p.carousel, "README.txt"), "carousel slides go here\n");
  const res = await publish({ cfg, date, items });
  log.ok("self-test complete", { delivered: res.delivered, outRoot: res.outRoot, date });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  selfTest().catch((e) => {
    log.error(e.stack || e.message);
    process.exit(1);
  });
}
