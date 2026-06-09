import { clamp } from "./audioMath";
import { computeSyncRatio } from "./syncRatio";

export interface BeatGrid {
  position: number;
  offset: number;
  bpm: number;
}

export function beatIndexAt(grid: BeatGrid): number {
  if (!grid.bpm || grid.bpm <= 0) return 0;
  return (grid.position - grid.offset) / (60 / grid.bpm);
}

/** Snap to the nearest exact beat boundary (downbeat, phase = 0). */
export function snapToBeatGrid(position: number, bpm: number, offset = 0): number {
  if (!bpm || bpm <= 0) return Math.max(0, position);
  const spb = 60 / bpm;
  const beat = Math.round((position - offset) / spb);
  return Math.max(0, offset + beat * spb);
}

/** Snap to the previous downbeat (floor) — safer for cue-ins before a drop. */
export function snapToDownbeat(position: number, bpm: number, offset = 0): number {
  if (!bpm || bpm <= 0) return Math.max(0, position);
  const spb = 60 / bpm;
  const beat = Math.floor((position - offset) / spb + 1e-6);
  return Math.max(0, offset + beat * spb);
}

export function computeStemSyncRatio(masterBpm: number, slaveBpm: number): number {
  return computeSyncRatio(masterBpm, slaveBpm);
}

/**
 * Hard-lock `slave` to `master`'s beat grid: same beat-in-bar and exact
 * downbeat phase so vocals and drums land on the one.
 */
export function alignPositionToMasterBeat(master: BeatGrid, slave: BeatGrid): number {
  if (!master.bpm || !slave.bpm || master.bpm <= 0 || slave.bpm <= 0) {
    return Math.max(0, slave.position);
  }

  const spbS = 60 / slave.bpm;
  const masterBeat = beatIndexAt(master);
  const slaveBeat = beatIndexAt(slave);

  const masterInBar = ((Math.round(masterBeat) % 4) + 4) % 4;
  const slaveRounded = Math.round(slaveBeat);
  const slaveInBar = ((slaveRounded % 4) + 4) % 4;

  let barShift = masterInBar - slaveInBar;
  if (barShift > 2) barShift -= 4;
  if (barShift < -2) barShift += 4;

  const targetBeat = slaveRounded + barShift;
  const alignedPos = slave.offset + targetBeat * spbS;

  const candidates = [
    alignedPos,
    alignedPos - spbS,
    alignedPos + spbS,
    alignedPos - 4 * spbS,
    alignedPos + 4 * spbS,
  ];

  let best = slave.position;
  let bestDist = Infinity;
  for (const c of candidates) {
    if (c < 0) continue;
    const d = Math.abs(c - slave.position);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return clamp(best, 0, Number.POSITIVE_INFINITY);
}

export type StemPresetKind =
  | "full"
  | "acapella"
  | "instrumental"
  | "drums"
  | "bass"
  | "guitar"
  | "piano"
  | "noVocals";

export function rhythmMasterForStem(
  stemDeck: "A" | "B",
  preset: StemPresetKind,
): "A" | "B" | null {
  if (preset === "full") return null;
  if (preset === "acapella") return stemDeck === "A" ? "B" : "A";
  if (stemDeck === "B") return "A";
  if (preset === "noVocals") return "A";
  return null;
}

/** Cue points for double-drop: B's build runs under A, both hit the drop together. */
export function chooseDoubleDropCues(
  cueOutA: number,
  bpmA: number,
  offsetA: number,
  dropB: number,
  bpmB: number,
  offsetB: number,
  transitionBars: number,
): { cueOutA: number; cueInB: number } {
  const spbB = 60 / (bpmB || 120);
  const buildBeats = Math.max(12, Math.round(transitionBars * 4 * 0.82));
  let cueInB = Math.max(0, dropB - buildBeats * spbB);
  cueInB = snapToDownbeat(cueInB, bpmB, offsetB);
  const outA = snapToDownbeat(cueOutA, bpmA, offsetA);
  return { cueOutA: outA, cueInB };
}
