import { analyze, guess } from "web-audio-beat-detector";

export interface BeatInfo {
  bpm: number;
  /** Time (s) of the first detected beat, used to anchor the beat grid. */
  offset: number;
}

const BEAT_DETECT_TIMEOUT_MS = 10_000;

async function detectBeatInner(buffer: AudioBuffer): Promise<BeatInfo> {
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

/**
 * Detect BPM and the first-beat offset for an AudioBuffer.
 * Falls back gracefully so the app never hard-fails on weird audio.
 * Times out so loading deck B is never blocked forever by deck A analysis.
 */
export async function detectBeat(buffer: AudioBuffer): Promise<BeatInfo> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      detectBeatInner(buffer),
      new Promise<BeatInfo>((resolve) => {
        timer = setTimeout(() => resolve({ bpm: 120, offset: 0 }), BEAT_DETECT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
