import type { EqValues } from "../audio/Deck";
import type { DeckState } from "../state/types";
import type { RemixCuePlan } from "./remixCuePicker";

export type RemixDirection = "bOnA" | "aOnB";

export type RemixLayerKind =
  | "acapella"
  | "instrumental"
  | "drums"
  | "bass"
  | "guitar"
  | "piano";

export type RemixPhase = "idle" | "intro" | "layering" | "riding" | "morphing";

export interface RemixFit {
  score: number;
  label: string;
  direction: RemixDirection;
  bedDeck: "A" | "B";
  layerDeck: "A" | "B";
  warnings: string[];
  tips: string[];
  suggestedLayers: RemixLayerKind[];
  bpmGap: number;
  harmonic: boolean;
  cues: RemixCuePlan;
}

export interface DeckAudioSnapshot {
  rate: number;
  keyLock: boolean;
  volume: number;
  stemPreset: DeckState["stemPreset"];
  eq: EqValues;
  filter: number;
  bassKill: boolean;
  playing: boolean;
  position: number;
}

export interface RemixSnapshot {
  crossfader: number;
  A: DeckAudioSnapshot;
  B: DeckAudioSnapshot;
}

export interface RemixSessionState {
  phase: RemixPhase;
  direction: RemixDirection;
  bedDeck: "A" | "B";
  layerDeck: "A" | "B";
  /** Remix start points (seconds) — independent of DJ cue points. */
  cueA: number;
  cueB: number;
  cuePlan: RemixCuePlan | null;
  activeLayer: RemixLayerKind | null;
  fit: RemixFit | null;
  message: string;
}

export const initialRemixSession = (): RemixSessionState => ({
  phase: "idle",
  direction: "bOnA",
  bedDeck: "A",
  layerDeck: "B",
  cueA: 0,
  cueB: 0,
  cuePlan: null,
  activeLayer: null,
  fit: null,
  message: "Load tracks on both decks, then analyze remix fit — AI picks the start points.",
});
