import type { CopilotResponse, StepAction, TrackAnalysis, TransitionRecipe } from "./recipeTypes";
import { snapToDownbeat } from "../audio/beatAlign";

export function pickWeighted<T>(items: { item: T; weight: number }[]): T {
  if (items.length === 0) throw new Error("pickWeighted: empty");
  if (items.length === 1) return items[0].item;
  const total = items.reduce((s, x) => s + Math.max(0.01, x.weight), 0);
  let r = Math.random() * total;
  for (const entry of items) {
    r -= Math.max(0.01, entry.weight);
    if (r <= 0) return entry.item;
  }
  return items[items.length - 1].item;
}

/** Lightly shuffle the top band so the menu feels fresh each session. */
export function shuffleSuggestionBand(response: CopilotResponse, band = 14): CopilotResponse {
  const head = response.suggestions.slice(0, band);
  const tail = response.suggestions.slice(band);
  for (let i = head.length - 1; i > 0; i--) {
    if (Math.random() > 0.55) continue;
    const j = Math.floor(Math.random() * (i + 1));
    [head[i], head[j]] = [head[j], head[i]];
  }
  head.sort((a, b) => b.impact - a.impact);
  return { ...response, suggestions: [...head, ...tail] };
}

/** Light nudge to cue points — keep step bars stable so hit windows stay fair. */
export function diversifyRecipe(recipe: TransitionRecipe): TransitionRecipe {
  const cueJitter = () => (Math.random() - 0.5) * 0.8;
  return {
    ...recipe,
    cueOutA: Math.max(0, recipe.cueOutA + cueJitter()),
    cueInB: Math.max(0, recipe.cueInB + cueJitter()),
  };
}

interface CueCandidate {
  time: number;
  weight: number;
}

function phraseBoundaries(track: TrackAnalysis, minSec: number, maxSec: number): CueCandidate[] {
  const spb = 60 / (track.bpm || 120);
  const barSec = 4 * spb;
  const out: CueCandidate[] = [];
  const startBar = Math.ceil(minSec / barSec);
  const endBar = Math.floor(maxSec / barSec);
  for (let bar = startBar; bar <= endBar; bar += 4) {
    const t = snapToDownbeat(bar * barSec, track.bpm, track.beatOffset);
    if (t >= minSec && t <= maxSec) {
      out.push({ time: t, weight: 0.55 + Math.random() * 0.15 });
    }
  }
  return out;
}

export function exitCueCandidates(a: TrackAnalysis): CueCandidate[] {
  const out: CueCandidate[] = [];
  for (const d of a.drops.filter((t) => t > a.durationSec * 0.32)) {
    out.push({ time: d, weight: 1.0 });
  }
  for (const s of a.sections) {
    if (s.start <= a.durationSec * 0.42) continue;
    if (s.kind === "breakdown") out.push({ time: s.start, weight: 0.88 });
    if (s.kind === "outro") out.push({ time: s.start, weight: 0.72 });
    if (s.kind === "verse" && s.start > a.durationSec * 0.55) {
      out.push({ time: s.start, weight: 0.62 });
    }
  }
  out.push(...phraseBoundaries(a, a.durationSec * 0.45, a.durationSec * 0.88));
  out.push({ time: Math.max(8, a.durationSec * (0.55 + Math.random() * 0.12)), weight: 0.48 });
  return out;
}

export function entryCueCandidates(b: TrackAnalysis): CueCandidate[] {
  const out: CueCandidate[] = [];
  for (const d of b.drops.slice(0, 3)) {
    out.push({ time: Math.max(0, d), weight: d === b.drops[0] ? 0.95 : 0.72 });
  }
  for (const s of b.sections) {
    if (s.kind === "build") out.push({ time: s.start, weight: 0.82 });
    if (s.kind === "drop") out.push({ time: s.start, weight: 0.9 });
    if (s.kind === "intro" && s.end > 4) out.push({ time: s.start, weight: 0.58 });
    if (s.kind === "verse") out.push({ time: s.start, weight: 0.64 });
  }
  out.push(...phraseBoundaries(b, 0, Math.min(b.durationSec * 0.45, 90)));
  out.push({ time: Math.max(0, b.durationSec * 0.08), weight: 0.4 });
  return out;
}

export function chooseExit(a: TrackAnalysis): number {
  return pickWeighted(exitCueCandidates(a).map((c) => ({ item: c.time, weight: c.weight })));
}

export function chooseEntry(b: TrackAnalysis): number {
  return pickWeighted(entryCueCandidates(b).map((c) => ({ item: c.time, weight: c.weight })));
}

export function verbForAction(action: StepAction): string {
  const deck = action.deck === "B" ? "Song B" : "Song A";
  switch (action.type) {
    case "play":
      return "start Song B underneath";
    case "crossfade":
      return (action.target ?? 1) >= 0.85 ? `bring ${deck} fully in` : `ease ${deck} into the mix`;
    case "filter":
      return action.target && action.target > 0 ? `high-pass ${deck}` : `filter ${deck}`;
    case "bassKill":
      return `cut ${deck}'s bass`;
    case "bassRestore":
      return `restore ${deck}'s bass`;
    case "echoOut":
      return `throw ${deck} into echo`;
    case "reverb":
      return `wash ${deck} in reverb`;
    case "brake":
      return `tape-stop ${deck}`;
    case "spinback":
      return `spin back ${deck}`;
    case "gate":
      return `stutter ${deck} out`;
    case "cut":
      return `hard-cut to ${deck}`;
    case "slam":
      return `slam into ${deck}`;
    case "stemPreset":
      return `switch ${deck}'s stem mix`;
    case "volume":
      return `ride ${deck}'s volume`;
    default:
      return `move on ${deck}`;
  }
}
