# How to use Gesture DJ

A quick start for new users — whether you're on the live site or running locally.

---

## 1. First launch

1. **Click anywhere** on the page once — this unlocks audio in your browser.
2. Click **Start camera** (top right) if you want hand control.  
   - Camera needs **HTTPS** (the live Railway URL is fine; `localhost` works too).
3. Optional: open **How to use** in the top bar for this guide inside the app.

---

## 2. Load music

You need tracks on **Deck A** and **Deck B**.

| Method | How |
|--------|-----|
| **My files** | Open **Library** → **My files** → pick a demo set → **Load both** |
| **Pair ideas** | Open **Library** → **Pair ideas** → click a curated pair (loads from My files if those folders exist) |
| **Your own files** | Click **LOAD** on each deck, or drag & drop an audio file onto a deck |

Supported formats: MP3, WAV, FLAC, OGG, M4A, AAC, WebM.

---

## 3. Choose a workspace

| Mode | Best for |
|------|----------|
| **DJ** | Mixing two full tracks with transitions |
| **Remix** | Vocal swaps and stem-based mashups |

In **DJ**, pick:

- **AI Assist** — co-pilot suggests transitions; follow on-screen cues over the camera.
- **Solo** — fixed gesture mappings; open **Gesture guide** for the cheat sheet.

---

## 4. Stems (optional, powerful)

When a track loads, the app can split it into **6 stems** (vocals, drums, bass, guitar, piano, other).

Top bar → **Stems**:

| Setting | Meaning |
|---------|---------|
| **Auto** | Local GPU if available, otherwise cloud |
| **GPU** | Your machine's NVIDIA GPU only (dev / self-host) |
| **Cloud** | Replicate API (~$0.14/track on the live site) |

On the **deployed site**, stems run in the cloud — wait 1–4 minutes per track.  
Stem moves (acapella, instrumental, drum tease, etc.) work best when **both** decks have stems ready.

---

## 5. Run a transition (AI Assist)

1. Load tracks on **A** and **B**.
2. In the center panel, click **Suggest transitions**.
3. Pick a suggestion — the app arms a recipe.
4. Press **Play** on Deck A and mix toward the amber cue marker on the waveform.
5. Follow **gesture cues** on the camera overlay (or use deck pads if you prefer).
6. **Green** = hit the move on time · **Red** = missed (mix still runs).

**Build custom** lets you stack your own steps (filter, bass swap, echo, stems) and run them immediately.

---

## 6. Remix workspace

1. Switch top bar to **Remix**.
2. Load a pair that works well for mashups (see tags on **My files** sets).
3. Wait for stems on both decks if you want vocal/instrumental swaps.
4. Use the **Remix** panel in the center to morph between tracks.

---

## 7. Deck controls (mouse / touch)

Each deck has:

- **Vinyl** — drag to scratch; peace-sign swipe backward for reverse scrub
- **HI / MID / LOW / FILTER / TEMPO** knobs
- **VOL** fader
- **CUE** pads, **LOOP** 4/8/16, **SYNC**
- FX pads: **BASS**, **ECHO**, **REVERB**, **GATE**, **BRAKE**, **SPIN**

Center **master**: crossfader, **QUANT**, **SLIP**, pad mode.

---

## 8. Record your set

Click **Record** in the top bar to capture the session as a **.webm** clip.

---

## 9. Tips

- **Wide BPM gap?** Use **SYNC** — pitch-locked tempo match keeps vocals natural.
- **Stems failed?** Check **Stems → Cloud** on the live site; retry after a minute if you hit rate limits.
- **No camera?** You can still mix with mouse/touch on the decks.
- **Library empty?** Use **LOAD** on each deck with your own files.

---

## 10. Bundled demo sets (My files)

If the deploy includes demo audio, you'll see folders like **set 1** … **set 5**:

| Set | Good for |
|-----|----------|
| Set 1 | Transitions + remix |
| Set 2 | Slam transitions + remix (B vocal on A) |
| Set 3 | Daft Punk-style blends |
| Set 4 | Pop transitions |
| Set 5 | Remix-focused |

---

## Need help?

- Gesture reference: **Gesture guide** (top bar, Solo mode)
- Developer setup: [README](../README.md) · [STEMS_SETUP](STEMS_SETUP.md) · [DEPLOYMENT](DEPLOYMENT.md)
