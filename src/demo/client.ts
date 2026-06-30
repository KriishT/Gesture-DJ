import { apiUrl } from "../config/apiBase";
import type { DemoPairFiles } from "./types";

export type { DemoPairFiles };

export async function fetchDemoPairs(): Promise<DemoPairFiles[]> {
  try {
    const res = await fetch(apiUrl("/api/demo/pairs"));
    if (!res.ok) return [];
    const data = (await res.json()) as { pairs?: DemoPairFiles[] };
    return data.pairs ?? [];
  } catch {
    return [];
  }
}

/** Load a demo pair by folder id (matches curated pair ids, e.g. house-classics). */
export async function loadDemoPairById(
  pairId: string,
): Promise<{ demo: DemoPairFiles; fileA: File; fileB: File } | null> {
  const pairs = await fetchDemoPairs();
  const demo = pairs.find((p) => p.id === pairId);
  if (!demo) return null;
  const [fileA, fileB] = await Promise.all([
    fileFromDemoUrl(demo.deckA.url, demo.deckA.fileName),
    fileFromDemoUrl(demo.deckB.url, demo.deckB.fileName),
  ]);
  return { demo, fileA, fileB };
}

/** Fetch a demo URL and wrap as a File for the normal load pipeline. */
export async function fileFromDemoUrl(url: string, fileName: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${fileName} (${res.status})`);
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/html")) {
    throw new Error(
      `Could not load ${fileName} — got HTML instead of audio. Try renaming to a.mp3 / b.mp3.`,
    );
  }
  const blob = await res.blob();
  if (blob.size < 4096 && !ct.includes("audio")) {
    throw new Error(
      `Could not load ${fileName} — file looks empty or missing (${blob.size} bytes).`,
    );
  }
  const type = blob.type && blob.type !== "application/octet-stream" ? blob.type : guessMime(fileName);
  return new File([blob], fileName, { type });
}

function guessMime(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "flac":
      return "audio/flac";
    case "ogg":
      return "audio/ogg";
    case "m4a":
      return "audio/mp4";
    default:
      return "application/octet-stream";
  }
}
