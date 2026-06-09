import type { MacroGesture, StepAction, TransitionRecipe, TransitionStep } from "./recipeTypes";

const DUAL_GESTURES: MacroGesture[] = ["handsApart", "handsTogether", "bothHandsRise"];

const SINGLE_BRING_B: MacroGesture[] = ["rightHandUp", "rightHandDown", "twistRight"];
const SINGLE_REMOVE_A: MacroGesture[] = ["leftHandUp", "leftHandDown", "leftFist", "twistLeft"];
const DUAL_DRAMATIC: MacroGesture[] = ["handsApart", "bothHandsRise", "handsTogether"];

export function isDualGesture(g: MacroGesture): boolean {
  return DUAL_GESTURES.includes(g);
}

/** Actions that should ONLY use both-hands gestures in AI assist. */
export function actionRequiresDual(action: StepAction): boolean {
  switch (action.type) {
    case "crossfade":
      return (action.target ?? 1) >= 0.85;
    case "cut":
    case "slam":
    case "brake":
    case "spinback":
      return true;
    default:
      return false;
  }
}

function poolFor(action: StepAction): MacroGesture[] {
  const isB = action.deck === "B";
  if (actionRequiresDual(action)) return DUAL_DRAMATIC;
  switch (action.type) {
    case "play":
      return SINGLE_BRING_B;
    case "filter":
      return isB ? ["twistRight", "rightHandUp", "rightHandDown"] : ["twistLeft", "leftHandUp", "leftHandDown"];
    case "gate":
      return DUAL_DRAMATIC;
    case "stemPreset":
      return DUAL_DRAMATIC;
    case "bassKill":
    case "echoOut":
    case "reverb":
      return isB ? SINGLE_BRING_B : SINGLE_REMOVE_A;
    case "bassRestore":
      return isB ? SINGLE_BRING_B : SINGLE_REMOVE_A;
    case "volume":
      return isB ? SINGLE_BRING_B : SINGLE_REMOVE_A;
    default:
      return isB ? SINGLE_BRING_B : SINGLE_REMOVE_A;
  }
}

const HAND_PHRASE: Record<MacroGesture, string> = {
  leftHandUp: "Lift your LEFT hand",
  leftHandDown: "Lower your LEFT hand",
  rightHandUp: "Lift your RIGHT hand",
  rightHandDown: "Lower your RIGHT hand",
  leftFist: "Make a LEFT fist",
  rightFist: "Make a RIGHT fist",
  handsApart: "Spread BOTH hands apart",
  handsTogether: "Bring BOTH hands together",
  bothHandsRise: "Raise BOTH hands together",
  twistLeft: "Pinch & move your LEFT hand",
  twistRight: "Pinch & move your RIGHT hand",
};

export function instructionFor(gesture: MacroGesture, verb: string): string {
  if (isDualGesture(gesture)) {
    return `${HAND_PHRASE[gesture]} — ${verb}.`;
  }
  return `${HAND_PHRASE[gesture]} to ${verb}.`;
}

export function defaultGesture(action: StepAction): MacroGesture {
  return poolFor(action)[0];
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Randomize hand choreography for AI assist. Dual-hand steps always get dual
 * gestures; single-deck steps never get dual gestures (so they aren't scored
 * as two separate hand actions).
 */
export function randomizeChoreography(recipe: TransitionRecipe): TransitionRecipe {
  const steps: TransitionStep[] = recipe.steps.map((s) => {
    if (!s.verb) return s;
    const pool = poolFor(s.action);
    const gesture = pick(pool);
    return {
      ...s,
      gesture,
      dual: isDualGesture(gesture),
      instruction: instructionFor(gesture, s.verb),
    };
  });
  return { ...recipe, steps };
}
