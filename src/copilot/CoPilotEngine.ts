import type { AudioEngine } from "../audio/AudioEngine";
import { TransitionGuard } from "../audio/TransitionGuard";
import type { ControlMapper } from "../control/ControlMapper";
import { isDualGesture } from "./choreography";
import type { TransitionRecipe, TransitionStep } from "./recipeTypes";

export type StepResult = "pending" | "active" | "green" | "red";
export type CopilotPhase = "idle" | "armed" | "running" | "complete";

export interface CopilotRuntime {
  phase: CopilotPhase;
  recipe: TransitionRecipe | null;
  stepIndex: number;
  results: StepResult[];
  instruction: string;
  countdownBeats: number;
  armedAtSec: number;
  live: boolean;
}

interface DeckTiming {
  bpmA: number;
  bpmB: number;
  rateA: number;
  positionA: number;
  positionB: number;
  offsetA: number;
  offsetB: number;
}

const PREVIEW_SEC = 3.5;
const HIT_BEFORE_SEC = 1.8;
const HIT_AFTER_SEC = 3.0;
const MIN_HIT_WINDOW_SEC = 3.0;
const HOLD_TO_CONFIRM_MS = 180;

/**
 * Catch-window co-pilot:
 *  - Mix moves are driven by Song A's playhead (bars from cueOutA), never wall clock or gestures.
 *  - Gestures only affect green/red scoring in parallel windows.
 *  - The transition finishes on the musical timeline even if gesture windows are still open.
 */
export class CoPilotEngine {
  private guard: TransitionGuard;
  private mapper: ControlMapper;
  private onComplete?: () => void;
  private onCancel?: () => void;

  private runtime: CopilotRuntime = blank();
  private listeners = new Set<() => void>();

  private secPerBeat = 0.5;
  private barSec = 2;
  private audioFired = new Set<number>();
  private gestureHoldMs = new Map<number, number>();
  private lastSampleMs = 0;
  private completed = false;

  constructor(
    eng: AudioEngine,
    mapper: ControlMapper,
    hooks?: { onComplete?: () => void; onCancel?: () => void },
  ) {
    this.guard = new TransitionGuard(eng);
    this.mapper = mapper;
    this.onComplete = hooks?.onComplete;
    this.onCancel = hooks?.onCancel;
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): CopilotRuntime => this.runtime;

  private emit(): void {
    this.listeners.forEach((l) => l());
  }

  private set(patch: Partial<CopilotRuntime>): void {
    this.runtime = { ...this.runtime, ...patch };
    this.emit();
  }

  prepare(recipe: TransitionRecipe, timing: DeckTiming): void {
    this.guard.prepare(recipe, timing);
    this.audioFired.clear();
    this.gestureHoldMs.clear();
    this.lastSampleMs = 0;
    this.completed = false;
    this.runtime = {
      phase: "armed",
      recipe,
      stepIndex: 0,
      results: recipe.steps.map(() => "pending"),
      instruction: `Get ready: ${recipe.name}. Play Song A toward the marker.`,
      countdownBeats: 0,
      armedAtSec: recipe.cueOutA,
      live: false,
    };
    this.emit();
  }

  cancel(): void {
    this.guard.reset();
    this.onCancel?.();
    this.runtime = blank();
    this.audioFired.clear();
    this.gestureHoldMs.clear();
    this.completed = false;
    this.emit();
  }

  update(timing: DeckTiming): void {
    const r = this.runtime.recipe;
    if (!r || this.runtime.phase === "idle" || this.runtime.phase === "complete") return;

    this.secPerBeat = TransitionGuard.realSecondsPerBeat(timing.bpmA, timing.rateA);
    this.barSec = 4 * this.secPerBeat;
    this.guard.setTiming(timing);

    if (this.runtime.phase === "armed") {
      if (timing.positionA >= r.cueOutA) this.begin(timing);
      return;
    }

    this.runRunning(timing);
  }

  private begin(timing: DeckTiming): void {
    this.audioFired.clear();
    this.gestureHoldMs.clear();
    this.lastSampleMs = performance.now();
    this.set({ phase: "running" });
    this.runAudio(timing);
  }

  /** Bars elapsed since the transition cue on deck A. */
  private elapsedBars(timing: DeckTiming): number {
    const r = this.runtime.recipe!;
    if (this.barSec <= 0) return 0;
    return (timing.positionA - r.cueOutA) / this.barSec;
  }

  /** Seconds relative to when a step's mix move should land musically. */
  private deltaSecFromStep(step: TransitionStep, timing: DeckTiming): number {
    return (this.elapsedBars(timing) - step.atBar) * this.barSec;
  }

  private hitWindowFor(step: TransitionStep): {
    previewSec: number;
    hitBeforeSec: number;
    hitAfterSec: number;
  } {
    const dual = isDualGesture(step.gesture);
    return {
      previewSec: dual ? PREVIEW_SEC + 0.6 : PREVIEW_SEC,
      hitBeforeSec: dual ? HIT_BEFORE_SEC + 0.4 : HIT_BEFORE_SEC,
      hitAfterSec: dual ? HIT_AFTER_SEC + 0.8 : HIT_AFTER_SEC,
    };
  }

