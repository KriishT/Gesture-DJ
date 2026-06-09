import { clamp } from "./audioMath";

/** Beyond this deviation from 1.0, time-stretch sounds noticeably warped. */
export const BEATMATCH_TOLERANCE = 0.035;

/**
 * Compute playback rate to match `sourceBpm` to `targetBpm`, folding by octaves
 * so the ratio stays in a musically sensible 0.5–2× window.
 */
export function computeSyncRatio(targetBpm: number, sourceBpm: number): number {
  if (!targetBpm || !sourceBpm || targetBpm <= 0 || sourceBpm <= 0) return 1;
  let ratio = targetBpm / sourceBpm;
  while (ratio > 2) ratio /= 2;
  while (ratio < 0.5) ratio *= 2;
  return clamp(ratio, 0.5, 2);
}

/** True when pitch-locked sync is subtle enough to sound natural. */
export function shouldBeatmatch(ratio: number): boolean {
  return Math.abs(ratio - 1) <= BEATMATCH_TOLERANCE;
}

/**
 * Ratio used during standard (non-stem) co-pilot transitions. Large BPM gaps
 * play at native tempo. Stem moves use computeStemSyncRatio instead.
 */
export function computeTransitionSyncRatio(targetBpm: number, sourceBpm: number): number {
  const ratio = computeSyncRatio(targetBpm, sourceBpm);
  return shouldBeatmatch(ratio) ? ratio : 1;
}
