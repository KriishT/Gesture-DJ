# Gesture DJ

Mix two decks with your hands. Upload two tracks, use the webcam, and an AI co-pilot guides you through pro-style transitions — or build your own step-by-step in **Build custom**.

## Features

- **Dual vinyl decks** with full-width waveforms, channel LED meters, and a central master section
- **Hand control** — left = Deck A, right = Deck B; solo mode has fixed mappings + example transition recipes
- **AI Assist** — 30+ catalog transitions + Claude picks; gestures randomized each run so you can't memorize patterns
- **Build custom** — stack your own moves (filters, bass swaps, echo, stems) and run them immediately
- **Catch-window scoring** — hit a move on time (green) or the Guard completes it cleanly (red)
- **Pitch-locked SYNC** — match wide BPM gaps without chipmunk vocals (SoundTouch)
- **Reverse scratch** — drag vinyl or peace-sign swipe backward to scrub in reverse
- **6-stem separation** — local NVIDIA GPU (~5–15s) or **Replicate cloud fallback** (no GPU)
- **6 stem transitions** in the catalog (acapella, drums, bass tease, guitar float, piano layer, vocal+guitar)
- **Per-stem mute toggles** + preset pads when stems are ready
- **Record clip** — export your session as `.webm`

## Setup

```bash
npm install
cp server/.env.example server/.env
```

Optional in `server/.env`: `ANTHROPIC_API_KEY`, `REPLICATE_API_TOKEN`, `REPLICATE_DEMUX_VERSION`

Stems: [docs/STEMS_SETUP.md](docs/STEMS_SETUP.md)

## Run

```bash
npm run dev
```

Open http://localhost:5173 — click once to enable audio.

## Workflow

1. Load tracks on A and B.
2. **AI Assist:** Suggest transitions or **Build custom** → Run.
3. Follow animated cues over the camera; play A toward the amber marker.
4. **Solo:** Gesture guide + QUANT / SLIP / pad mode on the master section.
5. **SYNC** = key-locked tempo · **TEMPO** = vinyl pitch · scratch forward or reverse.
