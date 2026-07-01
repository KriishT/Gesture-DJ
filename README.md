# Gesture DJ

Mix two decks with your hands. Upload two tracks, use the webcam, and an AI co-pilot guides you through pro-style transitions — or build your own step-by-step in **Build custom**.

## Features

- **Dual vinyl decks** with full-width waveforms, channel LED meters, and a central master section
- **Hand control** — left = Deck A, right = Deck B; solo mode has fixed mappings + example transition recipes
- **AI Assist** — 30+ catalog transitions + Claude picks; gestures randomized each run so you can't memorize patterns
- **Recommended pairs** — eight curated two-song sets with transition/remix tips (load your own audio)
- **Build custom** — stack your own moves (filters, bass swaps, echo, stems) and run them immediately
- **Catch-window scoring** — hit a move on time (green); the mix runs on schedule either way (red if missed)
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

- **How to use (new users):** [docs/HOW_TO_USE.md](docs/HOW_TO_USE.md)
- Stems (local GPU): [docs/STEMS_SETUP.md](docs/STEMS_SETUP.md)
- **Deploy:** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## Run (development)

```bash
npm run dev
```

Open http://localhost:5173 — click once to enable audio.

## Production (single host)

```bash
npm run build
# Windows PowerShell:
$env:NODE_ENV="production"; $env:SERVE_STATIC="1"; npm start
# macOS / Linux:
NODE_ENV=production SERVE_STATIC=1 npm start
```

Serves the built UI and API on `API_PORT` (default **8787**). Use HTTPS in front (required for webcam).

## Workflow

1. Open **Recommended pairs** for set ideas — load matching files on A and B.
2. **AI Assist:** Suggest transitions or **Build custom** → Run.
3. Follow animated cues over the camera; play A toward the amber marker.
4. **Remix** workspace for vocal-swap / morph sessions (great for stem pairs).
5. **Solo:** Gesture guide + QUANT / SLIP / pad mode on the master section.

## Recommended pairs (built in)

| Deck A | Deck B | Best for |
|--------|--------|----------|
| Show Me Love · Robin S | Gypsy Woman · Crystal Waters | Transitions |
| Levels · Avicii | Good Feeling · Flo Rida | Slam transitions |
| One More Time · Daft Punk | Around the World · Daft Punk | Blend + remix |
| One Dance · Drake | Latch · Disclosure | Remix (stems) |
| I Feel Love · Donna Summer | Last Last · Burna Boy | Bold genre jump |
| Get Lucky · Daft Punk | Blinding Lights · The Weeknd | Stem tease + slam |
| Rolling in the Deep · Adele | About Damn Time · Lizzo | Acapella remix |
| Mr. Brightside · Killers | Feel So Close · Calvin Harris | Guitar stem float |

You provide the audio files — the app analyzes whatever you upload.
