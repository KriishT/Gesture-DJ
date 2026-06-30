import fs from "node:fs/promises";
import path from "node:path";
import type { StemJobStatus, StemName } from "./stemJobs.js";
import { STEM_NAMES } from "./stemJobs.js";

/** Read at call time — dotenv loads after module graph in index.ts. */
function replicateEnv() {
  return {
    token: process.env.REPLICATE_API_TOKEN,
    version: process.env.REPLICATE_DEMUX_VERSION,
    model: process.env.REPLICATE_DEMUX_MODEL ?? "htdemucs_6s",
  };
}

export function cloudStemsConfigured(): boolean {
  const { token, version } = replicateEnv();
  return Boolean(token && version);
}

async function writeStatus(statusPath: string, status: StemJobStatus): Promise<void> {
  await fs.writeFile(statusPath, JSON.stringify(status));
}

function logStems(msg: string, extra?: unknown): void {
  console.log(`[stems:replicate] ${msg}`, extra ?? "");
}

function normalizeStemOutput(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const flat: Record<string, string> = {};

  for (const [key, val] of Object.entries(o)) {
    if (key === "stems" && Array.isArray(val)) continue;
    if (typeof val === "string" && val.startsWith("http")) flat[key.toLowerCase()] = val;
  }
  if (Object.keys(flat).length >= 3) return flat;

  const stems = o.stems;
  if (Array.isArray(stems)) {
    for (const item of stems) {
      if (!item || typeof item !== "object") continue;
      const row = item as { name?: string; audio?: string };
      if (row.name && row.audio) flat[row.name.toLowerCase()] = row.audio;
    }
  }
  return flat;
}

async function uploadFile(filePath: string): Promise<string> {
  const { token } = replicateEnv();
  const buf = await fs.readFile(filePath);
  const form = new FormData();
  form.append("content", new Blob([buf]), path.basename(filePath));

  const res = await fetch("https://api.replicate.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.text();
    logStems(`file upload failed ${res.status}`, err.slice(0, 300));
    throw new Error(`Replicate file upload failed: ${res.status}`);
  }
  const data = (await res.json()) as { urls: { get: string } };
  logStems("file uploaded");
  return data.urls.get;
}

async function createPrediction(audioUrl: string): Promise<string> {
  const { token, version, model } = replicateEnv();
  if (!version) {
    throw new Error("REPLICATE_DEMUX_VERSION not set — see docs/STEMS_SETUP.md");
  }
  const res = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version,
      input: { audio: audioUrl, model },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    logStems(`prediction create failed ${res.status}`, err.slice(0, 300));
    throw new Error(`Replicate prediction failed: ${res.status} ${err.slice(0, 240)}`);
  }
  const data = (await res.json()) as { id?: string; urls: { get: string } };
  logStems("prediction created", data.id);
  return data.urls.get;
}

async function pollPrediction(
  url: string,
  onProgress: (p: number) => void,
): Promise<Record<string, string>> {
  const start = Date.now();
  while (Date.now() - start < 180_000) {
    const { token } = replicateEnv();
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = (await res.json()) as {
      status: string;
      output?: Record<string, string> | string;
      error?: string;
    };
    if (data.status === "succeeded") {
      const flat = normalizeStemOutput(data.output);
      logStems("prediction succeeded", Object.keys(flat).join(", "));
      return flat;
    }
    if (data.status === "failed" || data.status === "canceled") {
      logStems("prediction failed", data.error);
      throw new Error(data.error ?? "Cloud stem job failed");
    }
    onProgress(Math.min(0.88, 0.15 + (Date.now() - start) / 150_000));
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Cloud stem separation timed out");
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${url}`);
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

function mapStemUrl(output: Record<string, string>, stem: StemName): string | null {
  const aliases: Record<StemName, string[]> = {
    drums: ["drums", "drum"],
    bass: ["bass"],
    other: ["other", "no_vocals", "no-vocals", "instrumental", "accompaniment"],
    vocals: ["vocals", "vocal"],
    guitar: ["guitar"],
    piano: ["piano"],
  };
  for (const key of aliases[stem]) {
    if (output[key]) return output[key];
  }
  return null;
}

/** Run stem separation via Replicate (~10–60s, paid API). */
export async function runCloudSeparation(
  inputPath: string,
  outDir: string,
  statusPath: string,
): Promise<void> {
  if (!cloudStemsConfigured()) {
    throw new Error("Cloud stems not configured (REPLICATE_API_TOKEN + REPLICATE_DEMUX_VERSION)");
  }

  const t0 = Date.now();
  await writeStatus(statusPath, { phase: "loading", progress: 0.05, gpu: "Replicate cloud", engine: "cloud" });
  await fs.mkdir(outDir, { recursive: true });

  const audioUrl = await uploadFile(inputPath);
  await writeStatus(statusPath, { phase: "separating", progress: 0.12, gpu: "Replicate cloud", engine: "cloud" });

  const pollUrl = await createPrediction(audioUrl);
  const output = await pollPrediction(pollUrl, async (p) => {
    await writeStatus(statusPath, {
      phase: "separating",
      progress: p,
      gpu: "Replicate cloud",
      engine: "cloud",
      elapsedSec: (Date.now() - t0) / 1000,
    });
  });

  await writeStatus(statusPath, { phase: "writing", progress: 0.92, gpu: "Replicate cloud", engine: "cloud" });

  const written: string[] = [];
  for (const stem of STEM_NAMES) {
    const url = mapStemUrl(output, stem);
    if (url) {
      await downloadToFile(url, path.join(outDir, `${stem}.wav`));
      written.push(stem);
    }
  }

  if (written.length < 3) {
    logStems("too few stems written", { written, outputKeys: Object.keys(output) });
    throw new Error("Cloud separation returned too few stems — check REPLICATE_DEMUX_VERSION");
  }

  logStems("done", `${written.length} stems in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  await writeStatus(statusPath, {
    phase: "done",
    progress: 1,
    gpu: "Replicate cloud",
    engine: "cloud",
    stems: written,
    elapsedSec: (Date.now() - t0) / 1000,
  });
}
