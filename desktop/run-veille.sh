#!/usr/bin/env bash
# Launcher the top-bar button spawns to generate a new veille on demand.
# Resolves node/claude/edge-tts even when launched from the GNOME shell env.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

export PATH="$HOME/.local/bin:$PATH"   # claude, edge-tts
if ! command -v node >/dev/null 2>&1; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
fi

LOGDIR="$HOME/.local/state/veille-news"
mkdir -p "$LOGDIR"
echo "=== run $(date -Iseconds) ===" >> "$LOGDIR/run.log"
exec node pipeline/src/orchestrate.mjs "$@" >> "$LOGDIR/run.log" 2>&1
