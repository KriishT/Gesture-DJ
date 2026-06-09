import type { FrameResult, TrackedHand } from "../gesture/HandTracker";
import type { HandFeatures, Pose } from "../gesture/gestures";
import type { MacroGesture } from "../copilot/recipeTypes";
import { isDualGesture } from "../copilot/choreography";
import { getEngine, useStore } from "../state/store";
import type { DeckId } from "../audio/Deck";
import { DEFAULT_CONTROL } from "./mappings";

export type HandLabel =
  | "volume"
  | "filter"
  | "bassKill"
  | "play"
  | "scratch"
  | "crossfade"
  | "idle";

interface HandTrack {
  features: HandFeatures | null;
  pose: Pose;
  rawPose: Pose;
  poseSince: number;
  value: number;
  vx: number;
  lastT: number;
  yMin: number;
  yMax: number;
  playArmed: boolean;
  scratching: boolean;
  bassKilled: boolean;
}

const POSE_HOLD_MS = 90;
const SCRATCH_GAIN = 1.6;
const cfg = DEFAULT_CONTROL;
const SPREAD_XF = 0.28 + cfg.moveThreshold;
const SPREAD_DUAL = 0.34 + cfg.moveThreshold * 0.5;
const HAND_UP = 1 - cfg.moveThreshold;
const HAND_DOWN = cfg.moveThreshold;

export class ControlMapper {
  private left: HandTrack = emptyTrack();
  private right: HandTrack = emptyTrack();

  ingest(frame: FrameResult): { left: HandLabel; right: HandLabel } {
    const now = performance.now() / 1000;
    const lLabel = this.updateHand("A", this.left, frame.left, now);
    const rLabel = this.updateHand("B", this.right, frame.right, now);
    return { left: lLabel, right: rLabel };
  }

  private updateHand(
    deckId: DeckId,
    track: HandTrack,
    hand: TrackedHand | null,
    now: number,
  ): HandLabel {
    if (!hand) {
      this.releaseHand(deckId, track);
      track.features = null;
      track.pose = "none";
      return "idle";
    }
    const f = hand.features;
    if (track.features && track.lastT) {
      const dt = Math.max(1e-3, now - track.lastT);
      track.vx = (f.x - track.features.x) / dt;
    }
    track.features = f;
    track.lastT = now;
    track.yMin = Math.min(track.yMin, f.y);
    track.yMax = Math.max(track.yMax, f.y);
    const span = track.yMax - track.yMin;
    if (span > 0.12) {
      track.yMin += (f.y - track.yMin) * 0.0005;
      track.yMax += (f.y - track.yMax) * 0.0005;
    }
    track.value = clamp01((track.yMax - f.y) / (track.yMax - track.yMin || 1));

    const nowMs = now * 1000;
    if (f.pose !== track.rawPose) {
      track.rawPose = f.pose;
      track.poseSince = nowMs;
    }
    if (nowMs - track.poseSince >= POSE_HOLD_MS && f.pose !== "none") {
      track.pose = f.pose;
    }
    return this.poseToLabel(track.pose);
  }

  private poseToLabel(pose: Pose): HandLabel {
    switch (pose) {
      case "open":
        return "volume";
      case "pinch":
        return "filter";
      case "fist":
        return "bassKill";
      case "point":
        return "play";
      case "peace":
        return "scratch";
      default:
        return "idle";
    }
  }

  private releaseHand(deckId: DeckId, track: HandTrack): void {
    const deck = getEngine().deck(deckId);
    if (track.bassKilled) {
      deck.setEq({ low: 0 });
      track.bassKilled = false;
    }
    if (track.scratching) {
      deck.endScratch();
      track.scratching = false;
    }
    track.playArmed = false;
  }

