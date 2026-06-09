// Shared types for track analysis, AI suggestions, and transition recipes.
// These are the contract between the frontend, the backend proxy, and Claude.

export type SectionKind =
  | "intro"
  | "build"
  | "drop"
  | "breakdown"
  | "verse"
  | "chorus"
  | "outro";

export interface TrackSection {
  start: number; // seconds
  end: number; // seconds
  kind: SectionKind;
  energy: number; // 0..1 average energy in the section
}

export interface TrackAnalysis {
  fileName: string;
  durationSec: number;
  bpm: number;
  beatOffset: number;
  /** Detected musical key in Camelot notation, e.g. "8A". Best-effort. */
  camelotKey: string | null;
  keyName: string | null; // e.g. "A minor"
  sections: TrackSection[];
  /** Times (s) of high-energy drops / impactful moments. */
  drops: number[];
  /** Coarse energy curve sampled across the track (0..1). */
  energyCurve: number[];
  /** Rough fraction of the track that contains vocals (0..1). */
  vocalProbability: number;
}

/** A macro gesture the user is asked to perform for a step. */
export type MacroGesture =
  | "leftHandDown"
  | "leftHandUp"
  | "rightHandDown"
  | "rightHandUp"
  | "handsApart"
  | "handsTogether"
  | "leftFist"
  | "rightFist"
  | "bothHandsRise"
  | "twistLeft"
  | "twistRight";

export type StepActionType =
  | "volume"
  | "filter"
  | "bassKill"
  | "bassRestore"
  | "crossfade"
  | "echoOut"
  | "play"
  | "cut"
  | "reverb"
  | "brake"
  | "spinback"
  | "gate"
  | "stemPreset"
  | "slam";

/** What the engine should actually do when a step fires (executed cleanly). */
export interface StepAction {
  type: StepActionType;
  deck: DeckRef;
  /** Target value where relevant (volume 0..1, filter -1..1, crossfade 0..1, reverb send 0..1). */
  target?: number;
  /** Stem mix preset when type is stemPreset. */
  preset?: "full" | "acapella" | "instrumental" | "drums" | "bass" | "guitar" | "piano" | "noVocals";
  /** Duration in beats over which to apply the change. */
  beats?: number;
}

export type DeckRef = "A" | "B";

export interface TransitionStep {
  index: number;
  instruction: string; // plain-language prompt shown to the user
  gesture: MacroGesture;
  action: StepAction;
  /** Bars from the transition start when this step should happen. */
  atBar: number;
  /** True when this step requires a both-hands gesture (single scored action). */
  dual?: boolean;
  /**
   * Action phrase (e.g. "bring Song B in") used to regenerate the instruction
   * when the gesture choreography is randomized for variety. Optional so AI
   * recipes (which set their own instruction/gesture) are left untouched.
   */
  verb?: string;
}

export interface TransitionRecipe {
  id: string;
  name: string; // e.g. "Boiler-Room Bass Swap"
  style: string; // short vibe descriptor
  why: string; // why it works for this pairing / why a crowd loves it
  /** Cue-out point on Song A (deck A), seconds. */
  cueOutA: number;
  /** Cue-in point on Song B (deck B), seconds. */
  cueInB: number;
  /** Total length of the transition in bars. */
  bars: number;
  steps: TransitionStep[];
}

export interface Suggestion {
  recipe: TransitionRecipe;
  impact: number; // 0..1 ranking score
}

export interface CopilotResponse {
  suggestions: Suggestion[];
  notes?: string;
}