  private runRunning(timing: DeckTiming): void {
    if (this.completed) return;

    const r = this.runtime.recipe!;
    const now = performance.now();
    const dt = this.lastSampleMs ? now - this.lastSampleMs : 16;
    this.lastSampleMs = now;

    // --- 1) Mix: always tied to Song A playhead ---
    this.runAudio(timing);

    // --- 2) Score gestures in parallel (never blocks audio) ---
    const results = [...this.runtime.results];
    for (let si = 0; si < r.steps.length; si++) {
      if (results[si] === "green" || results[si] === "red") continue;

      const step = r.steps[si];
      const delta = this.deltaSecFromStep(step, timing);
      const { hitBeforeSec, hitAfterSec } = this.hitWindowFor(step);
      const hitEndSec = Math.max(hitAfterSec, MIN_HIT_WINDOW_SEC - hitBeforeSec);

      if (delta < -hitBeforeSec) continue;

      if (delta <= hitEndSec) {
        const prev = this.gestureHoldMs.get(si) ?? 0;
        const hold = this.mapper.isPerforming(step.gesture)
          ? prev + dt
          : Math.max(0, prev - dt * 0.25);
        this.gestureHoldMs.set(si, hold);
        if (hold >= HOLD_TO_CONFIRM_MS) {
          results[si] = "green";
        }
      } else {
        results[si] = "red";
      }
    }

    const focus = this.focusStepIndex(timing);
    const step = r.steps[focus];
    const delta = this.deltaSecFromStep(step, timing);
    const { previewSec, hitBeforeSec, hitAfterSec } = this.hitWindowFor(step);
    const hitEndSec = Math.max(hitAfterSec, MIN_HIT_WINDOW_SEC - hitBeforeSec);
    const countdownBeats = (-delta) / this.secPerBeat;
    const live = delta >= -hitBeforeSec && delta <= hitEndSec;

    const displayResults = [...results];
    if (displayResults[focus] === "pending" && delta >= -previewSec) {
      displayResults[focus] = "active";
    }

    this.set({
      results: displayResults,
      stepIndex: focus,
      instruction: step.instruction,
      countdownBeats: Math.max(0, countdownBeats),
      live,
    });

    // --- 3) End on musical length, not gesture completion ---
    const elapsed = this.elapsedBars(timing);
    if (elapsed >= r.bars + 1) {
      this.complete();
    }
  }

  /** Fire every due mix move — independent of gesture state. */
  private runAudio(timing: DeckTiming): void {
    const r = this.runtime.recipe!;
    const elapsed = this.elapsedBars(timing);
    for (let si = 0; si < r.steps.length; si++) {
      if (elapsed + 0.04 >= r.steps[si].atBar) {
        this.fireStepAudio(r.steps[si], si);
      }
    }
  }

  private focusStepIndex(timing: DeckTiming): number {
    const r = this.runtime.recipe!;
    let best = 0;
    let bestDist = Infinity;

    for (let si = 0; si < r.steps.length; si++) {
      const delta = this.deltaSecFromStep(r.steps[si], timing);
      const { previewSec, hitAfterSec } = this.hitWindowFor(r.steps[si]);
      const hitEndSec = Math.max(hitAfterSec, MIN_HIT_WINDOW_SEC - HIT_BEFORE_SEC);
      if (delta >= -previewSec && delta <= hitEndSec + 0.4) {
        const dist = Math.abs(delta);
        if (dist < bestDist) {
          bestDist = dist;
          best = si;
        }
      }
    }
    if (bestDist < Infinity) return best;

    for (let si = 0; si < r.steps.length; si++) {
      if (this.elapsedBars(timing) <= r.steps[si].atBar + 0.25) return si;
    }
    return Math.max(0, r.steps.length - 1);
  }

  private fireStepAudio(step: TransitionStep, index: number): void {
    if (this.audioFired.has(index)) return;
    this.guard.execute(step.action, this.secPerBeat);
    this.audioFired.add(index);
  }

  private complete(): void {
    if (this.completed) return;
    this.completed = true;

    const results = this.runtime.results.map((r) =>
      r === "green" || r === "red" ? r : "red",
    );

    this.guard.finalize();
    this.onComplete?.();

    const greens = results.filter((r) => r === "green").length;
    const total = results.length;
    const pct = total ? Math.round((greens / total) * 100) : 0;
    const scoreLine =
      total > 0
        ? `${greens}/${total} on time (${pct}%) — ${pct >= 80 ? "crushed it!" : pct >= 50 ? "solid mix." : "keep practicing!"}`
        : "nicely done!";

    this.set({
      phase: "complete",
      results,
      instruction: `Transition complete — ${scoreLine}`,
      live: false,
    });
  }
}

function blank(): CopilotRuntime {
  return {
    phase: "idle",
    recipe: null,
    stepIndex: 0,
    results: [],
    instruction: "",
    countdownBeats: 0,
    armedAtSec: 0,
    live: false,
  };
}
