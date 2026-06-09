# Stem Separation Setup (GPU)

Gesture DJ can split each loaded track into **6 stems** (drums, bass, other, vocals, guitar, piano) using **HTDemucs** on your machine. This powers acapella/instrumental transitions and per-stem mixing.

Typical separation time: **5–15 seconds per song** on an NVIDIA RTX-class GPU.

Without GPU setup, the app still works fully — stem features show as unavailable and all other mixing continues normally.

---

## Requirements

| Item | Details |
|------|---------|
| **GPU** | NVIDIA GPU with CUDA support (GTX 1060 6GB or better recommended) |
| **Python** | 3.10 or 3.11 (3.12+ may work but is less tested with torch stacks) |
| **Disk** | ~3 GB free for PyTorch + Demucs model weights (first run downloads weights) |
| **RAM** | 8 GB+ system RAM |
| **OS** | Windows 10/11, Linux, or macOS (CUDA only on NVIDIA; macOS uses CPU and is **much slower**) |

The Express API server (`npm run dev`) must be running — stem jobs are processed server-side.

---

## Windows setup (recommended)

### 1. Install Python

Download Python 3.11 from [python.org](https://www.python.org/downloads/). During install, check **“Add python.exe to PATH”**.

Verify:

```powershell
python --version
pip --version
```

### 2. Install CUDA PyTorch

Visit [pytorch.org/get-started/locally](https://pytorch.org/get-started/locally/) and pick **Stable → Windows → Pip → CUDA 12.x** (match your NVIDIA driver).

Example (CUDA 12.4):

```powershell
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
```

Verify GPU is visible:

```powershell
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'no gpu')"
```

You should see `True` and your GPU name.

### 3. Install Demucs dependencies

From the project root:

```powershell
cd server/stems
pip install -r requirements.txt
```

### 4. Run the app

```powershell
cd ../..
npm run dev
```

Load a track on either deck. If setup succeeded, the stem bar shows **“Separating stems…”** then **“✓ 6 stems ready”**.

---

## Linux setup

Same as Windows, but install NVIDIA drivers + CUDA toolkit first. Use the PyTorch pip wheel for your CUDA version.

```bash
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
pip install -r server/stems/requirements.txt
npm run dev
```

---

## macOS (CPU only — not recommended for live use)

Demucs will run on CPU but can take **several minutes per track**. Install CPU PyTorch:

```bash
pip install torch torchaudio
pip install -r server/stems/requirements.txt
```

---

## How it works

1. Browser uploads the audio file to `POST /api/stems`.
2. Server spawns `server/stems/separate.py` with the HTDemucs 6-stem model.
3. Progress is polled via `GET /api/stems/:jobId`.
4. Stems are streamed back via `GET /api/stems/:jobId/:stem` and loaded into the deck’s Web Audio graph.

Files are stored temporarily under `server/stems/tmp/` and cleaned up after the job completes.

---

## Troubleshooting

### “Stems need NVIDIA GPU” in the UI

- Confirm `torch.cuda.is_available()` returns `True`.
- Restart the API server after installing Python packages.
- Check the browser Network tab for `/api/stems` errors — hover the stem bar for the message.

### `python` not found (Windows)

Reinstall Python with “Add to PATH”, or use `py -3.11` instead of `python` in commands.

### Out of memory during separation

- Close other GPU apps.
- Use shorter clips for testing (< 5 min).
- A 6 GB VRAM card is the practical minimum for HTDemucs at full quality.

### Separation is slow (> 60 s)

- Usually means CPU fallback — reinstall CUDA PyTorch.
- Update NVIDIA drivers.

### API returns 500 on `/api/stems`

Check the terminal running `npm run server` for Python tracebacks. Common causes:

- Missing `demucs` or `torch` install
- Corrupt / unsupported audio format (try WAV or MP3)
- Antivirus blocking subprocess spawn

---

## Stem presets in the app

Once stems are ready, use the deck pads:

| Pad | Effect |
|-----|--------|
| **FULL** | All stems |
| **ACA** | Vocals only (acapella) |
| **INST** | Everything except vocals |
| **DRUM** | Drums only |
| **BASS** | Bass only |

These combine with hand gestures and transition recipes (e.g. acapella tease over a new beat).

---

## Optional: verify separation manually

```powershell
cd server/stems
python separate.py --input "C:\path\to\song.mp3" --out "C:\temp\stems-out"
```

You should see six `.wav` files in the output folder within ~15 seconds on a mid-range GPU.

---

## Cloud fallback (no GPU)

If you don't have an NVIDIA GPU, you can use **Replicate** for stem separation (~10–60 seconds per track, paid API usage).

1. Create an account at [replicate.com](https://replicate.com) and copy your API token.
2. Find a Demucs model on Replicate (search "demucs") and copy its **version hash**.
3. Add to `server/.env`:

```env
REPLICATE_API_TOKEN=r8_your_token_here
REPLICATE_DEMUX_VERSION=abc123...version_hash
```

4. Restart `npm run dev`. The health check will show **"Cloud stem fallback ready"**.

When local CUDA is unavailable, uploads automatically route to Replicate instead of Python.

**Cost:** Replicate bills per second of GPU time — typically a few cents per track. Monitor usage on your Replicate dashboard.
