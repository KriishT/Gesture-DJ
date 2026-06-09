import type { SectionKind, TrackAnalysis } from "../copilot/recipeTypes";
import { computeStemSyncRatio, snapToDownbeat } from "../audio/beatAlign";
import { shouldBeatmatch } from "../audio/syncRatio";
import type { RemixDirection } from "./types";
import {
  lockLayerPosition,
  remixPhaseErrorMs,
  snapToBarDownbeat,
} from "./remixSync";

export interface RemixCuePlan {
  bedCue: number;
  layerCue: number;
  bedIntroCue: number;
  introBars: number;
  bedLabel: string;
  layerLabel: string;
  syncRatio: number;
  effectiveLayerBpm: number;
  direction: RemixDirection;
}

export interface RemixCueOptions {
  direction: RemixDirection;
  stemsBed?: boolean;
  stemsLayer?: boolean;
}

const INTRO_BARS_DEFAULT = 8;
const INTRO_BARS_SHORT = 6;

const BED_KIND_WEIGHT: Partial<Record<SectionKind, number>> = {
  drop: 1,
  build: 0.88,
  chorus: 0.7,
  verse: 0.52,
  intro: 0.3,
  breakdown: 0.25,
  outro: 0.1,
};

const LAYER_KIND_WEIGHT: Partial<Record<SectionKind, number>> = {
  chorus: 1,
  verse: 0.9,
  drop: 0.72,
  build: 0.55,
  intro: 0.35,
  breakdown: 0.25,
  outro: 0.12,
};

function inMainBody(t: number, duration: number): boolean {
  return t >= duration * 0.05 && t <= duration * 0.95;
}

function stretchScore(ratio: number): number {
  const dev = Math.abs(ratio - 1);
  if (shouldBeatmatch(ratio)) return 0.22;
  if (dev <= 0.08) return 0.14;
  if (dev <= 0.15) return 0.04;
  if (dev <= 0.25) return -0.08;
  return -0.24;
}

function alignmentScore(
  bedCue: number,
  layerCue: number,
  bed: TrackAnalysis,
  layer: TrackAnalysis,
): number {
  const errMs = remixPhaseErrorMs(
    { position: bedCue, bpm: bed.bpm, offset: bed.beatOffset },
    layerCue,
    layer.bpm,
    layer.beatOffset,
  );
  if (errMs >= 200) return -0.45;
  if (errMs <= 12) return 0.28;
  if (errMs <= 35) return 0.14;
  if (errMs <= 80) return 0.02;
  return -0.15;
}

type TrackSection = TrackAnalysis["sections"][number];

function sectionAt(time: number, track: TrackAnalysis): TrackSection | null {
  return track.sections.find((s) => time >= s.start && time < s.end) ?? null;
}

function layerSectionBonus(layerCue: number, layer: TrackAnalysis): number {
  const sec = sectionAt(layerCue, layer);
  if (!sec) return -0.08;
  const spb = 60 / (layer.bpm || 120);
  const dist = Math.abs(layerCue - sec.start);
  if (dist > spb * 1.5) return -0.1;
  if (sec.kind === "chorus") return 0.16;
  if (sec.kind === "verse") return 0.12;
  if (sec.kind === "drop") return 0.08;
  return 0;
}

function bedCandidates(
  bed: TrackAnalysis,
  opts: RemixCueOptions,
): { time: number; score: number; label: string }[] {
  const vocalHeavy = bed.vocalProbability > 0.42;
  const out: { time: number; score: number; label: string }[] = [];

  for (const drop of bed.drops) {
    if (!inMainBody(drop, bed.durationSec)) continue;
    out.push({ time: drop, score: 0.98, label: "drop" });
  }

  for (const s of bed.sections) {
    if (!inMainBody(s.start, bed.durationSec)) continue;
    let w = BED_KIND_WEIGHT[s.kind] ?? 0.38;
    if (s.kind === "chorus" && vocalHeavy && !opts.stemsBed) w *= 0.45;
    if (s.kind === "drop" || s.kind === "build") w += 0.08;
    if (opts.stemsBed && (s.kind === "drop" || s.kind === "build")) w += 0.06;
    if (w < 0.42) continue;
    out.push({
      time: s.start,
      score: w * (0.54 + s.energy * 0.46),
      label: s.kind,
    });
  }

  if (out.length === 0) {
    out.push({ time: Math.max(8, bed.durationSec * 0.3), score: 0.38, label: "groove" });
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 10);
}

function layerCandidates(
  layer: TrackAnalysis,
  direction: RemixDirection,
): { time: number; score: number; label: string }[] {
  const out: { time: number; score: number; label: string }[] = [];
  const vocalBoost = layer.vocalProbability > 0.28 ? 0.12 : 0;

  for (const s of layer.sections) {
    if (!inMainBody(s.start, layer.durationSec)) continue;
    if (s.kind === "breakdown" || s.kind === "outro" || s.kind === "intro") continue;
    let w = LAYER_KIND_WEIGHT[s.kind] ?? 0.3;
    if (direction === "aOnB" && s.kind === "verse") w += 0.08;
    if (direction === "bOnA" && s.kind === "chorus") w += 0.08;
    out.push({
      time: snapToDownbeat(s.start, layer.bpm, layer.beatOffset),
      score: w * (0.5 + s.energy * 0.5) + vocalBoost,
      label: s.kind,
    });
  }

  for (const drop of layer.drops) {
    if (!inMainBody(drop, layer.durationSec)) continue;
    if (layer.vocalProbability > 0.3) {
      out.push({
        time: snapToDownbeat(drop, layer.bpm, layer.beatOffset),
        score: 0.6,
        label: "hook",
      });
    }
  }

  if (out.length === 0) {
    out.push({
      time: snapToDownbeat(Math.max(0, layer.durationSec * 0.22), layer.bpm, layer.beatOffset),
      score: 0.34,
      label: "open",
    });
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 12);
}

