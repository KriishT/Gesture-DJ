import { analyze, guess } from "web-audio-beat-detector";

export interface BeatInfo {
  bpm: number;
  /** Time (s) of the first detected beat, used to anchor the beat grid. */
  offset: number;
}

/**
 * Detect BPM and the first-beat offset for an AudioBuffer.
 * Falls back gracefully so the app never hard-fails on weird audio.
 */
export async function detectBeat(buffer: AudioBuffer): Promise<BeatInfo> {
  try {
    const { bpm, offset } = await guess(buffer);
    if (bpm && isFinite(bpm)) return { bpm: round1(bpm), offset: offset ?? 0 };
  } catch {
    /* fall through */
  }
  try {
    const bpm = await analyze(buffer);
    if (bpm && isFinite(bpm)) return { bpm: round1(bpm), offset: 0 };
  } catch {
    /* fall through */
  }
  return { bpm: 120, offset: 0 };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
