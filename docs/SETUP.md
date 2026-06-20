# Setup

The default engine is **`claude-code`**: the pipeline drives the local `claude` CLI on
your **Claude Max** plan, so the text work costs nothing per run. Follow the *Local
(Max)* path. The *Cloud (API)* path at the bottom is an optional alternative.

## 0. Prerequisites
- Node 20+ and the `claude` CLI, logged into your Max plan (`claude` runs interactively
  at least once so its auth is stored).
- CLIs: `rsvg-convert` (`librsvg2-bin`), `ffmpeg`, `rclone`
  - Ubuntu: `sudo apt install librsvg2-bin ffmpeg rclone`
- Free TTS (default): `pip install --user edge-tts` (Microsoft neural voices, no key).
  Invoked as `python3 -m edge_tts`, so no PATH setup needed.
- Optional premium TTS: an **ElevenLabs** key (set `podcast.tts.provider` to
  `elevenlabs`). Optional cloud delivery: a **Google Cloud service account**.
  (No Anthropic API key needed for the default `claude-code` engine.)

## 1. Local run (Claude Max engine)
```bash
cp .env.example .env       # add ELEVENLABS_API_KEY (ANTHROPIC_API_KEY only for the API engine)
```
Set your ElevenLabs voice in `pipeline/config.json` → `podcast.tts.voiceId`
(copy an ID from the ElevenLabs Voices page). Then:
```bash
node pipeline/src/orchestrate.mjs --dry-run    # full pipeline, no TTS, no Drive push
node pipeline/src/orchestrate.mjs              # real run (delivers to ~/gdrive/veille if it exists)
```
Useful single stages:
```bash
node pipeline/src/a_research.mjs               # print curated findings JSON
node pipeline/src/f_linkedin.mjs --demo        # render a sample carousel, no LLM call
node pipeline/src/g_publish.mjs --dry-run      # self-test the bundle/feed plumbing
```

## 1b. Schedule it locally
```bash
bash desktop/install-scheduler.sh        # systemd user timer, daily 06:00 (pass HH:MM to change)
systemctl --user start veille.service    # run once now
journalctl --user -u veille.service -f   # watch logs
```
`Persistent=true` means a run missed while the PC was off fires on the next boot. To let
it run even when you're logged out: `sudo loginctl enable-linger $USER`.

## 2. Podcast budget
`pipeline/config.json` → `podcast.targetMinutes`:
- `30` → ElevenLabs **Pro (~$99/mo)** with `eleven_flash_v2_5` — recommended start.
- `60` → ElevenLabs **Scale (~$330/mo)**.

Swap voices/models in `podcast.tts`.

## 3. Google Drive delivery (service account)
1. In Google Cloud Console: create a project → enable the **Google Drive API** →
   create a **Service Account** → create a **JSON key**.
2. In Google Drive, create a folder (e.g. `veille`), **share it with the service
   account's email** (Editor), and copy the **folder ID** from its URL.
3. Locally you can instead use an existing `rclone` remote named per
   `config.delivery.driveRemote` — the pipeline uses it if it exists.

## 4. Optional — Cloud (API) engine via GitHub Actions
Only if you want it to run while your PC is off. Set `engine` to `"api"` in
`pipeline/config.json`, push the repo, then add repo **Settings → Secrets and variables
→ Actions**:

| Secret | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your Anthropic **API** key (separate from Max) |
| `ELEVENLABS_API_KEY` | your ElevenLabs key |
| `GDRIVE_SA_JSON` | the service-account JSON (raw or base64) |
| `GDRIVE_FOLDER_ID` | the shared Drive folder ID |

The workflow `.github/workflows/daily-veille.yml` runs daily at 04:00 UTC and can be
triggered manually (**Actions → daily-veille → Run workflow**, optional `date`).
Adjust the cron there (GitHub cron is UTC). Note: GitHub Actions cannot use your Max
plan, so the cloud path requires an API key.

## 5. Desktop indicator
```bash
bash desktop/install-extension.sh
```
Log out/in (X11/Wayland) to load it. It watches `~/gdrive/veille/feed.json`. If your
synced Drive mirror lives elsewhere, edit `VEILLE_DIR` at the top of
`desktop/gnome-extension/extension.js`.

## 6. Verify end-to-end
1. `node pipeline/src/g_publish.mjs --dry-run` → bundle/feed appear under `out/`.
2. Trigger the GitHub workflow manually → confirm files land in the Drive folder.
3. Once Drive syncs to `~/gdrive/veille`, the 📰 badge appears; click to play.
