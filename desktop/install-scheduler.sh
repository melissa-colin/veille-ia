#!/usr/bin/env bash
# Install a systemd *user* timer that runs the veille pipeline locally every
# morning. Persistent=true means a run missed while the PC was off fires on the
# next boot/login — so you still get today's brief when you power on.
#
# Uses the local `claude` CLI (your Max plan) — no API key needed for the text.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(command -v node)"
CLAUDE_BIN="$(command -v claude || true)"
[ -z "$NODE_BIN" ] && { echo "node not found in PATH"; exit 1; }
[ -z "$CLAUDE_BIN" ] && { echo "claude CLI not found in PATH"; exit 1; }
NODE_DIR="$(dirname "$NODE_BIN")"
CLAUDE_DIR="$(dirname "$CLAUDE_BIN")"
RUN_AT="${1:-06:00}"   # pass HH:MM to override (local time)

UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"

cat > "$UNIT_DIR/veille.service" <<EOF
[Unit]
Description=Veille IA — daily AI brief (local, Claude Max)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$REPO
Environment=PATH=$CLAUDE_DIR:$NODE_DIR:/usr/local/bin:/usr/bin:/bin
ExecStart=$NODE_BIN pipeline/src/orchestrate.mjs
# Bundle is delivered to ~/gdrive/veille; secrets (ELEVENLABS_API_KEY) read from .env
EOF

cat > "$UNIT_DIR/veille.timer" <<EOF
[Unit]
Description=Run Veille IA every morning at $RUN_AT (local)

[Timer]
OnCalendar=*-*-* $RUN_AT:00
Persistent=true
AccuracySec=1min

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now veille.timer

echo "Installed. Timer status:"
systemctl --user --no-pager list-timers veille.timer || true
cat <<EOF

Tips:
  • Run it once now:     systemctl --user start veille.service
  • Watch logs:          journalctl --user -u veille.service -f
  • Change the time:     bash desktop/install-scheduler.sh 07:30
  • Run even when logged out (optional):  sudo loginctl enable-linger $USER
EOF
