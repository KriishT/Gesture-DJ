import "./loadEnv.js";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import { DJ_SYSTEM_PROMPT, summarizeTrack, type TrackSummaryInput } from "./djKnowledge";
import {
  createStemJob,
  getStemJob,
  probeStemBackend,
  readStemFile,
  STEM_NAMES,
  type StemBackendMode,
  type StemName,
} from "./stems/stemJobs";
import { demoRootDir, listDemoPairs } from "./demoPairs";

// Load server/.env regardless of the process working directory.
const serverDir = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 8787);
const MODEL = process.env.COPILOT_MODEL ?? "claude-haiku-4-5";
const MAX_TOKENS = Number(process.env.COPILOT_MAX_TOKENS ?? 3000);

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.warn(
    "[gesture-dj] ANTHROPIC_API_KEY is not set. The /api/copilot endpoint will return 503; the app will use its offline fallback brain.",
  );
}

const client = apiKey ? new Anthropic({ apiKey }) : null;

const corsOrigin = process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()).filter(Boolean);
const app = express();
app.use(cors(corsOrigin?.length ? { origin: corsOrigin } : undefined));
app.use(express.json({ limit: "1mb" }));

// Demo audio folders — served from public/demo (add files without rebuilding dist).
app.use("/demo", express.static(demoRootDir()));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 }, // 80 MB
});

app.get("/health", async (_req, res) => {
  const stems = await probeStemBackend();
  res.json({ ok: true, model: MODEL, aiEnabled: Boolean(client), stems });
});

app.get("/api/demo/pairs", async (_req, res) => {
  try {
    const pairs = await listDemoPairs();
    res.json({ pairs });
  } catch (err) {
    console.error("[gesture-dj] demo pairs error:", err);
    res.status(500).json({ error: "Could not scan demo folders" });
  }
});

interface CopilotBody {
  trackA: TrackSummaryInput;
  trackB: TrackSummaryInput;
  stemsA?: boolean;
  stemsB?: boolean;
}

app.post("/api/copilot", async (req, res) => {
  if (!client) {
    res.status(503).json({ error: "AI not configured" });
    return;
  }
  const { trackA, trackB, stemsA, stemsB } = req.body as CopilotBody;
  if (!trackA || !trackB) {
    res.status(400).json({ error: "trackA and trackB are required" });
    return;
  }

  const stemNote =
    stemsA && stemsB
      ? "Both tracks have GPU-separated stems (vocals, drums, bass, guitar, piano, other). Prefer stemPreset actions (acapella, instrumental, drums, bass, guitar, piano) for at least one suggestion — these sound best and hide BPM gaps without tempo warping."
      : stemsA || stemsB
        ? "Only one deck has stems ready; full stem moves need both."
        : "Stems are not available; avoid stemPreset actions.";

  const userContent = [
    "Design transitions from Song A into Song B for these tracks:",
    summarizeTrack("Song A (Deck A, currently playing)", trackA),
    summarizeTrack("Song B (Deck B, incoming)", trackB),
    stemNote,
    "Return ONLY the JSON described in your instructions.",
  ].join("\n");

  try {
    // Cache the large static system prompt to keep repeat calls cheap.
    // cache_control is sent through to the API; cast covers SDK type drift.
    const system = [
      {
        type: "text" as const,
        text: DJ_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" as const },
      },
    ] as unknown as Anthropic.MessageCreateParamsNonStreaming["system"];

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user", content: userContent }],
    });

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const parsed = extractJson(text);
    if (!parsed) {
      console.error(
        `[gesture-dj] parse failure (stop_reason=${message.stop_reason}, len=${text.length}):`,
        text.slice(0, 600),
      );
      res.status(502).json({
        error: "Could not parse AI response",
        stopReason: message.stop_reason,
      });
      return;
    }
    res.json(parsed);
  } catch (err) {
    const detail =
      err instanceof Anthropic.APIError
        ? `${err.status} ${err.name}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[gesture-dj] copilot error:", detail);
    res.status(502).json({ error: "AI request failed", detail });
  }
});

/** Start stem separation (local GPU, Replicate cloud, or auto). */
app.post("/api/stems", upload.single("audio"), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "audio file required (multipart field: audio)" });
    return;
  }
  const raw = (req.query.backend as string) ?? (req.body as { backend?: string })?.backend ?? "auto";
  const backend: StemBackendMode =
    raw === "local" || raw === "cloud" ? raw : "auto";
  try {
    const job = await createStemJob(file.originalname || "track.wav", file.buffer, backend);
    res.json({ jobId: job.id, status: job.status, backend: job.backend });
  } catch (err) {
    console.error("[gesture-dj] stem job error:", err);
    res.status(500).json({ error: "Failed to start stem separation" });
  }
});

app.get("/api/stems/:jobId", (req, res) => {
  const job = getStemJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({ jobId: job.id, fileName: job.fileName, status: job.status });
});

app.get("/api/stems/:jobId/:stem", async (req, res) => {
  const stem = req.params.stem as StemName;
  if (!STEM_NAMES.includes(stem)) {
    res.status(400).json({ error: "Invalid stem name" });
    return;
  }
  const buf = await readStemFile(req.params.jobId, stem);
  if (!buf) {
    res.status(404).json({ error: "Stem not ready" });
    return;
  }
  res.setHeader("Content-Type", "audio/wav");
  res.setHeader("Content-Disposition", `inline; filename="${stem}.wav"`);
  res.send(buf);
});

/** Pull the first valid JSON object out of a model response. */
function extractJson(text: string): unknown | null {
  let trimmed = text.trim();
  // Strip markdown code fences if present.
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fence) trimmed = fence[1].trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    /* try to locate a JSON object */
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

const distDir = path.join(serverDir, "..", "dist");
const serveStatic =
  process.env.SERVE_STATIC === "1" ||
  (process.env.NODE_ENV === "production" && fs.existsSync(distDir));

if (serveStatic) {
  app.use(express.static(distDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path === "/health") {
      next();
      return;
    }
    res.sendFile(path.join(distDir, "index.html"), (err) => {
      if (err) next(err);
    });
  });
  console.log(`[gesture-dj] Serving static UI from ${distDir}`);
}

const server = app.listen(PORT, async () => {
  console.log(`[gesture-dj] API on http://localhost:${PORT} (model: ${MODEL})`);
  const stems = await probeStemBackend();
  if (stems.serverCloudOnly) {
    console.warn(
      "[gesture-dj] STEMS_CLOUD_ONLY is set — local GPU is disabled; all stem jobs use Replicate.",
    );
  } else if (stems.localGpu) {
    console.log(`[gesture-dj] Stem separation: ${stems.message}`);
  } else if (stems.cloud) {
    console.log(`[gesture-dj] Stem separation: no local GPU — Replicate fallback available`);
  }
});

function gracefulShutdown(signal: string): void {
  console.log(`[gesture-dj] ${signal} — closing API on :${PORT}`);
  server.close(() => {
    console.log("[gesture-dj] API closed");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 4000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
