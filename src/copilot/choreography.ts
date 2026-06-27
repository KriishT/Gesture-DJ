import type { MacroGesture, StepAction, TransitionRecipe, TransitionStep } from "./recipeTypes";
import { verbForAction } from "./variety";

const DUAL_GESTURES: MacroGesture[] = ["handsApart", "handsTogether", "bothHandsRise"];

const SINGLE_BRING_B: MacroGesture[] = [
  "rightHandUp",
  "rightHandDown",
  "twistRight",
  "rightFist",
];
const SINGLE_REMOVE_A: MacroGesture[] = [
  "leftHandUp",
  "leftHandDown",
  "leftFist",
  "twistLeft",
];
const DUAL_DRAMATIC: MacroGesture[] = ["handsApart", "bothHandsRise", "handsTogether"];
const FILTER_B: MacroGesture[] = ["twistRight", "rightHandUp", "rightHandDown", "rightFist"];
const FILTER_A: MacroGesture[] = ["twistLeft", "leftHandUp", "leftHandDown", "leftFist"];
const SURPRISE_BRING_B: MacroGesture[] = ["bothHandsRise", "handsTogether", "twistRight", "rightFist"];
const SURPRISE_REMOVE_A: MacroGesture[] = ["bothHandsRise", "handsTogether", "twistLeft", "leftFist"];

export function isDualGesture(g: MacroGesture): boolean {
  return DUAL_GESTURES.includes(g);
}

export function actionRequiresDual(action: StepAction): boolean {
  switch (action.type) {
    case "crossfade":
      return (action.target ?? 1) >= 0.85;
    case "cut":
    case "slam":
      return true;
    default:
      return false;
  }
}

function poolFor(action: StepAction): MacroGesture[] {
  const isB = action.deck === "B";
  if (actionRequiresDual(action)) {
    return [...DUAL_DRAMATIC, "bothHandsRise", "handsApart", "handsTogether"];
  }
  switch (action.type) {
    case "play":
      return ["rightHandUp", "rightHandDown", "twistRight", "rightFist", "bothHandsRise"];
    case "filter":
      return isB ? [...FILTER_B, "bothHandsRise"] : [...FILTER_A, "bothHandsRise"];
    case "gate":
      return [...DUAL_DRAMATIC, "handsApart"];
    case "stemPreset":
      return [
        "handsApart",
        "bothHandsRise",
        "handsTogether",
        "twistLeft",
        "twistRight",
        ...(isB ? SINGLE_BRING_B : SINGLE_REMOVE_A),
      ];
    case "bassKill":
    case "echoOut":
    case "reverb":
      return isB
        ? [...SINGLE_BRING_B, ...SURPRISE_BRING_B.slice(0, 2)]
        : [...SINGLE_REMOVE_A, ...SURPRISE_REMOVE_A.slice(0, 2)];
    case "bassRestore":
    case "volume":
      return isB ? [...SINGLE_BRING_B, "twistRight"] : [...SINGLE_REMOVE_A, "twistLeft"];
    case "brake":
    case "spinback":
      return isB
        ? ["handsApart", "bothHandsRise", "rightHandUp", "twistRight", "rightFist"]
        : ["handsApart", "bothHandsRise", "leftFist", "twistLeft", "leftHandUp"];
    case "cut":
    case "slam":
      return DUAL_DRAMATIC;
    default:
      return isB ? SINGLE_BRING_B : SINGLE_REMOVE_A;
  }
}

const HAND_PHRASE: Record<MacroGesture, string> = {
  leftHandUp: "Lift your LEFT hand high",
  leftHandDown: "Drop your LEFT hand low",
  rightHandUp: "Lift your RIGHT hand high",
  rightHandDown: "Drop your RIGHT hand low",
  leftFist: "Make a LEFT fist",
  rightFist: "Make a RIGHT fist",
  handsApart: "Spread BOTH hands wide apart",
  handsTogether: "Pull BOTH hands together",
  bothHandsRise: "Raise BOTH hands together",
  twistLeft: "Pinch your LEFT hand and twist",
  twistRight: "Pinch your RIGHT hand and twist",
};

const FLAIR = ["", " — big energy!", " — smooth move.", " — you've got this!"];

export function instructionFor(gesture: MacroGesture, verb: string): string {
  const flair = FLAIR[Math.floor(Math.random() * FLAIR.length)];
  if (isDualGesture(gesture)) {
    return `${HAND_PHRASE[gesture]} — ${verb}${flair}`;
  }
  return `${HAND_PHRASE[gesture]} to ${verb}${flair}`;
}

export function defaultGesture(action: StepAction): MacroGesture {
  return pickAvoidRepeat(poolFor(action), null, new Set());
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickAvoidRepeat<T>(arr: T[], last: T | null, used: Set<T>): T {
  const fresh = arr.filter((x) => !used.has(x));
  const pool = fresh.length >= 2 ? fresh : arr.filter((x) => x !== last);
  const pickFrom = pool.length > 0 ? pool : arr;
  if (!last) return pick(pickFrom);
  const noLast = pickFrom.filter((x) => x !== last);
  return pick(noLast.length ? noLast : pickFrom);
}

/**
 * Randomize hand choreography for every transition attempt. Avoids repeating
 * gestures within a recipe and occasionally picks surprise moves.
 */
export function randomizeChoreography(recipe: TransitionRecipe): TransitionRecipe {
  const used = new Set<MacroGesture>();
  let lastGesture: MacroGesture | null = null;
  const steps: TransitionStep[] = recipe.steps.map((s, idx) => {
    const verb = s.verb ?? verbForAction(s.action);
    let pool = poolFor(s.action);

    // ~25% chance of a surprise gesture on non-dramatic steps after the first move.
    if (idx > 0 && Math.random() < 0.25 && !actionRequiresDual(s.action)) {
      const surprise = s.action.deck === "B" ? SURPRISE_BRING_B : SURPRISE_REMOVE_A;
      pool = [...pool, ...surprise];
    }

    const gesture = pickAvoidRepeat(pool, lastGesture, used);
    used.add(gesture);
    lastGesture = gesture;
    return {
      ...s,
      verb,
      gesture,
      dual: isDualGesture(gesture),
      instruction: instructionFor(gesture, verb),
    };
  });
  return { ...recipe, steps };
}
