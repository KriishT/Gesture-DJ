import fs from "node:fs/promises";
import path from "node:path";
import type { StemJobStatus, StemName } from "./stemJobs.js";
import { STEM_NAMES } from "./stemJobs.js";

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
const REPLICATE_VERSION = process.env.REPLICATE_DEMUX_VERSION;

export function cloudStemsConfigured(): boolean {
  return Boolean(REPLICATE_TOKEN && REPLICATE_VERSION);
}

async function writeStatus(statusPath: string, status: StemJobStatus): Promise<void> {
  await fs.writeFile(statusPath, JSON.stringify(status));
}

async function uploadFile(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  const form = new FormData();
  form.append("content", new Blob([buf]), path.basename(filePath));

  const res = await fetch("https://api.replicate.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Replicate file upload failed: ${res.status}`);
  const data = (await res.json()) as { urls: { get: string } };
  return data.urls.get;
}

async function createPrediction(audioUrl: string): Promise<string> {
  if (!REPLICATE_VERSION) {
    throw new Error("REPLICATE_DEMUX_VERSION not set — see docs/STEMS_SETUP.md");
  }
  const res = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REPLICATE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: REPLICATE_VERSION,
      input: { audio: audioUrl },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Replicate prediction failed: ${res.status} ${err.slice(0, 240)}`);
  }
  const data = (await res.json()) as { urls: { get: string } };
  return data.urls.get;
}

async function pollPrediction(
  url: string,
  onProgress: (p: number) => void,
): Promise<Record<string, string>> {
  const start = Date.now();
  while (Date.now() - start < 180_000) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` } });
    const data = (await res.json()) as {
      status: string;
      output?: Record<string, string> | string;
      error?: string;
    };
    if (data.status === "succeeded") {
      if (typeof data.output === "string") return { other: data.output };
      return (data.output ?? {}) as Record<string, string>;
    }
    if (data.status === "failed" || data.status === "canceled") {
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
  await writeStatus(statusPath, { phase: "loading", progress: 0.05, gpu: "Replicate cloud" });
  await fs.mkdir(outDir, { recursive: true });

  const audioUrl = await uploadFile(inputPath);
  await writeStatus(statusPath, { phase: "separating", progress: 0.12, gpu: "Replicate cloud" });

  const pollUrl = await createPrediction(audioUrl);
  const output = await pollPrediction(pollUrl, async (p) => {
    await writeStatus(statusPath, {
      phase: "separating",
      progress: p,
      gpu: "Replicate cloud",
      elapsedSec: (Date.now() - t0) / 1000,
    });
  });

  await writeStatus(statusPath, { phase: "writing", progress: 0.92, gpu: "Replicate cloud" });

  const written: string[] = [];
  for (const stem of STEM_NAMES) {
    const url = mapStemUrl(output, stem);
    if (url) {
      await downloadToFile(url, path.join(outDir, `${stem}.wav`));
      written.push(stem);
    }
  }

  if (written.length < 3) {
    throw new Error("Cloud separation returned too few stems — check REPLICATE_DEMUX_VERSION");
  }

  await writeStatus(statusPath, {
    phase: "done",
    progress: 1,
    gpu: "Replicate cloud",
    stems: written,
    elapsedSec: (Date.now() - t0) / 1000,
  });
}
