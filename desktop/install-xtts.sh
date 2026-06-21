#!/usr/bin/env bash
# Isolated local TTS engine: Coqui XTTS-v2 (free, GPU, high-quality, multi-voice).
# Creates ~/.veille-tts WITHOUT touching system Python/torch. Requires `uv`.
set -euo pipefail

VENV="$HOME/.veille-tts"
echo "Creating isolated venv at $VENV …"
uv venv "$VENV" --python 3.12

echo "Installing torch 2.5.1 + torchaudio (CUDA 12.1 wheels; work on newer drivers)…"
VIRTUAL_ENV="$VENV" uv pip install "torch==2.5.1" "torchaudio==2.5.1" --index-url https://download.pytorch.org/whl/cu121

echo "Installing coqui-tts (+ compatible transformers)…"
VIRTUAL_ENV="$VENV" uv pip install coqui-tts "transformers>=4.57,<5"

echo "Smoke test (downloads the ~1.8GB model on first run)…"
COQUI_TOS_AGREED=1 "$VENV/bin/python" - <<'PY'
from TTS.api import TTS
import torch
print("cuda:", torch.cuda.is_available())
print("XTTS import OK — run a full synth via the pipeline (podcast.tts.provider = xtts)")
PY
echo "Done. Set podcast.tts.xttsPython to $VENV/bin/python in pipeline/config.json (default already does)."
