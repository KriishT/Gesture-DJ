export const STEM_NAMES = ["drums", "bass", "other", "vocals", "guitar", "piano"] as const;
export type StemName = (typeof STEM_NAMES)[number];

export type StemStatus = "idle" | "processing" | "ready" | "error" | "unavailable";

export interface StemJobStatus {
  phase: string;
  progress: number;
  elapsedSec?: number;
  gpu?: string;
  error?: string;
}

export interface StemSeparateResult {
  stems: Partial<Record<StemName, ArrayBuffer>>;
  elapsedSec: number;
  gpu?: string;
}

/** Poll until the stem job finishes or times out. */
async function waitForJob(jobId: string, timeoutMs = 120_000): Promise<StemJobStatus> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`/api/stems/${jobId}`);
    if (!res.ok) throw new Error(`stem status ${res.status}`);
    const data = (await res.json()) as { status: StemJobStatus };
    const st = data.status;
    if (st.phase === "done") return st;
    if (st.phase === "error") throw new Error(st.error ?? "Stem separation failed");
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Stem separation timed out");
}

/**
 * Upload a track for GPU stem separation (HTDemucs 6-stem).
 * Target ~5-15s on an NVIDIA GPU via the local Python backend.
 */
export async function separateStems(
  file: File,
  onProgress?: (status: StemJobStatus) => void,
): Promise<StemSeparateResult> {
  const form = new FormData();
  form.append("audio", file);

  const res = await fetch("/api/stems", { method: "POST", body: form });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `stem upload ${res.status}`);
  }

  const { jobId } = (await res.json()) as { jobId: string };
  const final = await waitForJob(jobId, 120_000);
  onProgress?.(final);

  const stems: Partial<Record<StemName, ArrayBuffer>> = {};
  await Promise.all(
    STEM_NAMES.map(async (name) => {
      const r = await fetch(`/api/stems/${jobId}/${name}`);
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

/** Check whether the GPU stem backend is available. */
export async function probeStemsBackend(): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const res = await fetch("/health");
    if (!res.ok) return { ok: false, message: "API offline" };
    const data = (await res.json()) as { stems?: { ok: boolean; message: string } };
    return data.stems ?? { ok: false, message: "Stem backend unknown" };
  } catch {
    return { ok: false, message: "Cannot reach API" };
  }
}
