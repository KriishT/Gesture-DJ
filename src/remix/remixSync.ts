import type { BeatGrid } from "../audio/beatAlign";
import { beatIndexAt, computeStemSyncRatio } from "../audio/beatAlign";

export { computeStemSyncRatio };

/** Snap to the downbeat at the start of the 4-beat bar containing `position`. */
export function snapToBarDownbeat(position: number, bpm: number, offset = 0): number {
  if (!bpm || bpm <= 0) return Math.max(0, position);
  const spb = 60 / bpm;
  const beat = Math.floor((position - offset) / spb + 1e-6);
  const barBeat = Math.floor(beat / 4) * 4;
  return Math.max(0, offset + barBeat * spb);
}

/** Phase alignment error in ms (0 = locked). */
export function remixPhaseErrorMs(
  master: BeatGrid,
  slavePos: number,
  slaveBpm: number,
  slaveOff: number,
): number {
  if (!master.bpm || !slaveBpm) return 999;
  const mIdx = beatIndexAt(master);
  const sIdx = beatIndexAt({ position: slavePos, bpm: slaveBpm, offset: slaveOff });
  const mPhase = ((Math.round(mIdx) % 4) + 4) % 4;
  const sPhase = ((Math.round(sIdx) % 4) + 4) % 4;
  if (mPhase !== sPhase) return 400;

  const mFrac = mIdx - Math.floor(mIdx);
  const sFrac = sIdx - Math.floor(sIdx);
  let errBeats = Math.abs(mFrac - sFrac);
  if (errBeats > 0.5) errBeats = 1 - errBeats;
  return errBeats * (60000 / master.bpm);
}

/**
 * Layer file position locked to master's beat phase, preferring `nearSec`
 * (e.g. a vocal section start).
 */
export function lockLayerPosition(
  master: BeatGrid,
  nearSec: number,
  layerBpm: number,
  layerOff: number,
): number {
  if (!master.bpm || !layerBpm || master.bpm <= 0 || layerBpm <= 0) {
    return Math.max(0, nearSec);
  }

  const spb = 60 / layerBpm;
  const masterBeat = beatIndexAt(master);
  const masterRounded = Math.round(masterBeat);
  const masterPhase = ((masterRounded % 4) + 4) % 4;
  const hintBeat = Math.round(beatIndexAt({ position: nearSec, bpm: layerBpm, offset: layerOff }));

  let bestPos = Math.max(0, nearSec);
  let bestScore = -Infinity;

  for (let beat = hintBeat - 48; beat <= hintBeat + 48; beat++) {
    const phase = ((beat % 4) + 4) % 4;
    if (phase !== masterPhase) continue;
    const pos = layerOff + beat * spb;
    if (pos < 0) continue;
    const dist = Math.abs(pos - nearSec);
    if (dist > 16 * spb) continue;
    const barStart = beat % 4 === 0 ? 0.12 : 0;
    const score = -dist + barStart;
    if (score > bestScore) {
      bestScore = score;
      bestPos = pos;
    }
  }
  return bestPos;
}

/** Layer start position so it reaches `layerAtSwap` when bed reaches `bedCueAtSwap`. */
export function layerPrerollPosition(
  bedPosNow: number,
  bedCueAtSwap: number,
  layerAtSwap: number,
  syncRatio: number,
): number {
  const bedRemaining = Math.max(0, bedCueAtSwap - bedPosNow);
  return Math.max(0, layerAtSwap - bedRemaining * syncRatio);
}

export function effectiveLayerBpm(nativeBpm: number, syncRatio: number): number {
  return nativeBpm * syncRatio;
}

export function formatSyncRatio(ratio: number): string {
  if (Math.abs(ratio - 1) < 0.005) return "1.00× (locked)";
  return `${ratio.toFixed(2)}× → bed BPM`;
}
