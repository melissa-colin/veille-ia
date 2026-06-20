# Setup

## 0. Prerequisites
- Node 20+
- CLIs: `rsvg-convert` (`librsvg2-bin`), `ffmpeg`, `rclone`
  - Ubuntu: `sudo apt install librsvg2-bin ffmpeg rclone`
- Accounts/keys: **Anthropic** (required), **ElevenLabs** (for audio), a **Google
  Cloud service account** (for Drive delivery from CI).

## 1. Local run
```bash
cp .env.example .env       # fill ANTHROPIC_API_KEY (and ELEVENLABS_API_KEY)
```
Set your ElevenLabs voice in `pipeline/config.json` → `podcast.tts.voiceId`
(get IDs from the ElevenLabs Voice Library / API). Then:
```bash
node pipeline/src/orchestrate.mjs --dry-run    # full pipeline, no TTS, no Drive push
node pipeline/src/orchestrate.mjs              # real run (delivers to ~/gdrive/veille if it exists)
```
Useful single stages:
```bash
node pipeline/src/a_research.mjs               # print curated findings JSON
node pipeline/src/f_linkedin.mjs --demo        # render a sample carousel, no API
node pipeline/src/g_publish.mjs --dry-run      # self-test the bundle/feed plumbing
```

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

## 4. GitHub Actions (cloud cron)
Push this repo (public is fine — no secrets are committed), then add repo
**Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your Anthropic key |
| `ELEVENLABS_API_KEY` | your ElevenLabs key |
| `GDRIVE_SA_JSON` | the service-account JSON (raw or base64) |
| `GDRIVE_FOLDER_ID` | the shared Drive folder ID |

The workflow `.github/workflows/daily-veille.yml` runs daily at 04:00 UTC and can be
triggered manually (**Actions → daily-veille → Run workflow**, optional `date`).
Adjust the cron there (GitHub cron is UTC).

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
