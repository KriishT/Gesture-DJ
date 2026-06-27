import type { FrameResult, TrackedHand } from "../gesture/HandTracker";
import type { HandFeatures, Pose } from "../gesture/gestures";
import { GESTURE_THRESHOLDS } from "../gesture/gestures";
import { PoseDebouncer } from "../gesture/smoothing";
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
  poseDebouncer: PoseDebouncer;
  value: number;
  vx: number;
  vy: number;
  lastT: number;
  yMin: number;
  yMax: number;
  playArmed: boolean;
  scratching: boolean;
  bassKilled: boolean;
}

const SCRATCH_GAIN = 1.6;
const cfg = DEFAULT_CONTROL;
const SPREAD_XF = 0.18 + cfg.moveThreshold;
const SPREAD_DUAL = 0.2 + cfg.moveThreshold * 0.45;
const SPREAD_TOGETHER = 0.26;
const HAND_UP = 0.72;
const HAND_DOWN = 0.28;
const RISE_THRESHOLD = 0.4;
const COPILOT_FIST_OPENNESS = GESTURE_THRESHOLDS.fistOpenness + 0.1;

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
      track.poseDebouncer.reset();
      track.pose = "none";
      return "idle";
    }
    const f = hand.features;
    if (track.features && track.lastT) {
      const dt = Math.max(1e-3, now - track.lastT);
      track.vx = (f.x - track.features.x) / dt;
      track.vy = (f.y - track.features.y) / dt;
    }
    track.features = f;
    track.lastT = now;
    track.yMin = Math.min(track.yMin, f.y);
    track.yMax = Math.max(track.yMax, f.y);
    const span = track.yMax - track.yMin;
    if (span > 0.1) {
      track.yMin += (f.y - track.yMin) * 0.0008;
      track.yMax += (f.y - track.yMax) * 0.0008;
    }
    track.value = clamp01((track.yMax - f.y) / (track.yMax - track.yMin || 1));

    const rawPose = this.resolvePose(f);
    track.pose = track.poseDebouncer.update(rawPose, now * 1000);
    return this.poseToLabel(track.pose);
  }

  /** Merge geometric pose with openness/pinch so borderline shapes still register. */
  private resolvePose(f: HandFeatures): Pose {
    if (f.pose === "pinch" || f.pinch >= cfg.pinchOn) return "pinch";
    if (f.pose === "fist" || f.openness <= GESTURE_THRESHOLDS.fistOpenness) return "fist";
    if (f.pose === "point" || (f.fingers.index && f.openness <= 0.35)) return "point";
    if (f.pose === "peace" || (f.fingers.index && f.fingers.middle && !f.fingers.ring)) {
      return "peace";
    }
    if (f.pose === "open" || f.openness >= cfg.openPalm) return "open";
    return f.pose;
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
    const lp = this.left.pose;
    const rp = this.right.pose;

    if (l && r) {
      const spread = Math.abs(l.x - r.x);

      // Both open palms spread apart → crossfade toward B.
      if (lp === "open" && rp === "open" && spread > SPREAD_XF) {
        useStore.getState().setCrossfader(clamp01((l.x + r.x) / 2));
        this.applyHand("A", this.left, true);
        this.applyHand("B", this.right, true);
        return;
      }

      // Hands close together → pull crossfader to center.
      if (
        spread < SPREAD_TOGETHER &&
        (lp === "open" || lp === "fist" || lp === "pinch") &&
        (rp === "open" || rp === "fist" || rp === "pinch")
      ) {
        useStore.getState().setCrossfader(0.5);
      }

      // Both hands rise → energy build on both decks.
      if (
        lp === "open" &&
        rp === "open" &&
        this.left.value > RISE_THRESHOLD &&
        this.right.value > RISE_THRESHOLD
      ) {
        const lift = 0.55 + (this.left.value + this.right.value) * 0.22;
        getEngine().deck("A").setVolume(clamp01(lift));
        getEngine().deck("B").setVolume(clamp01(lift));
      }
    }

    if (l && r && lp === "fist" && rp === "fist") {
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

    if (this.isFist(track)) {
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
      const vx = track.vx;
      if (Math.abs(vx) > cfg.velocityThreshold * 0.25 || Math.abs(track.vy) > cfg.velocityThreshold * 0.2) {
        if (vx < -cfg.velocityThreshold * 0.25) {
          deck.scratch(-Math.abs(vx) * SCRATCH_GAIN * 1.2);
        } else {
          deck.scratch(1 + vx * SCRATCH_GAIN);
        }
      } else {
        deck.scratch(0.35);
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

  isPerforming(gesture: MacroGesture): boolean {
    if (isDualGesture(gesture)) return this.isDualPerforming(gesture);
    return this.isSinglePerforming(gesture);
  }

  /** Co-pilot uses raw features first — debounce is for solo UI labels only. */
  private effectivePose(side: "left" | "right"): Pose {
    const track = side === "left" ? this.left : this.right;
    if (!track.features) return "none";
    const raw = this.resolvePose(track.features);
    return raw !== "none" ? raw : track.pose;
  }

  private isSinglePerforming(gesture: MacroGesture): boolean {
    const l = this.left;
    const r = this.right;
    const lOk = !!l.features;
    const rOk = !!r.features;
    switch (gesture) {
      case "leftHandUp":
        return lOk && this.handRaised(l);
      case "leftHandDown":
        return lOk && this.handLowered(l);
      case "rightHandUp":
        return rOk && this.handRaised(r);
      case "rightHandDown":
        return rOk && this.handLowered(r);
      case "leftFist":
        return lOk && this.isFist(l, true);
      case "rightFist":
        return rOk && this.isFist(r, true);
      case "twistLeft":
        return lOk && this.isTwist(l);
      case "twistRight":
        return rOk && this.isTwist(r);
      default:
        return false;
    }
  }

  private handLowered(track: HandTrack): boolean {
    return (
      track.value < HAND_DOWN ||
      (track.features !== null && track.features.openness >= cfg.openPalm && track.value < 0.42)
    );
  }

  private handRaised(track: HandTrack): boolean {
    const f = track.features;
    const pose = this.effectivePose(track === this.left ? "left" : "right");
    return (
      track.value > HAND_UP ||
      track.value > 0.62 ||
      pose === "open" ||
      pose === "point" ||
      (pose === "pinch" && track.value > 0.48) ||
      (f !== null && f.openness >= cfg.openPalm - 0.08 && track.value > 0.48)
    );
  }

  private isFist(track: HandTrack, copilot = false): boolean {
    const threshold = copilot ? COPILOT_FIST_OPENNESS : GESTURE_THRESHOLDS.fistOpenness;
    const side = track === this.left ? "left" : "right";
    const pose = this.effectivePose(side);
    return (
      pose === "fist" ||
      track.pose === "fist" ||
      (track.features !== null && track.features.openness <= threshold)
    );
  }

  private isTwist(track: HandTrack): boolean {
    const side = track === this.left ? "left" : "right";
    const pose = this.effectivePose(side);
    if (pose === "pinch" || track.pose === "pinch") return true;
    if (!track.features) return false;
    return track.features.pinch >= cfg.pinchOn * 0.65;
  }

  private isDualPerforming(gesture: MacroGesture): boolean {
    const l = this.left.features;
    const r = this.right.features;
    if (!l || !r) return false;
    const spread = Math.abs(l.x - r.x);
    const lp = this.effectivePose("left");
    const rp = this.effectivePose("right");
    const lOpen = lp === "open" || lp === "pinch" || lp === "point" || l.openness >= cfg.openPalm - 0.1;
    const rOpen = rp === "open" || rp === "pinch" || rp === "point" || r.openness >= cfg.openPalm - 0.1;
    switch (gesture) {
      case "handsApart":
        return (
          lOpen &&
          rOpen &&
          (spread > SPREAD_DUAL ||
            spread > 0.16 ||
            (spread > 0.12 && this.left.value + this.right.value > 0.85))
        );
      case "handsTogether":
        return (
          spread < SPREAD_TOGETHER + 0.12 &&
          (this.isFist(this.left, true) ||
            lp === "open" ||
            lp === "pinch" ||
            l.openness <= COPILOT_FIST_OPENNESS) &&
          (this.isFist(this.right, true) ||
            rp === "open" ||
            rp === "pinch" ||
            r.openness <= COPILOT_FIST_OPENNESS)
        );
      case "bothHandsRise":
        return (
          lOpen &&
          rOpen &&
          this.left.value > RISE_THRESHOLD &&
          this.right.value > RISE_THRESHOLD
        );
      default:
        return false;
    }
  }

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
    poseDebouncer: new PoseDebouncer(38, 85),
    value: 0.5,
    vx: 0,
    vy: 0,
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