function pickIntroCue(
  bedCue: number,
  bed: TrackAnalysis,
  direction: RemixDirection,
): { bedIntroCue: number; introBars: number } {
  const spb = 60 / (bed.bpm || 120);
  const barSec = 4 * spb;
  const targetBars = direction === "bOnA" ? INTRO_BARS_DEFAULT : INTRO_BARS_SHORT;
  let introBars = targetBars;
  let bedIntroCue = snapToBarDownbeat(bedCue - introBars * barSec, bed.bpm, bed.beatOffset);

  const introWindowStart = bedCue - (targetBars + 2) * barSec;
  const introWindowEnd = bedCue - barSec;

  const introSections = bed.sections
    .filter(
      (s) =>
        s.start >= introWindowStart &&
        s.start <= introWindowEnd &&
        ["chorus", "verse", "build"].includes(s.kind),
    )
    .sort((a, b) => {
      const kindScore = (k: SectionKind) =>
        k === "chorus" ? 3 : k === "verse" ? 2 : k === "build" ? 1 : 0;
      const d = kindScore(b.kind) - kindScore(a.kind);
      if (d !== 0) return d;
      return b.energy - a.energy;
    });

  if (introSections.length > 0) {
    const snapped = snapToBarDownbeat(introSections[0].start, bed.bpm, bed.beatOffset);
    if (snapped < bedCue - barSec) {
      bedIntroCue = snapped;
      introBars = Math.max(2, Math.round((bedCue - bedIntroCue) / barSec));
    }
  }

  while (bedIntroCue >= bedCue - spb && introBars > 2) {
    introBars -= 2;
    bedIntroCue = snapToBarDownbeat(bedCue - introBars * barSec, bed.bpm, bed.beatOffset);
  }

  return { bedIntroCue: Math.max(0, bedIntroCue), introBars };
}

export function chooseRemixCues(
  bed: TrackAnalysis,
  layer: TrackAnalysis,
  opts: RemixCueOptions,
): RemixCuePlan {
  const syncRatio = computeStemSyncRatio(bed.bpm, layer.bpm);
  const effectiveLayerBpm = bed.bpm * syncRatio;
  const bedOpts = bedCandidates(bed, opts);
  const layerOpts = layerCandidates(layer, opts.direction);

  let best: RemixCuePlan | null = null;
  let bestScore = -Infinity;

  for (const bedPick of bedOpts) {
    const bedCue = snapToDownbeat(bedPick.time, bed.bpm, bed.beatOffset);
    const intro = pickIntroCue(bedCue, bed, opts.direction);
    const master = { position: bedCue, bpm: bed.bpm, offset: bed.beatOffset };

    for (const layerPick of layerOpts) {
      const layerCue = lockLayerPosition(master, layerPick.time, layer.bpm, layer.beatOffset);
      const dist = Math.abs(layerCue - layerPick.time);
      const spb = 60 / (layer.bpm || 120);
      const distPenalty = Math.min(0.35, dist / (spb * 4));
      const pairScore =
        bedPick.score * 0.32 +
        layerPick.score * 0.28 +
        alignmentScore(bedCue, layerCue, bed, layer) +
        stretchScore(syncRatio) +
        layerSectionBonus(layerCue, layer) +
        (intro.bedIntroCue < bedCue - spb ? 0.06 : 0) -
        distPenalty;

      if (pairScore > bestScore) {
        bestScore = pairScore;
        best = {
          bedCue,
          layerCue,
          bedIntroCue: intro.bedIntroCue,
          introBars: intro.introBars,
          bedLabel: bedPick.label,
          layerLabel: layerPick.label,
          syncRatio,
          effectiveLayerBpm: Math.round(effectiveLayerBpm * 10) / 10,
          direction: opts.direction,
        };
      }
    }
  }

  if (best) return best;

  const bedCue = snapToDownbeat(bedOpts[0]?.time ?? 0, bed.bpm, bed.beatOffset);
  const intro = pickIntroCue(bedCue, bed, opts.direction);
  const layerCue = lockLayerPosition(
    { position: bedCue, bpm: bed.bpm, offset: bed.beatOffset },
    layerOpts[0]?.time ?? 0,
    layer.bpm,
    layer.beatOffset,
  );

  return {
    bedCue,
    layerCue,
    bedIntroCue: intro.bedIntroCue,
    introBars: intro.introBars,
    bedLabel: bedOpts[0]?.label ?? "groove",
    layerLabel: layerOpts[0]?.label ?? "vocal",
    syncRatio,
    effectiveLayerBpm: Math.round(effectiveLayerBpm * 10) / 10,
    direction: opts.direction,
  };
}
