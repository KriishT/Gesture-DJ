# Deployment guide

Gesture DJ is a **browser app** (React + Web Audio + webcam) plus a **Node API** (AI co-pilot + stem separation). Plan around three capabilities:

| Feature | Needs server? | Needs GPU? |
|---------|---------------|------------|
| Mixing, gestures, offline transition catalog | No | No |
| AI transition picks (Claude) | Yes | No |
| 6-stem separation | Yes | Local GPU **or** Replicate cloud |

---

## Architecture

```
Browser (HTTPS in production)
  ├── Audio decoded locally (user uploads files)
  ├── MediaPipe hand tracking (CDN)
  └── fetch → API
        ├── POST /api/copilot  → Anthropic
        └── POST /api/stems    → Python+CUDA  OR  Replicate
```

**Camera requires HTTPS** in production (localhost is exempt).

---

## Stem separation in production

You have **two paths** — pick one per environment.

### Option A — Local NVIDIA GPU (best latency, ~5–15s per track)

- Run the API on a **GPU VPS** (AWS g4, Hetzner GPU, etc.)
- Install CUDA PyTorch + `pip install -r server/stems/requirements.txt`
- Set `STEM_PYTHON=python` if needed
- `GET /health` should report `stems.ok: true` with a CUDA device name

**Pros:** Fast, no per-track cloud bill  
**Cons:** You manage GPU drivers, Python, disk space for `.stem-jobs/`

### Option B — Replicate cloud (no GPU on your server)

- Create account at [replicate.com](https://replicate.com)
- Set in `server/.env`:
  - `REPLICATE_API_TOKEN`
  - `REPLICATE_DEMUX_VERSION` (6-stem Demucs-compatible model hash)
- API host can be a **cheap CPU** instance (Railway, Render, Fly)

**Pros:** No GPU ops; works on any PaaS  
**Cons:** ~10–60s per track, paid per run, needs outbound internet

### What does *not* work

- **Serverless-only** (Vercel/Netlify functions) for stems — uploads are large, jobs are long, no local Python subprocess
- **CPU-only Demucs** — `separate.py` intentionally refuses CPU (too slow for UX)

### Stem job limitations today

- Jobs live in **memory + disk** (`server/stems/.stem-jobs/`) — lost on API restart
- Not safe to scale API horizontally without sticky sessions or external job store
- No automatic cleanup of old jobs (disk grows)

For a v1 public deploy, **one API instance** + Replicate is the pragmatic choice.

---

## Recommended deploy patterns

### 1. Single host (simplest)

One machine serves UI + API together.

```bash
npm install
cp server/.env.example server/.env   # fill keys
npm run build
NODE_ENV=production SERVE_STATIC=1 npm start
```

Express serves `dist/` and `/api/*` on the same port (`API_PORT`, default 8787). Put **Nginx/Caddy** in front with TLS.

**Stems:** GPU on the same box (Option A) or Replicate (Option B).

### 2. Split frontend + API

| Piece | Host | Build |
|-------|------|-------|
| Frontend | Cloudflare Pages, Netlify, S3+CDN | `npm run build` → upload `dist/` |
| API | Railway, Render, Fly | `npm start` |

Set at **build time** for the frontend:

```bash
VITE_API_URL=https://api.yourdomain.com npm run build
```

Set on the **API**:

```bash
CORS_ORIGIN=https://yourdomain.com
```

**Stems:** Use Replicate unless the API host has a GPU.

### 3. Local-first (current dev experience)

```bash
npm run dev
```

Vite proxies `/api` and `/health` to port 8787. Ideal for development and demos on your own machine with an RTX GPU.

---

## Environment variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `ANTHROPIC_API_KEY` | API | AI co-pilot (optional — offline catalog works without it) |
| `REPLICATE_API_TOKEN` | API | Cloud stems |
| `REPLICATE_DEMUX_VERSION` | API | Demucs model version on Replicate |
| `STEM_PYTHON` | API | Python binary for local GPU stems |
| `API_PORT` | API | Listen port (default 8787) |
| `NODE_ENV=production` | API | Enables static `dist/` serving when present |
| `SERVE_STATIC=1` | API | Force serve `dist/` from Express |
| `CORS_ORIGIN` | API | Comma-separated allowed frontend origins |
| `VITE_API_URL` | Frontend build | API base URL when split hosting |

Never expose `ANTHROPIC_API_KEY` or `REPLICATE_API_TOKEN` to the browser.

---

## Pre-deploy checklist

- [ ] `npm run build` succeeds
- [ ] `npm start` serves UI + `/health` on one host (or split with `VITE_API_URL`)
- [ ] HTTPS enabled (camera)
- [ ] `server/.env` on the API host with secrets
- [ ] `GET /health` → `stems.ok` true (GPU or Replicate configured)
- [ ] Test stem separation end-to-end (can take up to 4 minutes on Replicate)
- [ ] Anthropic key tested or accept offline catalog fallback

---

## What we cannot ship in the repo

- **Copyrighted audio** — the app includes **recommended pair metadata** only; users load their own files
- **API keys** — stay in `server/.env` (gitignored)

Optional: add personal test files under `public/demo/` (gitignored) — see `public/demo/README.md`.

---

## Future improvements (not implemented yet)

- Docker image with Node + CUDA Python for one-command GPU deploy
- Persistent stem job queue (Redis + worker)
- Job TTL / disk cleanup
- `VITE_API_URL` runtime config without rebuild

For questions about stem setup locally, see [STEMS_SETUP.md](STEMS_SETUP.md).
