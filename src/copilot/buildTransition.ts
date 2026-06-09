import type {
  MacroGesture,
  StepAction,
  StepActionType,
  TrackAnalysis,
  TransitionRecipe,
  TransitionStep,
} from "./recipeTypes";
import { defaultGesture, instructionFor, isDualGesture } from "./choreography";
import { chooseEntry, chooseExit } from "./transitionLibrary";

export interface BuilderStep {
  id: string;
  atBar: number;
  action: StepAction;
  verb: string;
  gesture?: MacroGesture;
}

export interface BuilderMeta {
  name: string;
  style: string;
  why: string;
  bars: number;
  cueOutA?: number;
  cueInB?: number;
}

export const BUILDER_ACTIONS: {
  type: StepActionType;
  label: string;
  deck: "A" | "B";
  defaultTarget?: number;
  defaultBeats?: number;
  defaultPreset?: StepAction["preset"];
  verb: string;
}[] = [
  { type: "play", label: "Start incoming deck", deck: "B", verb: "start Song B underneath" },
  { type: "crossfade", label: "Crossfade toward B", deck: "B", defaultTarget: 1, defaultBeats: 8, verb: "bring Song B into the mix" },
  { type: "volume", label: "Fade deck in/out", deck: "B", defaultTarget: 1, defaultBeats: 8, verb: "ease the blend" },
  { type: "filter", label: "Filter sweep", deck: "A", defaultTarget: 0.75, defaultBeats: 8, verb: "sweep the filter" },
  { type: "bassKill", label: "Cut bass", deck: "A", defaultBeats: 2, verb: "cut the bass" },
  { type: "bassRestore", label: "Restore bass", deck: "B", defaultBeats: 4, verb: "bring the bass back" },
  { type: "echoOut", label: "Echo throw", deck: "A", defaultBeats: 4, verb: "throw into echo" },
  { type: "reverb", label: "Reverb wash", deck: "A", defaultTarget: 0.65, defaultBeats: 8, verb: "wash in reverb" },
  { type: "brake", label: "Tape stop", deck: "A", defaultBeats: 2, verb: "tape-stop to silence" },
  { type: "spinback", label: "Spinback", deck: "A", verb: "spin the vinyl back" },
  { type: "gate", label: "Trance gate", deck: "A", defaultBeats: 8, verb: "stutter with a gate" },
  { type: "slam", label: "Drop slam", deck: "B", verb: "slam Song B in on the drop" },
  { type: "cut", label: "Hard cut", deck: "B", verb: "cut straight to Song B" },
  { type: "stemPreset", label: "Stem: acapella A", deck: "A", defaultPreset: "acapella", verb: "isolate Song A's vocal" },
  { type: "stemPreset", label: "Stem: instrumental B", deck: "B", defaultPreset: "instrumental", verb: "bring B's instrumental bed" },
  { type: "stemPreset", label: "Stem: drums B", deck: "B", defaultPreset: "drums", verb: "layer B's drums" },
  { type: "stemPreset", label: "Stem: bass B", deck: "B", defaultPreset: "bass", verb: "tease B's bass stem" },
  { type: "stemPreset", label: "Stem: guitar B", deck: "B", defaultPreset: "guitar", verb: "float B's guitar stem" },
  { type: "stemPreset", label: "Stem: piano B", deck: "B", defaultPreset: "piano", verb: "layer B's piano" },
];

export function defaultBuilderStep(type: StepActionType, deck: "A" | "B" = "B"): BuilderStep {
  const tpl = BUILDER_ACTIONS.find((a) => a.type === type && a.deck === deck) ?? BUILDER_ACTIONS[0];
  return {
    id: crypto.randomUUID(),
    atBar: 0,
    verb: tpl.verb,
    action: {
      type: tpl.type,
      deck: tpl.deck,
      ...(tpl.defaultTarget !== undefined ? { target: tpl.defaultTarget } : {}),
      ...(tpl.defaultBeats !== undefined ? { beats: tpl.defaultBeats } : {}),
      ...(tpl.defaultPreset ? { preset: tpl.defaultPreset } : {}),
    },
  };
}

/** Build a runnable recipe from the custom step list. */
export function buildCustomRecipe(
  steps: BuilderStep[],
  meta: BuilderMeta,
  trackA: TrackAnalysis,
  trackB: TrackAnalysis,
): TransitionRecipe {
  const sorted = [...steps].sort((a, b) => a.atBar - b.atBar);
  const recipeSteps: TransitionStep[] = sorted.map((s, i) => {
    const gesture = s.gesture ?? defaultGesture(s.action);
    return {
      index: i,
      atBar: s.atBar,
      action: s.action,
      verb: s.verb,
      gesture,
      dual: isDualGesture(gesture),
      instruction: instructionFor(gesture, s.verb),
    };
  });

  return {
    id: `custom-${Date.now()}`,
    name: meta.name || "My Custom Transition",
    style: meta.style || "Hand-built blend",
    why: meta.why || "A transition you designed step by step.",
    cueOutA: meta.cueOutA ?? chooseExit(trackA),
    cueInB: meta.cueInB ?? chooseEntry(trackB),
    bars: meta.bars,
    steps: recipeSteps,
  };
}
