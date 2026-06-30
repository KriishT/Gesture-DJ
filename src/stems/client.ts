import { apiUrl } from "../config/apiBase";
import type { StemBackendInfo, StemBackendMode } from "./types";

export type { StemBackendInfo, StemBackendMode } from "./types";

export const STEM_NAMES = ["drums", "bass", "other", "vocals", "guitar", "piano"] as const;
export type StemName = (typeof STEM_NAMES)[number];

export type StemStatus = "idle" | "processing" | "ready" | "error" | "unavailable";

export interface StemJobStatus {
  phase: string;
  progress: number;
  elapsedSec?: number;
  gpu?: string;
  engine?: "local" | "cloud";
  error?: string;
}

export interface StemSeparateResult {
  stems: Partial<Record<StemName, ArrayBuffer>>;
  elapsedSec: number;
  gpu?: string;
}

const STEM_MODE_KEY = "gesture-dj-stem-backend";

export function loadStemBackendMode(): StemBackendMode {
  try {
    const v = localStorage.getItem(STEM_MODE_KEY);
    if (v === "local" || v === "cloud" || v === "auto") return v;
  } catch {
    /* private mode */
  }
  return "auto";
}

export function saveStemBackendMode(mode: StemBackendMode): void {
  try {
    localStorage.setItem(STEM_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

/** Poll until the stem job finishes or times out (cloud jobs can take several minutes). */
async function waitForJob(
  jobId: string,
  onProgress?: (status: StemJobStatus) => void,
  timeoutMs = 240_000,
): Promise<StemJobStatus> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(apiUrl(`/api/stems/${jobId}`));
    if (!res.ok) throw new Error(`stem status ${res.status}`);
    const data = (await res.json()) as { status: StemJobStatus };
    const st = data.status;
    onProgress?.(st);
    if (st.phase === "done") return st;
    if (st.phase === "error") throw new Error(st.error ?? "Stem separation failed");
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Stem separation timed out");
}

/**
 * Upload a track for 6-stem separation.
 * Backend: auto (GPU first, Replicate fallback), local, or cloud.
 */
export async function separateStems(
  file: File,
  backend: StemBackendMode,
  onProgress?: (status: StemJobStatus) => void,
): Promise<StemSeparateResult> {
  const form = new FormData();
  form.append("audio", file);
  form.append("backend", backend);

  const res = await fetch(apiUrl("/api/stems"), { method: "POST", body: form });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `stem upload ${res.status}`);
  }

  const { jobId } = (await res.json()) as { jobId: string };
  const final = await waitForJob(jobId, onProgress, 240_000);

  const stems: Partial<Record<StemName, ArrayBuffer>> = {};
  await Promise.all(
    STEM_NAMES.map(async (name) => {
      const r = await fetch(apiUrl(`/api/stems/${jobId}/${name}`));
      if (r.ok) stems[name] = await r.arrayBuffer();
    }),
  );

  if (Object.keys(stems).length < 4) {
    throw new Error("Incomplete stem output from server");
  }

  return {
    stems,
    elapsedSec: final.elapsedSec ?? 0,
    gpu: final.gpu,
  };
}

/** Probe stem backends available on the API host. */
export async function probeStemsBackend(): Promise<StemBackendInfo> {
  try {
    const res = await fetch(apiUrl("/health"));
    if (!res.ok) return { ok: false, message: "API offline", localGpu: false, cloud: false, serverCloudOnly: false };
    const data = (await res.json()) as {
      stems?: {
        ok: boolean;
        message: string;
        localGpu?: boolean;
        cloud?: boolean;
        serverCloudOnly?: boolean;
      };
    };
    const s = data.stems;
    if (!s) return { ok: false, message: "Stem backend unknown", localGpu: false, cloud: false, serverCloudOnly: false };
    return {
      ok: s.ok,
      message: s.message,
      localGpu: Boolean(s.localGpu),
      cloud: Boolean(s.cloud),
      serverCloudOnly: Boolean(s.serverCloudOnly),
    };
  } catch {
    return { ok: false, message: "Cannot reach API", localGpu: false, cloud: false, serverCloudOnly: false };
  }
}
