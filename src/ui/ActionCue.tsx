import { useCopilot } from "./useCopilot";
import type { MacroGesture } from "../copilot/recipeTypes";
import { isDualGesture } from "../copilot/choreography";

type Motion = "up" | "down" | "apart" | "together" | "fist" | "twist" | "bothUp";
interface Cue {
  motion: Motion;
}

const CUES: Record<MacroGesture, Cue> = {
  leftHandUp: { motion: "up" },
  leftHandDown: { motion: "down" },
  rightHandUp: { motion: "up" },
  rightHandDown: { motion: "down" },
  leftFist: { motion: "fist" },
  rightFist: { motion: "fist" },
  bothHandsRise: { motion: "bothUp" },
  handsApart: { motion: "apart" },
  handsTogether: { motion: "together" },
  twistLeft: { motion: "twist" },
  twistRight: { motion: "twist" },
};

const GLYPH: Record<Motion, string> = {
  up: "\u2191",
  down: "\u2193",
  apart: "\u2194",
  together: "\u2192\u2190",
  fist: "\u270A",
  twist: "\u21BB",
  bothUp: "\u2191\u2191",
};

function CueTrails({ motion }: { motion: Motion }) {
  if (motion === "twist" || motion === "apart" || motion === "together") {
    return (
      <>
        <span className="cue-swipe swipe-a" />
        <span className="cue-swipe swipe-b" />
      </>
    );
  }
  if (motion === "up" || motion === "down" || motion === "bothUp") {
    return <span className={`cue-trail motion-${motion}`} />;
  }
  return null;
}

function SideCue({ side, motion, accent }: { side: "left" | "right"; motion: Motion; accent: string }) {
  return (
    <div className={`cue-hand ${side} motion-${motion}`} style={{ color: accent }}>
      <CueTrails motion={motion} />
      <span className="cue-arrow">{GLYPH[motion]}</span>
      <span className="cue-ghost">{"\uD83D\uDD90\uFE0F"}</span>
    </div>
  );
}

/** Animated motion cues with swipe trails for dual/single gestures. */
export function ActionCue() {
  const rt = useCopilot();
  if (rt.phase !== "running" || !rt.recipe) return null;
  const step = rt.recipe.steps[rt.stepIndex];
  if (!step) return null;

  const cue = CUES[step.gesture];
  if (!cue) return null;

  const dual = step.dual ?? isDualGesture(step.gesture);
  const cls = `action-cue ${rt.live ? "imminent" : ""} ${dual ? "dual" : ""}`;

  if (dual) {
    return (
      <div className={cls}>
        <div className="cue-dual-center motion-apart">
          <CueTrails motion={cue.motion} />
          <span className="cue-arrow dual-arrow">{GLYPH[cue.motion]}</span>
          <span className="cue-dual-label">BOTH HANDS</span>
          <span className="cue-ghost dual-ghost">{"\uD83E\uDD1D"}</span>
        </div>
      </div>
    );
  }

  const accent = step.gesture.startsWith("left") || step.gesture === "twistLeft" ? "#ff5e7e" : "#00d2a8";
  const side = step.gesture.startsWith("left") || step.gesture === "twistLeft" ? "left" : "right";

  return (
    <div className={cls}>
      <SideCue side={side} motion={cue.motion} accent={accent} />
    </div>
  );
}
