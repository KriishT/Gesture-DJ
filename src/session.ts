import { HandTracker, type FrameResult } from "./gesture/HandTracker";
import { ControlMapper } from "./control/ControlMapper";
import { CoPilotEngine } from "./copilot/CoPilotEngine";
import { getEngine, useStore } from "./state/store";
import type { HandState } from "./state/types";
import type { TrackedHand } from "./gesture/HandTracker";
import type { HandLabel } from "./control/ControlMapper";
import type { TransitionRecipe } from "./copilot/recipeTypes";
import { randomizeChoreography } from "./copilot/choreography";
import { diversifyRecipe } from "./copilot/variety";
import { RemixEngine } from "./remix/RemixEngine";

/**
 * Top-level controller that owns the gesture tracker, control mapper and
 * co-pilot, and runs the per-frame loop wiring gestures -> controls/co-pilot.
 */
class Session {
  readonly mapper = new ControlMapper();
  copilot: CoPilotEngine | null = null;
  remix: RemixEngine | null = null;
  private tracker: HandTracker | null = null;
  private rafId: number | null = null;
  private starting = false;
  latestFrame: FrameResult | null = null;
  overlayCanvas: HTMLCanvasElement | null = null;

  getCopilot(): CoPilotEngine {
    if (!this.copilot) {
      this.copilot = new CoPilotEngine(getEngine(), this.mapper, {
        onComplete: () => useStore.getState().commitTransitionComplete(),
        onCancel: () => useStore.getState().syncAfterTransitionAbort(),
      });
    }
    return this.copilot;
  }

  getRemixEngine(): RemixEngine {
    if (!this.remix) {
      this.remix = new RemixEngine(
        getEngine(),
        () => {
          const s = useStore.getState();
          return { decks: s.decks, crossfader: s.crossfader };
        },
        {
          onAudioRestored: () => useStore.getState().syncDecksFromEngine(),
          onMorphComplete: () => useStore.getState().commitRemixMorph(),
        },
      );
    }
    return this.remix;
  }

  /** Keep remix/copilot timing alive even when the camera is off. */
  ensureTickLoop(): void {
    this.startLoop();
  }

  enterRemixWorkspace(): void {
    this.getCopilot().cancel();
    this.ensureTickLoop();
  }

  exitRemixWorkspace(): void {
    this.getRemixEngine().exitWorkspace();
  }

  async enableCamera(video: HTMLVideoElement): Promise<void> {
    if (this.starting || this.tracker) return;
    this.starting = true;
    const store = useStore.getState();
    store.setGestureStatus("loading");
    try {
      this.tracker = new HandTracker();
      await this.tracker.init(video);
      this.tracker.start((frame) => this.onFrame(frame));
      store.setGestureStatus("ready");
      store.setGestureEnabled(true);
      this.startLoop();
    } catch (e) {
      console.error(e);
      store.setGestureStatus(
        "error",
        e instanceof Error ? e.message : "Could not start camera",
      );
    } finally {
      this.starting = false;
    }
  }

  disableCamera(): void {
    this.tracker?.stop();
    this.tracker = null;
    this.latestFrame = null;
    const store = useStore.getState();
    store.setGestureEnabled(false);
    store.setGestureStatus("off");
  }

  private onFrame(frame: FrameResult): void {
    this.latestFrame = frame;
    const labels = this.mapper.ingest(frame);
    const store = useStore.getState();
    store.updateHands(
      toHandState(frame.left, labels.left),
      toHandState(frame.right, labels.right),
    );
  }

  private startLoop(): void {
    if (this.rafId !== null) return;
    const loop = () => {
      this.rafId = requestAnimationFrame(loop);
      this.tick();
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private buildTiming(store: ReturnType<typeof useStore.getState>, eng: ReturnType<typeof getEngine>) {
    return {
      bpmA: store.decks.A.bpm || 120,
      bpmB: store.decks.B.bpm || 120,
      rateA: eng.deckA.rate,
      positionA: eng.deckA.position,
      positionB: eng.deckB.position,
      offsetA: store.decks.A.beatOffset || 0,
      offsetB: store.decks.B.beatOffset || 0,
    };
  }

  private tick(): void {
    const store = useStore.getState();
    const eng = getEngine();
    const timing = this.buildTiming(store, eng);

    if (store.workspace === "remix") {
      this.getRemixEngine().tick(timing);
      if (!this.getRemixEngine().isActive) {
        this.mapper.applySolo();
      }
      return;
    }

    const copilot = this.getCopilot();
    const gesturesOn =
      store.gesture.enabled && store.gesture.status === "ready";
    copilot.setGesturesEnabled(gesturesOn);
    copilot.update(timing);
    const phase = copilot.getSnapshot().phase;
    if (phase !== "running") {
      this.mapper.applySolo();
    }
  }

  prepareTransition(recipe: TransitionRecipe): void {
    this.ensureTickLoop();
    const store = useStore.getState();
    const eng = getEngine();
    const timing = this.buildTiming(store, eng);
    this.getCopilot().prepare(diversifyRecipe(randomizeChoreography(recipe)), timing);
    const a = eng.deckA;
    const b = eng.deckB;
    useStore.setState((s) => ({
      decks: {
        ...s.decks,
        A: { ...s.decks.A, rate: a.rate, keyLock: a.keyLockEnabled },
        B: { ...s.decks.B, rate: b.rate, keyLock: b.keyLockEnabled },
      },
    }));
  }

  cancelTransition(): void {
    this.getCopilot().cancel();
  }
}

function toHandState(hand: TrackedHand | null, label: HandLabel): HandState {
  if (!hand) {
    return { detected: false, x: 0.5, y: 0.5, gesture: "none", openness: 1 };
  }
  return {
    detected: true,
    x: hand.features.x,
    y: hand.features.y,
    gesture: label,
    openness: hand.features.openness,
  };
}

export const session = new Session();
