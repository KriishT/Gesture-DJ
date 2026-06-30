import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AUDIO_EXT = new Set([".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".webm"]);

export interface DemoPairFiles {
  /** Folder name under /demo/ */
  id: string;
  label: string;
  deckA: { fileName: string; url: string };
  deckB: { fileName: string; url: string };
}

const serverDir = path.dirname(fileURLToPath(import.meta.url));

/** Always read from public/demo (not dist) so you can drop files without rebuilding. */
export function demoRootDir(): string {
  return path.join(serverDir, "..", "public", "demo");
}

function isAudio(name: string): boolean {
  return AUDIO_EXT.has(path.extname(name).toLowerCase());
}

function deckSide(fileName: string): "A" | "B" | null {
  const stem = path.basename(fileName, path.extname(fileName)).toLowerCase().replace(/\s+/g, "-");
  if (/^(a|deck-a|deck_a|song-a|song_a|track-a|track_a)$/.test(stem)) return "A";
  if (/^(b|deck-b|deck_b|song-b|song_b|track-b|track_b)$/.test(stem)) return "B";
  if (/^0?1([-_].*)?$/.test(stem)) return "A";
  if (/^0?2([-_].*)?$/.test(stem)) return "B";
  return null;
}

async function readLabel(dir: string, folderId: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(dir, "meta.json"), "utf8");
    const meta = JSON.parse(raw) as { name?: string; label?: string };
    return meta.name ?? meta.label ?? folderId;
  } catch {
    return folderId.replace(/[-_]/g, " ");
  }
}

async function scanFolder(dir: string, folderId: string): Promise<DemoPairFiles | null> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const audio = entries
    .filter((e) => e.isFile() && isAudio(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (audio.length < 2) return null;

  let fileA: string | undefined;
  let fileB: string | undefined;

  for (const name of audio) {
    const side = deckSide(name);
    if (side === "A" && !fileA) fileA = name;
    if (side === "B" && !fileB) fileB = name;
  }

  if (!fileA || !fileB) {
    if (audio.length === 2) {
      [fileA, fileB] = audio;
    } else {
      return null;
    }
  }

  const label = await readLabel(dir, folderId);
  const base = `/demo/${encodeURIComponent(folderId)}`;

  return {
    id: folderId,
    label,
    deckA: { fileName: fileA, url: `${base}/${encodeURIComponent(fileA)}` },
    deckB: { fileName: fileB, url: `${base}/${encodeURIComponent(fileB)}` },
  };
}

/** Build a fetchable demo URL with every path segment encoded. */
export function demoFileUrl(folderId: string, fileName: string): string {
  return `/demo/${encodeURIComponent(folderId)}/${encodeURIComponent(fileName)}`;
}

/** List subfolders of public/demo that each contain two audio files. */
export async function listDemoPairs(): Promise<DemoPairFiles[]> {
  const root = demoRootDir();
  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const pairs: DemoPairFiles[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const pair = await scanFolder(path.join(root, entry.name), entry.name);
    if (pair) pairs.push(pair);
  }

  pairs.sort((a, b) => a.label.localeCompare(b.label));
  return pairs;
}
