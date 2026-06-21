#!/usr/bin/env python3
"""Multi-voice XTTS-v2 synthesis. Loads the model ONCE, then renders each turn
with its speaker's voice to a wav. GPU with automatic CPU fallback on OOM.

Usage: xtts_synth.py --turns turns.json --outdir DIR [--device cuda] [--language fr]
turns.json = [{"i": 0, "voice": "Ana Florence", "text": "..."}, ...]
Prints one line per finished turn: "DONE <i>" / "FAIL <i> <msg>".
"""
import argparse, json, os, sys
os.environ.setdefault("COQUI_TOS_AGREED", "1")


def load(device):
    from TTS.api import TTS
    return TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--turns", required=True)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--language", default="fr")
    a = ap.parse_args()

    turns = json.load(open(a.turns, encoding="utf-8"))
    os.makedirs(a.outdir, exist_ok=True)

    device = a.device
    try:
        import torch
        if device == "cuda" and not torch.cuda.is_available():
            device = "cpu"
    except Exception:
        device = "cpu"

    try:
        tts = load(device)
    except Exception as e:
        print(f"LOAD_FALLBACK_CPU {str(e)[:120]}", flush=True)
        device = "cpu"
        tts = load("cpu")
    print(f"DEVICE {device}", flush=True)

    for t in turns:
        out = os.path.join(a.outdir, f"turn_{t['i']:04d}.wav")
        try:
            tts.tts_to_file(text=t["text"], speaker=t["voice"], language=a.language, file_path=out)
            print(f"DONE {t['i']}", flush=True)
        except RuntimeError as e:
            # On CUDA OOM, drop to CPU for the rest and retry this turn.
            if device == "cuda" and "out of memory" in str(e).lower():
                print(f"OOM_TO_CPU {t['i']}", flush=True)
                import torch; torch.cuda.empty_cache()
                device = "cpu"; tts = load("cpu")
                tts.tts_to_file(text=t["text"], speaker=t["voice"], language=a.language, file_path=out)
                print(f"DONE {t['i']}", flush=True)
            else:
                print(f"FAIL {t['i']} {str(e)[:120]}", flush=True)
        except Exception as e:
            print(f"FAIL {t['i']} {str(e)[:120]}", flush=True)


if __name__ == "__main__":
    main()
