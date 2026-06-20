#!/usr/bin/env bash
# Install (and enable) the Veille IA GNOME top-bar indicator for the current user.
# After running, log out/in (X11) — or on Wayland the extension loads on next login.
set -euo pipefail

UUID="veille-news@melissacolin.ai"
SRC="$(cd "$(dirname "$0")/gnome-extension" && pwd)"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "Installing $UUID …"
mkdir -p "$DEST"
cp -f "$SRC"/metadata.json "$SRC"/extension.js "$SRC"/stylesheet.css "$DEST/"
echo "Copied to $DEST"

if command -v gnome-extensions >/dev/null 2>&1; then
  gnome-extensions enable "$UUID" 2>/dev/null && echo "Enabled." || \
    echo "Could not enable yet — it will be available after the next login. Then: gnome-extensions enable $UUID"
fi

echo
echo "Done. If you don't see the 📰 icon:"
echo "  • X11:     log out and back in (or Alt+F2, type 'r', Enter to restart the shell)."
echo "  • Wayland: log out and back in."
echo "The icon watches: \$HOME/gdrive/veille/feed.json"
