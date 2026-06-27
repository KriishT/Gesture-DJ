import type { StepAction, TransitionStep } from "./recipeTypes";

/** Snap a fractional bar position to the nearest quarter-bar. */
export function snapBar(totalBars: number, fraction: number): number {
  const raw = totalBars * fraction;
  const snapped = Math.round(raw * 4) / 4;
  return clamp(snapped, 0, Math.max(0, totalBars - 0.25));
}

/** Lay out moves with minimum spacing so FX don't pile up and sound muddy. */
export function layoutSteps(
  totalBars: number,
  entries: { atBar: number; minGap?: number; action: StepAction; verb: string }[],
): { atBar: number; action: StepAction; verb: string }[] {
  const out: { atBar: number; action: StepAction; verb: string }[] = [];
  let prev = -1;
  for (const entry of entries) {
    const gap = entry.minGap ?? 0.75;
    let at = snapBar(totalBars, entry.atBar / totalBars);
    if (at <= prev) at = prev + gap;
    at = Math.min(at, totalBars - 0.25);
    out.push({ atBar: at, action: entry.action, verb: entry.verb });
    prev = at;
  }
  return out;
}

/** Default beat length for scripted ramps — always at least 2 bars for blends. */
export function blendBeats(totalBars: number, fraction: number, min = 8): number {
  return Math.max(min, Math.round(totalBars * fraction * 4));
}

/** Normalize a finished recipe: snap spacing, fill default beat counts. */
export function polishSteps(steps: TransitionStep[], totalBars: number): TransitionStep[] {
  const sorted = [...steps].sort((a, b) => a.atBar - b.atBar);
  let prev = -0.5;
  return sorted.map((s, i) => {
    let atBar = snapBar(totalBars, s.atBar / totalBars);
    const minGap = minGapFor(s.action);
    if (atBar - prev < minGap) atBar = prev + minGap;
    atBar = Math.min(atBar, totalBars - 0.25);
    prev = atBar;

    const action = { ...s.action };
    if (
      (action.type === "crossfade" || action.type === "filter" || action.type === "volume") &&
      !action.beats
    ) {
      action.beats = blendBeats(totalBars, 0.35);
    }
    if (action.type === "bassKill" || action.type === "bassRestore") {
      action.beats = action.beats ?? 4;
    }
    if (action.type === "echoOut") action.beats = action.beats ?? 8;
    if (action.type === "reverb") action.beats = action.beats ?? blendBeats(totalBars, 0.4);
    if (action.type === "gate") action.beats = action.beats ?? blendBeats(totalBars, 0.25, 6);

    return { ...s, index: i, atBar };
  });
}

function minGapFor(action: StepAction): number {
  switch (action.type) {
    case "slam":
    case "cut":
      return 1.0;
    case "stemPreset":
    case "echoOut":
    case "reverb":
    case "brake":
    case "spinback":
      return 1.0;
    case "bassKill":
    case "bassRestore":
      return 0.75;
    default:
      return 0.5;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
