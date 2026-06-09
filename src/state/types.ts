import type { EqValues } from "../audio/Deck";
import type { TrackAnalysis } from "../copilot/recipeTypes";
import type { StemName, StemStatus } from "../stems/client";

export type DeckId = "A" | "B";
export type Mode = "solo" | "assisted";
/** Top-level workspace — DJ mixing vs isolated remix lab. */
export type WorkspaceMode = "dj" | "remix";
export type PadMode = "cue" | "fx";

export type StemLevels = Record<StemName, number>;

export const defaultStemLevels = (): StemLevels => ({
  drums: 1,
  bass: 1,
  other: 1,
  vocals: 1,
  guitar: 1,
  piano: 1,
});

export interface DeckState {
  id: DeckId;
  fileName: string | null;
  hasTrack: boolean;
  playing: boolean;
  position: number;
  duration: number;
  bpm: number;
  beatOffset: number;
  volume: number;
  filter: number; // -1..1
  eq: EqValues;
  rate: number;
  keyLock: boolean;
  loading: boolean;
  analysis: TrackAnalysis | null;
  cuePoint: number; // chosen cue-in (s)
  peaks: number[]; // downsampled waveform peaks (0..1)
  bassKill: boolean;
  echoOn: boolean;
  reverbOn: boolean;
  cues: number[]; // hot-cue positions (s); -1 = unset
  loopBeats: number; // active loop length in beats; 0 = off
  stemsStatus: StemStatus;
  stemsProgress: number;
  stemsElapsedSec: number | null;
  stemsError: string | null;
  stemPreset: "full" | "acapella" | "instrumental" | "drums" | "bass" | "guitar" | "piano" | "custom";
  stemLevels: StemLevels;
  channelLevel: number;
}

export interface HandState {
  detected: boolean;
  x: number; // 0..1 (mirrored screen space)
  y: number; // 0..1 (0 top, 1 bottom)
  gesture: string; // current macro gesture id or "none"
  openness: number; // 0 fist .. 1 open
}

export interface GestureState {
  enabled: boolean;
  status: "off" | "loading" | "ready" | "error";
  errorMessage?: string;
  left: HandState; // controls Deck A
  right: HandState; // controls Deck B
  calibrated: boolean;
}
