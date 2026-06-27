import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { cloudStemsConfigured, runCloudSeparation } from "./cloudStems.js";

export const STEM_NAMES = ["drums", "bass", "other", "vocals", "guitar", "piano"] as const;
export type StemName = (typeof STEM_NAMES)[number];

export interface StemJobStatus {
  phase: "queued" | "loading" | "separating" | "writing" | "done" | "error";
  progress: number;
  elapsedSec?: number;
  gpu?: string;
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
}

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const WORK_DIR = path.join(serverDir, ".stem-jobs");
const PYTHON = process.env.STEM_PYTHON ?? "python";
const SCRIPT = path.join(serverDir, "separate.py");

const jobs = new Map<string, StemJob>();

async function ensureWorkDir(): Promise<void> {
  await fs.mkdir(WORK_DIR, { recursive: true });
}

export async function createStemJob(
  fileName: string,
  audioBuffer: Buffer,
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
  };
  jobs.set(id, job);

  void startSeparation(job, inputPath, outDir, statusPath);

  return job;
}

async function startSeparation(
  job: StemJob,
  inputPath: string,
  outDir: string,
  statusPath: string,
): Promise<void> {
  const local = await probeStemBackend();
  if (local.ok) {
    startLocalJob(job, inputPath, outDir, statusPath);
    return;
  }
  if (cloudStemsConfigured()) {
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
    job.status = {
      phase: "error",
      progress: 0,
      error: err instanceof Error ? err.message : String(err),
    };
    await fs.writeFile(statusPath, JSON.stringify(job.status)).catch(() => {});
  });
}

function startLocalJob(job: StemJob, inputPath: string, outDir: string, statusPath: string): void {
  const child = spawn(PYTHON, [SCRIPT, inputPath, outDir, statusPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const poll = setInterval(async () => {
    try {
      const raw = await fs.readFile(statusPath, "utf8");
      const parsed = JSON.parse(raw) as StemJobStatus;
      job.status = parsed;
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
      job.status = JSON.parse(raw) as StemJobStatus;
    } catch {
      if (code !== 0) {
        job.status = {
          phase: "error",
          progress: 0,
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

/** Quick check whether the GPU stem stack is likely available. */
export async function probeStemBackend(): Promise<{
  ok: boolean;
  python: string;
  message: string;
}> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, ["-c", "import torch; print('cuda' if torch.cuda.is_available() else 'nocuda')"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          python: PYTHON,
          message: "Python/torch not installed. Run: pip install -r server/stems/requirements.txt",
        });
        return;
      }
      const hasCuda = out.trim() === "cuda";
      if (hasCuda) {
        resolve({
          ok: true,
          python: PYTHON,
          message: "GPU stem separation ready (~5-15s per track)",
        });
        return;
      }
      if (cloudStemsConfigured()) {
        resolve({
          ok: true,
          python: PYTHON,
          message: "Cloud stem fallback ready (Replicate API)",
        });
        return;
      }
      resolve({
        ok: false,
        python: PYTHON,
        message:
          "CUDA GPU not found — set REPLICATE_API_TOKEN for cloud stems, or install CUDA PyTorch",
      });
    });
  });
}
