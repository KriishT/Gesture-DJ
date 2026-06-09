#!/usr/bin/env python3
"""
Fast GPU stem separation for Gesture DJ.

Uses Meta HTDemucs 6-stem (drums, bass, other, vocals, guitar, piano) on CUDA.
Target: ~5-15s for a typical 3-4 minute track on an NVIDIA GPU (RTX 3060+).

Requires: pip install -r server/stems/requirements.txt
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

STEM_NAMES = ("drums", "bass", "other", "vocals", "guitar", "piano")


def write_status(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def main() -> int:
    if len(sys.argv) < 4:
        print("Usage: separate.py <input_audio> <output_dir> <status.json>", file=sys.stderr)
        return 2

    input_path = Path(sys.argv[1]).resolve()
    output_dir = Path(sys.argv[2]).resolve()
    status_path = Path(sys.argv[3]).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.time()

    def status(phase: str, progress: float, **extra):
        write_status(
            status_path,
            {
                "phase": phase,
                "progress": round(progress, 3),
                "elapsedSec": round(time.time() - t0, 2),
                **extra,
            },
        )

    try:
        import torch
        import torchaudio
        from demucs.pretrained import get_model
        from demucs.apply import apply_model
    except ImportError as e:
        status("error", 0, error=f"Missing dependency: {e}. Run: pip install -r server/stems/requirements.txt")
        return 1

    if not input_path.is_file():
        status("error", 0, error=f"Input not found: {input_path}")
        return 1

    if not torch.cuda.is_available():
        status(
            "error",
            0,
            error=(
                "CUDA GPU not detected. For 10-15s separation you need an NVIDIA GPU with "
                "CUDA-enabled PyTorch. CPU separation takes several minutes."
            ),
        )
        return 1

    device = torch.device("cuda")
    gpu_name = torch.cuda.get_device_name(0)

    status("loading", 0.05, gpu=gpu_name, model="htdemucs_6s")

    try:
        model = get_model("htdemucs_6s")
        model.to(device)
        model.eval()
    except Exception as e:
        status("error", 0, error=f"Failed to load model: {e}")
        return 1

    status("loading", 0.12, gpu=gpu_name)

    try:
        wav, sr = torchaudio.load(str(input_path))
    except Exception as e:
        status("error", 0, error=f"Failed to read audio: {e}")
        return 1

    # Demucs expects stereo 44.1kHz
    if wav.shape[0] == 1:
        wav = wav.repeat(2, 1)
    if sr != 44100:
        wav = torchaudio.functional.resample(wav, sr, 44100)
        sr = 44100

    wav = wav.unsqueeze(0).to(device)
    duration_sec = wav.shape[-1] / sr

    status("separating", 0.2, gpu=gpu_name, durationSec=round(duration_sec, 1))

    try:
        with torch.inference_mode():
            # shifts=0 and moderate overlap for speed while keeping HTDemucs quality
            sources = apply_model(
                model,
                wav,
                device=device,
                shifts=0,
                overlap=0.25,
                progress=False,
            )
    except Exception as e:
        status("error", 0, error=f"Separation failed: {e}")
        return 1

    status("writing", 0.85, gpu=gpu_name)

    written: list[str] = []
    for i, name in enumerate(model.sources):
        stem_wav = sources[0, i].cpu()
        out_path = output_dir / f"{name}.wav"
        torchaudio.save(str(out_path), stem_wav, sr)
        written.append(name)

    elapsed = time.time() - t0
    status(
        "done",
        1.0,
        gpu=gpu_name,
        stems=written,
        elapsedSec=round(elapsed, 2),
        durationSec=round(duration_sec, 1),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
