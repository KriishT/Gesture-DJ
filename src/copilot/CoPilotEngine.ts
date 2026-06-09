import type { AudioEngine } from "../audio/AudioEngine";
import { TransitionGuard } from "../audio/TransitionGuard";
import type { ControlMapper } from "../control/ControlMapper";
import type { TransitionRecipe } from "./recipeTypes";

export type StepResult = "pending" | "active" | "green" | "red";
export type CopilotPhase = "idle" | "armed" | "running" | "complete";

export interface CopilotRuntime {
  phase: CopilotPhase;
  recipe: TransitionRecipe | null;
  stepIndex: number;
  results: StepResult[];
  instruction: string;
  countdownBeats: number; // beats until the current step should fire
  armedAtSec: number; // cueOutA, for the timeline marker
  live: boolean; // true while the current step is in its hit window
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

// Pacing: a short preview to read the move, then a tight, competitive hit
// window where the gesture actually counts (GREEN if hit, RED if missed).
const MIN_STEP_GAP_SEC = 4.0; // minimum real time between consecutive prompts
const PREVIEW_SEC = 2.5; // prompt is shown this early so you can prepare
const HIT_BEFORE_SEC = 1.0; // green window opens this long before the cue
const HIT_AFTER_SEC = 1.6; // green window stays open this long after the cue

/**
 * Drives a transition recipe in real time using the catch-window model:
 *  - on-time gesture  => the action fires (driven by the user) -> GREEN
 *  - missed window    => the Guard completes it on beat anyway  -> RED
 * The transition always lands cleanly; green/red is a performance score.
 */
export class CoPilotEngine {
  private guard: TransitionGuard;
  private mapper: ControlMapper;
  private onComplete?: () => void;
  private onCancel?: () => void;

  private runtime: CopilotRuntime = blank();
  private listeners = new Set<() => void>();

  private startRealMs: number | null = null;
  private secPerBeat = 0.5;
  private barMs = 2000;
  /** Absolute performance.now() time each step's action is scheduled for. */
  private stepTimes: number[] = [];
  private firing = false;

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

  /** Prime the mix and arm the co-pilot for a chosen recipe. */
  prepare(recipe: TransitionRecipe, timing: DeckTiming): void {
    this.guard.prepare(recipe, timing);
    this.startRealMs = null;
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
    this.startRealMs = null;
    this.emit();
  }

  /** Called every frame while a recipe is loaded. */
  update(timing: DeckTiming): void {
    const r = this.runtime.recipe;
    if (!r || this.runtime.phase === "idle" || this.runtime.phase === "complete") return;

    this.secPerBeat = TransitionGuard.realSecondsPerBeat(timing.bpmA, timing.rateA);
    this.barMs = 4 * this.secPerBeat * 1000;
    this.guard.setTiming(timing);

    if (this.runtime.phase === "armed") {
      if (timing.positionA >= r.cueOutA) this.begin();
      return;
    }

    this.runRunning();
  }

  private begin(): void {
    this.startRealMs = performance.now();
    this.computeStepTimes();
    this.set({ phase: "running" });
  }

  /**
   * Lay out each step's action time. Start from its musical position, but
   * enforce a minimum real-time gap so prompts never pile up back-to-back and
   * the user always has several seconds to react.
   */
  private computeStepTimes(): void {
    const r = this.runtime.recipe!;
    const base = this.startRealMs ?? performance.now();
    const times: number[] = [];
    let prev = -Infinity;
    for (const step of r.steps) {
      const musical = base + step.atBar * this.barMs;
      const t = Math.max(musical, prev + MIN_STEP_GAP_SEC * 1000);
      times.push(t);
      prev = t;
    }
    this.stepTimes = times;
  }

  private runRunning(): void {
    const r = this.runtime.recipe!;
    const i = this.runtime.stepIndex;
    if (i >= r.steps.length) {
      this.complete();
      return;
    }
    const step = r.steps[i];
    const scheduled = this.stepTimes[i] ?? performance.now();
    const now = performance.now();
    const appear = scheduled - PREVIEW_SEC * 1000;
    const hitStart = scheduled - HIT_BEFORE_SEC * 1000;
    // Hit window stays open after the cue, but never overlaps the next preview.
    const nextAppear =
      i + 1 < this.stepTimes.length ? this.stepTimes[i + 1] - PREVIEW_SEC * 1000 : Infinity;
    const hitEnd = Math.min(scheduled + HIT_AFTER_SEC * 1000, nextAppear - 150);
    const countdownBeats = (scheduled - now) / (this.secPerBeat * 1000);

    if (now < appear) {
      // Not visible yet: keep the previous prompt up so nothing stacks.
      return;
    }

    if (now < hitStart) {
      // Preview phase: show the upcoming move with a countdown, not yet live.
      this.updateStepView(i, "active", step.instruction, countdownBeats, false);
      return;
    }

    if (now <= hitEnd) {
      // Live hit window: the gesture counts now.
      this.updateStepView(i, "active", step.instruction, countdownBeats, true);
      if (this.mapper.isPerforming(step.gesture)) {
        this.fire(step.index, "green");
      }
      return;
    }

    // Window passed without the gesture: auto-complete cleanly.
    this.fire(step.index, "red");
  }

  private fire(stepIndex: number, result: Exclude<StepResult, "pending" | "active">): void {
    if (this.firing) return;
    this.firing = true;
    const r = this.runtime.recipe!;
    const step = r.steps[stepIndex];
    this.guard.execute(step.action, this.secPerBeat);
    const results = [...this.runtime.results];
    results[stepIndex] = result;
    this.set({ results, stepIndex: stepIndex + 1, live: false });
    this.firing = false;
  }

  private updateStepView(
    index: number,
    result: StepResult,
    instruction: string,
    countdownBeats: number,
    live: boolean,
  ): void {
    const results = [...this.runtime.results];
    if (results[index] === "pending") results[index] = result;
    this.set({
      results,
      instruction,
      countdownBeats: Math.max(0, countdownBeats),
      stepIndex: index,
      live,
    });
  }

  private complete(): void {
    this.guard.finalize();
    this.onComplete?.();
    const greens = this.runtime.results.filter((r) => r === "green").length;
    const total = this.runtime.results.length;
    const pct = total ? Math.round((greens / total) * 100) : 0;
    const scoreLine =
      total > 0
        ? `${greens}/${total} on time (${pct}%) — ${pct >= 80 ? "crushed it!" : pct >= 50 ? "solid mix." : "keep practicing!"}`
        : "nicely done!";
    this.set({
      phase: "complete",
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