  applySolo(): void {
    const l = this.left.features;
    const r = this.right.features;

    // Both-hands crossfader: spread open palms control the blend (one unified move).
    if (l && r && l.pose === "open" && r.pose === "open") {
      const spread = Math.abs(l.x - r.x);
      if (spread > SPREAD_XF) {
        const xf = clamp01((l.x + r.x) / 2);
        useStore.getState().setCrossfader(xf);
        // Still allow filter/bass on each deck via other poses below, but skip volume.
        this.applyHand("A", this.left, true);
        this.applyHand("B", this.right, true);
        return;
      }
    }

    // Both fists = bass kill on both decks at once.
    if (l && r && l.pose === "fist" && r.pose === "fist") {
      for (const id of ["A", "B"] as DeckId[]) {
        getEngine().deck(id).setEq({ low: -40 });
      }
      return;
    }

    this.applyHand("A", this.left, false);
    this.applyHand("B", this.right, false);
  }

  private applyHand(deckId: DeckId, track: HandTrack, skipVolume: boolean): void {
    const deck = getEngine().deck(deckId);
    const f = track.features;
    if (!f) return;

    if (track.pose === "fist") {
      if (!track.bassKilled) {
        deck.setEq({ low: -40 });
        track.bassKilled = true;
      }
    } else if (track.bassKilled) {
      deck.setEq({ low: 0 });
      track.bassKilled = false;
    }

    if (track.pose === "peace") {
      if (!track.scratching) {
        deck.beginScratch();
        track.scratching = true;
      }
      if (track.vx < -cfg.velocityThreshold * 0.4) {
        deck.scratch(-Math.abs(track.vx) * SCRATCH_GAIN * 1.2);
      } else {
        deck.scratch(1 + track.vx * SCRATCH_GAIN);
      }
    } else if (track.scratching) {
      deck.endScratch();
      track.scratching = false;
    }

    if (track.pose === "point") {
      if (!track.playArmed) {
        useStore.getState().togglePlay(deckId);
        track.playArmed = true;
      }
    } else {
      track.playArmed = false;
    }

    if (!skipVolume && track.pose === "open") {
      deck.setVolume(track.value);
    } else if (track.pose === "pinch") {
      deck.setFilter((track.value - 0.5) * 2);
    }
  }

  /** Co-pilot catch-window: dual gestures require BOTH hands in one scored action. */
  isPerforming(gesture: MacroGesture): boolean {
    if (isDualGesture(gesture)) return this.isDualPerforming(gesture);

    const l = this.left;
    const r = this.right;
    const lOk = !!l.features;
    const rOk = !!r.features;
    switch (gesture) {
      case "leftHandUp":
        return lOk && l.value > HAND_UP;
      case "leftHandDown":
        return lOk && l.value < HAND_DOWN;
      case "rightHandUp":
        return rOk && r.value > HAND_UP;
      case "rightHandDown":
        return rOk && r.value < HAND_DOWN;
      case "leftFist":
        return lOk && l.pose === "fist" && !(r.features && r.pose === "fist");
      case "rightFist":
        return rOk && r.pose === "fist" && !(l.features && l.pose === "fist");
      case "twistLeft":
        return lOk && l.pose === "pinch";
      case "twistRight":
        return rOk && r.pose === "pinch";
      default:
        return false;
    }
  }

  private isDualPerforming(gesture: MacroGesture): boolean {
    const l = this.left.features;
    const r = this.right.features;
    if (!l || !r) return false;
    const spread = Math.abs(l.x - r.x);
    switch (gesture) {
      case "handsApart":
        return l.pose === "open" && r.pose === "open" && spread > SPREAD_DUAL;
      case "handsTogether":
        return spread < 0.18 && (l.pose === "fist" || l.pose === "open") && (r.pose === "fist" || r.pose === "open");
      case "bothHandsRise":
        return (
          l.pose === "open" &&
          r.pose === "open" &&
          this.left.value > 0.55 &&
          this.right.value > 0.55
        );
      default:
        return false;
    }
  }

  /** Which side(s) to highlight for animated cues. */
  cueSides(gesture: MacroGesture): "left" | "right" | "both" {
    if (isDualGesture(gesture)) return "both";
    if (gesture.startsWith("left") || gesture === "twistLeft") return "left";
    return "right";
  }
}

function emptyTrack(): HandTrack {
  return {
    features: null,
    pose: "none",
    rawPose: "none",
    poseSince: 0,
    value: 0.5,
    vx: 0,
    lastT: 0,
    yMin: 0.35,
    yMax: 0.7,
    playArmed: false,
    scratching: false,
    bassKilled: false,
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
