import type { TrackAnalysis } from "../copilot/recipeTypes";
import { computeSyncRatio } from "../audio/syncRatio";
import { chooseRemixCues } from "./remixCuePicker";
import type { RemixDirection, RemixFit, RemixLayerKind } from "./types";

function fmtTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function parseCamelot(k: string | null): { num: number; letter: string } | null {
  if (!k) return null;
  const m = /^(\d{1,2})([AB])$/.exec(k.trim());
  return m ? { num: parseInt(m[1], 10), letter: m[2] } : null;
}

function keyCompatible(ka: string | null, kb: string | null): boolean {
  const pa = parseCamelot(ka);
  const pb = parseCamelot(kb);
  if (!pa || !pb) return false;
  const d = Math.abs(pa.num - pb.num) % 12;
  const circ = Math.min(d, 12 - d);
  if (pa.letter === pb.letter && circ <= 1) return true;
  return pa.num === pb.num;
}

function stretchPenalty(bpmA: number, bpmB: number): number {
  const ratio = computeSyncRatio(bpmA, bpmB);
  const dev = Math.abs(ratio - 1);
  if (dev <= 0.04) return 0;
  if (dev <= 0.08) return 0.08;
  if (dev <= 0.15) return 0.18;
  if (dev <= 0.25) return 0.32;
  return 0.5;
}

/**
 * Score how well `layer` vocals/stems can ride on `bed` groove.
 */
export function analyzeRemixFit(
  bed: TrackAnalysis,
  layer: TrackAnalysis,
  direction: RemixDirection,
  opts: { stemsBed: boolean; stemsLayer: boolean },
): RemixFit {
  const bedDeck = direction === "bOnA" ? "A" : "B";
  const layerDeck = direction === "bOnA" ? "B" : "A";
  const bpmGap = Math.abs(bed.bpm - layer.bpm);
  const harmonic = keyCompatible(bed.camelotKey, layer.camelotKey);
  const stretch = stretchPenalty(bed.bpm, layer.bpm);

  let score = 0.55;
  const warnings: string[] = [];
  const tips: string[] = [];
  const suggestedLayers: RemixLayerKind[] = [];

  if (!opts.stemsLayer) {
    score -= 0.35;
    warnings.push("Separate stems on the layer deck for a clean vocal — EQ-only is a rough tease.");
  } else {
    score += 0.15;
    suggestedLayers.push("acapella");
  }

  if (opts.stemsBed) {
    score += 0.08;
    tips.push("Bed deck stems ready — vocal can be stripped cleanly from the groove.");
  } else if (bed.vocalProbability > 0.45) {
    score -= 0.12;
    warnings.push("Bed track is vocal-heavy without stems — vocals may clash with the layer.");
    tips.push("Strip bed vocals with stems on the bed deck for a cleaner mashup.");
  }

  if (layer.vocalProbability < 0.25) {
    score -= 0.2;
    warnings.push("Layer track has few vocals — try drums or melody stems instead.");
  } else {
    score += 0.1;
  }

  score -= stretch;
  if (bpmGap > 6) {
    tips.push(`BPM gap ${Math.round(bpmGap)} — pitch-locked sync will carry the layer; keep sections shorter if it feels off.`);
  }
  if (harmonic) score += 0.12;
  else {
    score -= 0.1;
    warnings.push("Keys may clash — vocal-only layers work best.");
    tips.push("Prefer acapella-only; add drums/bass only if it still sounds clean.");
  }

  if (harmonic && bpmGap <= 6 && opts.stemsLayer) {
    suggestedLayers.push("drums", "bass");
  }
  if (harmonic && layer.vocalProbability > 0.35 && opts.stemsLayer) {
    suggestedLayers.push("guitar", "piano");
  }

  score = Math.max(0.12, Math.min(0.98, score));

  let label = "Risky mashup";
  if (score >= 0.75) label = "Strong remix fit";
  else if (score >= 0.55) label = "Good vocal-on-beat potential";
  else if (score >= 0.38) label = "Short-section tease only";

  if (suggestedLayers.length === 0) suggestedLayers.push("acapella");

  const cues = chooseRemixCues(bed, layer, {
    direction,
    stemsBed: opts.stemsBed,
    stemsLayer: opts.stemsLayer,
  });
  const stretchPct = Math.round(Math.abs(cues.syncRatio - 1) * 100);
  const dirLabel =
    direction === "bOnA" ? "B vocals ride A's groove" : "A vocals ride B's groove";
  tips.unshift(
    `${dirLabel} — bed ${cues.bedLabel} @ ${fmtTime(cues.bedCue)}, ${cues.introBars} bars intro then swap.`,
  );
  tips.push(
    `Layer hook: ${cues.layerLabel} @ ${fmtTime(cues.layerCue)} — grid-locked to bed downbeat.`,
  );
  tips.push(
    stretchPct <= 4
      ? `Layer sync ${cues.syncRatio.toFixed(2)}× (${cues.effectiveLayerBpm} BPM effective) — tight match.`
      : `Layer sync ${cues.syncRatio.toFixed(2)}× → ${cues.effectiveLayerBpm} BPM (pitch-locked, ${stretchPct}% stretch).`,
  );

  return {
    score,
    label,
    direction,
    bedDeck,
    layerDeck,
    warnings,
    tips,
    suggestedLayers: [...new Set(suggestedLayers)],
    bpmGap,
    harmonic,
    cues,
  };
}

/** Pick the stronger direction for both ways. */
export function bestRemixDirection(
  a: TrackAnalysis,
  b: TrackAnalysis,
  opts: { stemsA: boolean; stemsB: boolean },
): RemixFit {
  const bOnA = analyzeRemixFit(a, b, "bOnA", { stemsBed: opts.stemsA, stemsLayer: opts.stemsB });
  const aOnB = analyzeRemixFit(b, a, "aOnB", { stemsBed: opts.stemsB, stemsLayer: opts.stemsA });
  return bOnA.score >= aOnB.score ? bOnA : aOnB;
}
