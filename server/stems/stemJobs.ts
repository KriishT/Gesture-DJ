import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { cloudStemsConfigured, runCloudSeparation } from "./cloudStems.js";

export const STEM_NAMES = ["drums", "bass", "other", "vocals", "guitar", "piano"] as const;
export type StemName = (typeof STEM_NAMES)[number];
export type StemBackendMode = "auto" | "local" | "cloud";

export interface StemJobStatus {
  phase: "queued" | "loading" | "separating" | "writing" | "done" | "error";
  progress: number;
  elapsedSec?: number;
  /** Human label: GPU name or "Replicate cloud". */
  gpu?: string;
  /** Which engine is running this job. */
  engine?: "local" | "cloud";
  stems?: string[];
  durationSec?: number;
  error?: string;
}

export interface StemJob {
  id: string;
  fileName: string;
  status: StemJobStatus;
  dir: string;
  createdAt: number;
  backend: StemBackendMode;
}

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const WORK_DIR = path.join(serverDir, ".stem-jobs");
const PYTHON = process.env.STEM_PYTHON ?? "python";
const SCRIPT = path.join(serverDir, "separate.py");

/** When true, skip local CUDA and always use Replicate (if configured). */
function stemsCloudOnly(): boolean {
  const v = process.env.STEMS_CLOUD_ONLY?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

const jobs = new Map<string, StemJob>();

async function ensureWorkDir(): Promise<void> {
  await fs.mkdir(WORK_DIR, { recursive: true });
}

export async function createStemJob(
  fileName: string,
  audioBuffer: Buffer,
  backend: StemBackendMode = "auto",
): Promise<StemJob> {
  await ensureWorkDir();
  const id = crypto.randomUUID();
  const dir = path.join(WORK_DIR, id);
  await fs.mkdir(dir, { recursive: true });

  const inputPath = path.join(dir, "input" + (path.extname(fileName) || ".wav"));
  const statusPath = path.join(dir, "status.json");
  const outDir = path.join(dir, "stems");

  await fs.writeFile(inputPath, audioBuffer);
  await fs.writeFile(
    statusPath,
    JSON.stringify({ phase: "queued", progress: 0 } satisfies StemJobStatus),
  );

  const job: StemJob = {
    id,
    fileName,
    dir,
    createdAt: Date.now(),
    status: { phase: "queued", progress: 0 },
    backend,
  };
  jobs.set(id, job);

  void startSeparation(job, inputPath, outDir, statusPath, backend);

  return job;
}

async function startSeparation(
  job: StemJob,
  inputPath: string,
  outDir: string,
  statusPath: string,
  backend: StemBackendMode,
): Promise<void> {
  const mode: StemBackendMode = stemsCloudOnly() ? "cloud" : backend;

  if (mode === "cloud") {
    if (cloudStemsConfigured()) {
      console.log(`[stems:${job.id}] cloud → Replicate`);
      startCloudJob(job, statusPath, inputPath, outDir);
      return;
    }
    job.status = {
      phase: "error",
      progress: 0,
      error: "Replicate not configured (REPLICATE_API_TOKEN + REPLICATE_DEMUX_VERSION)",
    };
    await fs.writeFile(statusPath, JSON.stringify(job.status));
    return;
  }

  if (mode === "local") {
    const local = await probeLocalCuda();
    if (local.ok) {
      console.log(`[stems:${job.id}] local GPU (${local.gpuName ?? "CUDA"})`);
      startLocalJob(job, inputPath, outDir, statusPath);
      return;
    }
    job.status = { phase: "error", progress: 0, error: local.message };
    await fs.writeFile(statusPath, JSON.stringify(job.status));
    return;
  }

  // auto — local GPU first; Replicate only when no GPU is available on this host
  const local = await probeLocalCuda();
  if (local.ok) {
    console.log(`[stems:${job.id}] auto → local GPU (${local.gpuName ?? "CUDA"})`);
    startLocalJob(job, inputPath, outDir, statusPath);
    return;
  }
  if (cloudStemsConfigured()) {
    console.log(`[stems:${job.id}] auto → Replicate (no local GPU: ${local.message})`);
    startCloudJob(job, statusPath, inputPath, outDir);
    return;
  }
  job.status = {
    phase: "error",
    progress: 0,
    error: local.message,
  };
  await fs.writeFile(statusPath, JSON.stringify(job.status));
}

function startCloudJob(job: StemJob, statusPath: string, inputPath: string, outDir: string): void {
  const poll = setInterval(async () => {
    try {
      const raw = await fs.readFile(statusPath, "utf8");
      job.status = JSON.parse(raw) as StemJobStatus;
      if (job.status.phase === "done" || job.status.phase === "error") clearInterval(poll);
    } catch {
      /* pending */
    }
  }, 500);

  runCloudSeparation(inputPath, outDir, statusPath).catch(async (err) => {
    clearInterval(poll);
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[stems:cloud:${job.id}]`, message);
    job.status = {
      phase: "error",
      progress: 0,
      error: message,
    };
    await fs.writeFile(statusPath, JSON.stringify(job.status)).catch(() => {});
  });
}

function startLocalJob(
  job: StemJob,
  inputPath: string,
  outDir: string,
  statusPath: string,
): void {
  void fs.writeFile(
    statusPath,
    JSON.stringify({ phase: "loading", progress: 0.02, engine: "local" } satisfies StemJobStatus),
  );

  const child = spawn(PYTHON, [SCRIPT, inputPath, outDir, statusPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const poll = setInterval(async () => {
    try {
      const raw = await fs.readFile(statusPath, "utf8");
      const parsed = JSON.parse(raw) as StemJobStatus;
      job.status = { ...parsed, engine: "local" };
      if (parsed.phase === "done" || parsed.phase === "error") {
        clearInterval(poll);
      }
    } catch {
      /* status file not ready yet */
    }
  }, 400);

  child.on("close", async (code) => {
    clearInterval(poll);
    try {
      const raw = await fs.readFile(statusPath, "utf8");
      const parsed = JSON.parse(raw) as StemJobStatus;
      job.status = { ...parsed, engine: "local" };
      if (parsed.phase === "error" || (code !== 0 && code !== null)) {
        const detail = parsed.error ?? `Stem process exited with code ${code}`;
        const hint =
          job.backend === "auto" && cloudStemsConfigured()
            ? " Use “Retry via Replicate” on the deck to run in the cloud."
            : "";
        console.error(`[stems:${job.id}] local GPU failed: ${detail}`);
        job.status = {
          phase: "error",
          progress: 0,
          engine: "local",
          error: `Local GPU failed: ${detail}${hint}`,
        };
        await fs.writeFile(statusPath, JSON.stringify(job.status));
      }
    } catch {
      if (code !== 0) {
        job.status = {
          phase: "error",
          progress: 0,
          engine: "local",
          error: `Stem process exited with code ${code}. Is Python + demucs installed?`,
        };
      }
    }
  });

  child.stderr?.on("data", (d) => {
    console.error(`[stems:${job.id}]`, d.toString().trim());
  });
}

export function getStemJob(id: string): StemJob | undefined {
  return jobs.get(id);
}

export async function readStemFile(jobId: string, stem: StemName): Promise<Buffer | null> {
  const job = jobs.get(jobId);
  if (!job || job.status.phase !== "done") return null;
  const filePath = path.join(job.dir, "stems", `${stem}.wav`);
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

const PROBE_SCRIPT = [
  "import torch",
  "import demucs",
  "if not torch.cuda.is_available():",
  "    print('nocuda')",
  "else:",
  "    print('cuda')",
  "    print(torch.cuda.get_device_name(0))",
].join("\n");

/** Quick check whether local CUDA Demucs is available (ignores cloud-only mode). */
async function probeLocalCuda(): Promise<{
  ok: boolean;
  python: string;
  message: string;
  gpuName?: string;
}> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, ["-c", PROBE_SCRIPT], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.stderr?.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => {
      if (code !== 0) {
        const detail = err.trim().split("\n").pop() ?? "import failed";
        resolve({
          ok: false,
          python: PYTHON,
          message: `Python GPU stack not ready (${detail}). Run: pip install -r server/stems/requirements.txt`,
        });
        return;
      }
      const lines = out
        .trim()
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const hasCuda = lines[0] === "cuda";
      if (hasCuda) {
        const gpuName = lines[1]?.trim() || "NVIDIA GPU";
        resolve({
          ok: true,
          python: PYTHON,
          gpuName,
          message: `Local GPU ready: ${gpuName} (~5–15s per track)`,
        });
        return;
      }
      resolve({
        ok: false,
        python: PYTHON,
        message: "CUDA GPU not found on this machine",
      });
    });
  });
}

/** Quick check whether stem separation can run (health endpoint). */
export async function probeStemBackend(): Promise<{
  ok: boolean;
  python: string;
  message: string;
  localGpu: boolean;
  cloud: boolean;
  serverCloudOnly: boolean;
}> {
  const serverCloudOnly = stemsCloudOnly();
  const cloud = cloudStemsConfigured();
  const local = await probeLocalCuda();

  if (serverCloudOnly) {
    return {
      ok: cloud,
      python: PYTHON,
      message: cloud
        ? "Cloud stems only (server setting) — Replicate API"
        : "STEMS_CLOUD_ONLY=1 but Replicate is not configured",
      localGpu: local.ok,
      cloud,
      serverCloudOnly: true,
    };
  }

  if (local.ok) {
    return {
      ok: true,
      python: PYTHON,
      message: `${local.message}. Replicate is fallback only when no GPU is available.`,
      localGpu: true,
      cloud,
      serverCloudOnly: false,
    };
  }
  if (cloud) {
    return {
      ok: true,
      python: PYTHON,
      message: "No local GPU — using Replicate cloud stems (~10–60s, ~$0.14/track).",
      localGpu: false,
      cloud: true,
      serverCloudOnly: false,
    };
  }
  return {
    ok: false,
    python: PYTHON,
    message:
      "CUDA GPU not found — set REPLICATE_API_TOKEN for cloud stems, or install CUDA PyTorch",
    localGpu: false,
    cloud: false,
    serverCloudOnly: false,
  };
}
