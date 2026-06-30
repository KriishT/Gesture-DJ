import type {
  CopilotResponse,
  StepAction,
  TrackAnalysis,
  TransitionRecipe,
  TransitionStep,
} from "./recipeTypes";
import { defaultGesture, instructionFor, isDualGesture } from "./choreography";
import { chooseEntry, chooseExit } from "./variety";
import { chooseDoubleDropCues, snapToDownbeat } from "../audio/beatAlign";
import { blendQuality } from "../audio/TransitionGuard";
import { layoutSteps, polishSteps } from "./transitionMix";

/**
 * A large catalog (30+) of crowd-flipping transitions built from composable
 * "moves". Each technique uses a distinct combination of factors \u2014 bass swaps,
 * filter sweeps, echo throws, reverb washes, tape-stops, spinbacks, trance
 * gates, double-drops, remix layering \u2014 so they sound genuinely different.
 * Gestures are placeholders here and get randomized per attempt for variety.
 */

interface Move {
  atBar: number;
  action: StepAction;
  verb: string;
}

type Energy = "smooth" | "lift" | "slam";

interface TechSpec {
  key: string;
  name: string;
  style: string;
  why: string;
  energy: Energy;
  vocalSafe: boolean; // true if it avoids overlapping vocals
  keySensitive: boolean; // true if it relies on harmonic compatibility
  lens: number[]; // bar lengths to generate variants for
  build: (len: number) => Move[];
}

// --- move shorthands -------------------------------------------------------
const playB = (): Move => ({ atBar: 0, action: { type: "play", deck: "B" }, verb: "start Song B underneath" });
const bringB = (atBar: number, beats: number, target = 1): Move => ({
  atBar,
  action: { type: "crossfade", deck: "B", target, beats },
  verb: target >= 0.99 ? "bring Song B fully in" : "ease Song B into the mix",
});
const layerB = (atBar: number, beats: number): Move => ({
  atBar,
  action: { type: "crossfade", deck: "B", target: 0.45, beats },
  verb: "layer Song B's tops over Song A",
});
const killBassA = (atBar: number): Move => ({
  atBar,
  action: { type: "bassKill", deck: "A", beats: 2 },
  verb: "cut Song A's bass",
});
const restoreBassB = (atBar: number): Move => ({
  atBar,
  action: { type: "bassRestore", deck: "B", beats: 4 },
  verb: "bring Song B's bass up",
});
const hpA = (atBar: number, beats: number): Move => ({
  atBar,
  action: { type: "filter", deck: "A", target: 0.85, beats },
  verb: "high-pass Song A into a wash",
});
const lpA = (atBar: number, beats: number): Move => ({
  atBar,
  action: { type: "filter", deck: "A", target: -0.85, beats },
  verb: "roll Song A's low-pass down",
});
const riserA = (atBar: number, beats: number): Move => ({
  atBar,
  action: { type: "filter", deck: "A", target: 0.7, beats },
  verb: "ride the build-up tension",
});
const echoA = (atBar: number): Move => ({
  atBar,
  action: { type: "echoOut", deck: "A", beats: 4 },
  verb: "throw Song A into an echo tail",
});
const reverbA = (atBar: number, beats: number): Move => ({
  atBar,
  action: { type: "reverb", deck: "A", target: 0.6, beats },
  verb: "wash Song A in reverb",
});
const brakeA = (atBar: number): Move => ({
  atBar,
  action: { type: "brake", deck: "A", beats: 2 },
  verb: "tape-stop Song A to a halt",
});
const spinbackA = (atBar: number): Move => ({
  atBar,
  action: { type: "spinback", deck: "A" },
  verb: "spin Song A back",
});
const gateA = (atBar: number, beats: number): Move => ({
  atBar,
  action: { type: "gate", deck: "A", beats },
  verb: "trance-gate Song A into a stutter",
});
const slamB = (atBar: number): Move => ({
  atBar,
  action: { type: "slam", deck: "B" },
  verb: "slam Song B in on the drop",
});
const cutB = (atBar: number): Move => ({
  atBar,
  action: { type: "cut", deck: "B" },
  verb: "cut straight to Song B",
});
const acapellaA = (atBar: number): Move => ({
  atBar,
  action: { type: "stemPreset", deck: "A", preset: "acapella" },
  verb: "isolate Song A's vocal (acapella)",
});
const instB = (atBar: number): Move => ({
  atBar,
  action: { type: "stemPreset", deck: "B", preset: "instrumental" },
  verb: "bring in Song B's instrumental bed",
});
const drumsB = (atBar: number): Move => ({
  atBar,
  action: { type: "stemPreset", deck: "B", preset: "drums" },
  verb: "ride Song B's drums underneath",
});
const guitarB = (atBar: number): Move => ({
  atBar,
  action: { type: "stemPreset", deck: "B", preset: "guitar" },
  verb: "float Song B's guitar stem over the mix",
});
const pianoB = (atBar: number): Move => ({
  atBar,
  action: { type: "stemPreset", deck: "B", preset: "piano" },
  verb: "layer Song B's piano under Song A",
});
const bassBStem = (atBar: number): Move => ({
  atBar,
  action: { type: "stemPreset", deck: "B", preset: "bass" },
  verb: "tease Song B's bass stem underneath",
});
const noVocalsA = (atBar: number): Move => ({
  atBar,
  action: { type: "stemPreset", deck: "A", preset: "noVocals" },
  verb: "strip Song A's vocal for a stem bed",
});
const acapellaB = (atBar: number): Move => ({
  atBar,
  action: { type: "stemPreset", deck: "B", preset: "acapella" },
  verb: "tease Song B's vocal stem",
});

const h = (len: number, frac: number) => Math.round(len * frac);

/** Phrase-aligned move layout — prevents FX piling up on the same bar. */
function L(
  len: number,
  items: { frac: number; minGap?: number; move: () => Omit<Move, "atBar"> }[],
): Move[] {
  return layoutSteps(
    len,
    items.map(({ frac, minGap, move }) => {
      const m = move();
      return { atBar: h(len, frac), minGap, action: m.action, verb: m.verb };
    }),
  );
}

// --- techniques ------------------------------------------------------------
const TECHNIQUES: TechSpec[] = [
  {
    key: "bass-swap",
    name: "Bass Swap",
    style: "Tight, club-ready low-end hand-off",
    why: "Swapping the bass on a phrase keeps the low end clean and lets the crowd feel the new track take over with zero mud.",
    energy: "lift",
    vocalSafe: false,
    keySensitive: true,
    lens: [8, 16, 24],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.1, move: () => bringB(0, h(len, 0.35), 0.42) },
        { frac: 0.38, minGap: 0.75, move: () => killBassA(0) },
        { frac: 0.5, move: () => restoreBassB(0) },
        { frac: 0.72, move: () => bringB(0, h(len, 0.28)) },
      ]),
  },
  {
    key: "remix-layer",
    name: "Remix Layer",
    style: "B sneaks in as a remix layer, then takes over",
    why: "Floating Song B in airy and bass-less over Song A's groove sounds like a live remix \u2014 then the bass swaps and B becomes the track.",
    energy: "lift",
    vocalSafe: true,
    keySensitive: true,
    lens: [16, 24],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.08, move: () => layerB(0, h(len, 0.65)) },
        { frac: 0.35, minGap: 0.75, move: () => killBassA(0) },
        { frac: 0.48, move: () => restoreBassB(0) },
        { frac: 0.72, move: () => bringB(0, h(len, 0.28)) },
      ]),
  },
  {
    key: "filter-hp",
    name: "High-Pass Lift",
    style: "Hypnotic high-pass wash out",
    why: "A slow high-pass thins Song A to air while B blooms underneath \u2014 dreamy and seamless.",
    energy: "smooth",
    vocalSafe: true,
    keySensitive: true,
    lens: [12, 16, 24],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.12, move: () => bringB(0, h(len, 0.55), 0.38) },
        { frac: 0.28, move: () => hpA(0, h(len, 0.45)) },
        { frac: 0.68, move: () => bringB(0, h(len, 0.32)) },
      ]),
  },
  {
    key: "filter-lp",
    name: "Low-Pass Dive",
    style: "Underwater low-pass exit",
    why: "Rolling Song A's low-pass down pulls it underwater as B rises \u2014 a smooth, moody hand-off.",
    energy: "smooth",
    vocalSafe: true,
    keySensitive: false,
    lens: [16, 24],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.1, move: () => bringB(0, h(len, 0.5), 0.35) },
        { frac: 0.32, move: () => lpA(0, h(len, 0.45)) },
        { frac: 0.72, move: () => bringB(0, h(len, 0.28)) },
      ]),
  },
  {
    key: "echo-slam",
    name: "Echo-Out Slam",
    style: "Delay throw into a hard slam",
    why: "Throwing Song A into an echo tail and slamming B in on the one is a classic crowd-popping moment.",
    energy: "slam",
    vocalSafe: true,
    keySensitive: false,
    lens: [8],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.1, move: () => bringB(0, h(len, 0.22), 0.32) },
        { frac: 0.38, minGap: 0.75, move: () => killBassA(0) },
        { frac: 0.48, move: () => echoA(0) },
        { frac: 0.62, move: () => restoreBassB(0) },
        { frac: 0.78, minGap: 1, move: () => slamB(0) },
      ]),
  },
  {
    key: "reverb-wash",
    name: "Reverb Wash",
    style: "Cathedral reverb bloom into the new track",
    why: "Drowning Song A in reverb as its bass cuts creates a huge breath of space before B lands clean.",
    energy: "smooth",
    vocalSafe: true,
    keySensitive: false,
    lens: [12, 16],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.15, move: () => bringB(0, h(len, 0.4), 0.38) },
        { frac: 0.38, minGap: 0.75, move: () => reverbA(0, h(len, 0.45)) },
        { frac: 0.52, move: () => killBassA(0) },
        { frac: 0.68, move: () => bringB(0, h(len, 0.32)) },
      ]),
  },
  {
    key: "double-drop",
    name: "Double-Drop Slam",
    style: "Both tracks hit the drop together",
    why: "Lining up both drops and slamming them together is the biggest moment in dance music; the bass-kill keeps it landing instead of mudding out.",
    energy: "slam",
    vocalSafe: false,
    keySensitive: true,
    lens: [12, 16],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.08, move: () => bringB(0, h(len, 0.18), 0.28) },
        { frac: 0.22, move: () => riserA(0, h(len, 0.35)) },
        { frac: 0.48, minGap: 0.75, move: () => killBassA(0) },
        { frac: 0.62, move: () => restoreBassB(0) },
        { frac: 0.82, minGap: 1, move: () => slamB(0) },
      ]),
  },
  {
    key: "tape-stop",
    name: "Tape-Stop Drop",
    style: "Power-down into a fresh slam",
    why: "A tape-stop sucks all the energy out for a split second, making the new track's drop hit twice as hard.",
    energy: "slam",
    vocalSafe: true,
    keySensitive: false,
    lens: [8],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.1, move: () => bringB(0, h(len, 0.2), 0.28) },
        { frac: 0.38, minGap: 0.75, move: () => killBassA(0) },
        { frac: 0.52, minGap: 1, move: () => brakeA(0) },
        { frac: 0.65, move: () => restoreBassB(0) },
        { frac: 0.78, minGap: 1, move: () => slamB(0) },
      ]),
  },
  {
    key: "spinback",
    name: "Spinback Cut",
    style: "Vinyl rewind into the next track",
    why: "A spinback is a cheeky rewind that screams 'here comes the next one' \u2014 instant hype.",
    energy: "slam",
    vocalSafe: true,
    keySensitive: false,
    lens: [4],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.42, minGap: 1, move: () => spinbackA(0) },
        { frac: 0.58, minGap: 1, move: () => cutB(0) },
      ]),
  },
  {
    key: "trance-gate",
    name: "Trance-Gate Blend",
    style: "Stuttered gate build into the blend",
    why: "Gating Song A into a rhythmic stutter builds tension while B slides in underneath \u2014 modern and punchy.",
    energy: "lift",
    vocalSafe: true,
    keySensitive: true,
    lens: [12, 16],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.12, move: () => bringB(0, h(len, 0.45), 0.38) },
        { frac: 0.32, minGap: 1, move: () => gateA(0, h(len, 0.35)) },
        { frac: 0.68, move: () => bringB(0, h(len, 0.32)) },
      ]),
  },
  {
    key: "gate-cut",
    name: "Gate Stutter Cut",
    style: "Chop to silence, then cut",
    why: "Stutter Song A down to nothing then cut straight to B \u2014 a sharp, energetic switch.",
    energy: "slam",
    vocalSafe: true,
    keySensitive: false,
    lens: [8],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.15, move: () => bringB(0, h(len, 0.25), 0.35) },
        { frac: 0.38, minGap: 1, move: () => gateA(0, h(len, 0.4)) },
        { frac: 0.62, minGap: 1, move: () => cutB(0) },
      ]),
  },
  {
    key: "tension-riser",
    name: "Tension Riser",
    style: "Filter riser into the breakdown swap",
    why: "Sweeping a filter up builds anticipation, then the bass-kill swap drops the crowd into the new groove.",
    energy: "lift",
    vocalSafe: true,
    keySensitive: true,
    lens: [16, 24],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.08, move: () => bringB(0, h(len, 0.4), 0.35) },
        { frac: 0.28, move: () => riserA(0, h(len, 0.4)) },
        { frac: 0.52, minGap: 0.75, move: () => killBassA(0) },
        { frac: 0.68, move: () => bringB(0, h(len, 0.32)) },
      ]),
  },
  {
    key: "vocal-tease",
    name: "Acapella Tease",
    style: "A's top end sings over B's groove",
    why: "Thinning Song A to just its tops lets the vocal/melody float over Song B's fresh beat before the full swap \u2014 a goosebumps moment.",
    energy: "smooth",
    vocalSafe: false,
    keySensitive: true,
    lens: [16, 24],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.1, move: () => bringB(0, h(len, 0.45), 0.48) },
        { frac: 0.32, move: () => hpA(0, h(len, 0.35)) },
        { frac: 0.48, minGap: 0.75, move: () => killBassA(0) },
        { frac: 0.72, move: () => bringB(0, h(len, 0.28)) },
      ]),
  },
  {
    key: "long-blend",
    name: "Long Groove Blend",
    style: "Patient 24-32 bar layering",
    why: "Two compatible grooves locked together over a long blend is peak-time DJ craft \u2014 the crowd barely notices the switch.",
    energy: "smooth",
    vocalSafe: true,
    keySensitive: true,
    lens: [24, 32],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.08, move: () => bringB(0, h(len, 0.55), 0.42) },
        { frac: 0.28, move: () => hpA(0, h(len, 0.35)) },
        { frac: 0.45, minGap: 0.75, move: () => killBassA(0) },
        { frac: 0.52, move: () => restoreBassB(0) },
        { frac: 0.78, move: () => bringB(0, h(len, 0.22)) },
      ]),
  },
  {
    key: "build-slam",
    name: "Build & Slam",
    style: "Gate + riser, then explosive slam",
    why: "Stacking a trance-gate and a filter riser maxes out tension before B slams in \u2014 a guaranteed hands-in-the-air payoff.",
    energy: "slam",
    vocalSafe: true,
    keySensitive: false,
    lens: [16],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.08, move: () => bringB(0, h(len, 0.2), 0.3) },
        { frac: 0.22, minGap: 1, move: () => gateA(0, h(len, 0.3)) },
        { frac: 0.35, move: () => riserA(0, h(len, 0.3)) },
        { frac: 0.52, minGap: 0.75, move: () => killBassA(0) },
        { frac: 0.65, move: () => restoreBassB(0) },
        { frac: 0.82, minGap: 1, move: () => slamB(0) },
      ]),
  },
  {
    key: "echo-gate",
    name: "Echo Gate Throw",
    style: "Gated echo throw into the switch",
    why: "Gating Song A then throwing it into echo leaves a rhythmic ghost as B takes over \u2014 textured and pro.",
    energy: "lift",
    vocalSafe: true,
    keySensitive: false,
    lens: [12],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.1, move: () => bringB(0, h(len, 0.2), 0.3) },
        { frac: 0.28, minGap: 1, move: () => gateA(0, h(len, 0.28)) },
        { frac: 0.42, minGap: 1, move: () => echoA(0) },
        { frac: 0.52, minGap: 0.75, move: () => killBassA(0) },
        { frac: 0.62, move: () => restoreBassB(0) },
        { frac: 0.78, minGap: 1, move: () => slamB(0) },
      ]),
  },
  {
    key: "eq-trade",
    name: "EQ Trade-Off",
    style: "Trade lows then tops, surgical",
    why: "Swapping the basslines first, then trading the top end, gives a phase-perfect blend with no frequency clash.",
    energy: "smooth",
    vocalSafe: true,
    keySensitive: true,
    lens: [16, 24],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.08, move: () => bringB(0, h(len, 0.45), 0.42) },
        { frac: 0.32, minGap: 0.75, move: () => killBassA(0) },
        { frac: 0.42, move: () => restoreBassB(0) },
        { frac: 0.58, move: () => hpA(0, h(len, 0.32)) },
        { frac: 0.78, move: () => bringB(0, h(len, 0.22)) },
      ]),
  },
  {
    key: "cut-on-drop",
    name: "Hard Cut on the Drop",
    style: "Fearless instant switch",
    why: "When both tracks are punchy and phrased, a clean cut exactly on the drop is the boldest, most effective move there is.",
    energy: "slam",
    vocalSafe: true,
    keySensitive: false,
    lens: [4],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.12, move: () => bringB(0, h(len, 0.22), 0.38) },
        { frac: 0.42, minGap: 0.75, move: () => killBassA(0) },
        { frac: 0.55, move: () => restoreBassB(0) },
        { frac: 0.72, minGap: 1, move: () => cutB(0) },
      ]),
  },
  {
    key: "stem-acapella",
    name: "True Acapella Overlay",
    style: "Real vocal stem floats over the new beat",
    why: "With GPU stems, Song A's actual vocal rides Song B's instrumental — a goosebumps moment impossible with EQ alone.",
    energy: "smooth",
    vocalSafe: false,
    keySensitive: true,
    lens: [16, 24],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.05, minGap: 1, move: () => instB(0) },
        { frac: 0.15, move: () => bringB(0, h(len, 0.32), 0.4) },
        { frac: 0.42, minGap: 1, move: () => acapellaA(0) },
        { frac: 0.58, minGap: 0.75, move: () => killBassA(0) },
        { frac: 0.78, move: () => bringB(0, h(len, 0.22)) },
      ]),
  },
  {
    key: "stem-drums-layer",
    name: "Drum Stem Layer",
    style: "B's drums lock in under A before the swap",
    why: "Isolating Song B's drum stem lets the new groove click in under Song A's melody before the full hand-off — surgical and huge.",
    energy: "lift",
    vocalSafe: true,
    keySensitive: true,
    lens: [12, 16],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.05, minGap: 1, move: () => drumsB(0) },
        { frac: 0.18, move: () => bringB(0, h(len, 0.32), 0.38) },
        { frac: 0.48, minGap: 0.75, move: () => killBassA(0) },
        { frac: 0.58, move: () => restoreBassB(0) },
        { frac: 0.78, move: () => bringB(0, h(len, 0.22)) },
      ]),
  },
  {
    key: "stem-bass-tease",
    name: "Bass Stem Tease",
    style: "Low-end preview before the swap",
    why: "Isolating B's bass stem lets the new groove's foundation click in under A before the full track lands — tight and surgical.",
    energy: "lift",
    vocalSafe: true,
    keySensitive: true,
    lens: [12, 16],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.05, minGap: 1, move: () => bassBStem(0) },
        { frac: 0.28, move: () => bringB(0, h(len, 0.4), 0.4) },
        { frac: 0.48, minGap: 0.75, move: () => killBassA(0) },
        { frac: 0.72, move: () => bringB(0, h(len, 0.28)) },
      ]),
  },
  {
    key: "stem-guitar-float",
    name: "Guitar Stem Float",
    style: "Melodic tease over the outgoing groove",
    why: "B's guitar stem rides above Song A like a live remix layer — melodic, airy, and impossible without stems.",
    energy: "smooth",
    vocalSafe: true,
    keySensitive: true,
    lens: [16, 24],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.05, minGap: 1, move: () => guitarB(0) },
        { frac: 0.12, move: () => bringB(0, h(len, 0.45), 0.35) },
        { frac: 0.42, move: () => hpA(0, h(len, 0.32)) },
        { frac: 0.68, move: () => bringB(0, h(len, 0.32)) },
      ]),
  },
  {
    key: "stem-piano-layer",
    name: "Piano Stem Layer",
    style: "Harmonic bed under the outgoing track",
    why: "B's piano stem adds harmonic colour under A before the hand-off — lush and festival-ready.",
    energy: "smooth",
    vocalSafe: true,
    keySensitive: true,
    lens: [16, 24],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.05, minGap: 1, move: () => pianoB(0) },
        { frac: 0.18, move: () => layerB(0, h(len, 0.32)) },
        { frac: 0.42, minGap: 1, move: () => acapellaA(0) },
        { frac: 0.78, move: () => bringB(0, h(len, 0.22)) },
      ]),
  },
  {
    key: "stem-vocal-guitar",
    name: "Vocal + Guitar Stem Ride",
    style: "Acapella floats over a guitar bed",
    why: "A's vocal stem over B's guitar is a goosebumps moment — two stems, one unforgettable blend.",
    energy: "lift",
    vocalSafe: false,
    keySensitive: true,
    lens: [16],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.05, minGap: 1, move: () => guitarB(0) },
        { frac: 0.12, move: () => bringB(0, h(len, 0.28), 0.35) },
        { frac: 0.38, minGap: 1, move: () => acapellaA(0) },
        { frac: 0.78, move: () => bringB(0, h(len, 0.22)) },
      ]),
  },
  {
    key: "stem-acapella-swap",
    name: "Acapella Crossfade",
    style: "Vocal hand-off over the incoming instrumental",
    why: "A's acapella rides B's instrumental, then B's vocal teases in — a true stem swap that hides BPM gaps.",
    energy: "smooth",
    vocalSafe: false,
    keySensitive: true,
    lens: [12, 16],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.05, minGap: 1, move: () => instB(0) },
        { frac: 0.12, move: () => bringB(0, h(len, 0.25), 0.38) },
        { frac: 0.35, minGap: 1, move: () => acapellaA(0) },
        { frac: 0.52, minGap: 1, move: () => noVocalsA(0) },
        { frac: 0.65, minGap: 1, move: () => acapellaB(0) },
        { frac: 0.82, move: () => bringB(0, h(len, 0.18)) },
      ]),
  },
  {
    key: "stem-instrumental-bridge",
    name: "Instrumental Bridge",
    style: "Melody-only bed into the new full mix",
    why: "Both instrumentals lock together without vocal clash — perfect when BPMs differ and stems are ready.",
    energy: "smooth",
    vocalSafe: true,
    keySensitive: false,
    lens: [12, 16],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.05, minGap: 1, move: () => instB(0) },
        { frac: 0.15, minGap: 1, move: () => noVocalsA(0) },
        { frac: 0.32, move: () => bringB(0, h(len, 0.4), 0.5) },
        { frac: 0.52, minGap: 1, move: () => echoA(0) },
        { frac: 0.72, move: () => bringB(0, h(len, 0.28)) },
      ]),
  },
  {
    key: "stem-drums-acapella",
    name: "Drums + Acapella Stack",
    style: "New groove under the outgoing vocal",
    why: "B's drums click in under A's isolated vocal before the full track lands — surgical and huge.",
    energy: "lift",
    vocalSafe: false,
    keySensitive: true,
    lens: [12, 16],
    build: (len) =>
      L(len, [
        { frac: 0, move: playB },
        { frac: 0.05, minGap: 1, move: () => drumsB(0) },
        { frac: 0.18, move: () => bringB(0, h(len, 0.28), 0.38) },
        { frac: 0.35, minGap: 1, move: () => acapellaA(0) },
        { frac: 0.52, minGap: 0.75, move: () => killBassA(0) },
        { frac: 0.78, move: () => bringB(0, h(len, 0.22)) },
      ]),
  },
];

function variantName(name: string, len: number, lens: number[]): string {
  if (lens.length < 2) return name;
  const tag = len <= 8 ? "Quick" : len >= 24 ? "Long" : "Classic";
  return `${name} (${tag})`;
}

function toRecipe(spec: TechSpec, len: number, cueOutA: number, cueInB: number): TransitionRecipe {
  const moves = spec.build(len).sort((a, b) => a.atBar - b.atBar);
  const rawSteps: TransitionStep[] = moves.map((m, i) => {
    const gesture = defaultGesture(m.action);
    return {
      index: i,
      atBar: m.atBar,
      action: m.action,
      verb: m.verb,
      gesture,
      dual: isDualGesture(gesture),
      instruction: instructionFor(gesture, m.verb),
    };
  });
  const steps = polishSteps(rawSteps, len);
  return {
    id: `${spec.key}-${len}`,
    name: variantName(spec.name, len, spec.lens),
    style: spec.style,
    why: spec.why,
    cueOutA,
    cueInB,
    bars: len,
    steps,
  };
}

// --- cue-point selection ---------------------------------------------------
export { chooseExit, chooseEntry } from "./variety";

function chooseDropEntry(b: TrackAnalysis): number {
  const drop = b.drops.find((d) => d > 4) ?? b.sections.find((s) => s.kind === "drop")?.start;
  return drop === undefined ? chooseEntry(b) : Math.max(0, drop - 16);
}

function keyCompatible(ka: string | null, kb: string | null): boolean {
  const pa = parseCamelot(ka);
  const pb = parseCamelot(kb);
  if (!pa || !pb) return false;
  if (pa.letter === pb.letter && circ(pa.num, pb.num) <= 1) return true;
  return pa.num === pb.num;
}

function parseCamelot(k: string | null): { num: number; letter: string } | null {
  if (!k) return null;
  const m = /^(\d{1,2})([AB])$/.exec(k.trim());
  return m ? { num: parseInt(m[1], 10), letter: m[2] } : null;
}

function circ(a: number, b: number): number {
  const d = Math.abs(a - b) % 12;
  return Math.min(d, 12 - d);
}

/** Rank how well this technique fits the pair — prioritises clean sound over gimmicks. */
function scoreTechnique(
  spec: TechSpec,
  len: number,
  ctx: { harmonic: boolean; bpmGap: number; vocalHeavy: boolean; stemsReady: boolean; blend: number },
): number {
  const isStem = spec.key.startsWith("stem-");
  let impact = 0.52;

  if (ctx.bpmGap <= 2) impact += 0.2;
  else if (ctx.bpmGap <= 4) impact += 0.14;
  else if (ctx.bpmGap <= 6) impact += 0.05;
  else if (ctx.bpmGap <= 8) impact -= 0.06;
  else impact -= 0.22;

  impact += (ctx.blend - 0.5) * 0.22;

  if (spec.keySensitive) impact += ctx.harmonic ? 0.18 : -0.22;
  else if (ctx.harmonic) impact += 0.07;

  if (spec.energy === "slam") {
    impact += ctx.bpmGap <= 3 ? 0.12 : ctx.bpmGap > 7 ? -0.24 : -0.08;
  }
  if (spec.energy === "smooth" || spec.energy === "lift") {
    impact += ctx.bpmGap <= 8 ? 0.1 : 0.04;
  }

  if (ctx.vocalHeavy) {
    if (spec.vocalSafe) impact += 0.1;
    else if (!isStem) impact -= 0.12;
  }

  if (isStem) {
    if (!ctx.stemsReady) return 0.12;
    impact -= 0.22;
    if (ctx.bpmGap > 6) impact -= 0.2;
    if (ctx.bpmGap > 10) impact -= 0.22;
    if (spec.key.includes("acapella") && ctx.vocalHeavy && ctx.bpmGap <= 5) impact += 0.14;
    if (!ctx.harmonic) impact -= 0.12;
    if (spec.key === "stem-drums-acapella" || spec.key === "stem-vocal-guitar") {
      impact += ctx.bpmGap <= 4 && ctx.harmonic ? 0.1 : -0.18;
    }
  } else {
    if (spec.key === "bass-swap" && ctx.bpmGap <= 6) impact += 0.16;
    if (spec.key === "filter-hp" || spec.key === "filter-lp") impact += ctx.bpmGap <= 8 ? 0.1 : 0;
    if (spec.key === "long-blend" && ctx.bpmGap > 4) impact += 0.12;
    if (spec.key === "echo-slam" || spec.key === "echo-gate") impact += ctx.vocalHeavy ? 0.08 : 0.04;
    if (spec.key === "remix-layer" && ctx.harmonic) impact += 0.1;
    if (ctx.stemsReady && ctx.bpmGap > 9) impact += 0.14;
  }

  if (len >= 16 && spec.energy === "smooth") impact += 0.05;
  if (len <= 8 && spec.energy === "slam" && ctx.bpmGap <= 4) impact += 0.05;

  impact += (Math.random() - 0.5) * 0.06;
  return Math.max(0.12, Math.min(0.96, impact));
}

/** Non-stem blends always sort above stem moves in the suggestion list. */
export function compareSuggestionRank(
  a: { impact: number; recipe: TransitionRecipe },
  b: { impact: number; recipe: TransitionRecipe },
): number {
  const aStem = recipeUsesStems(a.recipe);
  const bStem = recipeUsesStems(b.recipe);
  if (aStem !== bStem) return aStem ? 1 : -1;
  return b.impact - a.impact;
}

/**
 * Build the full catalog ranked for this pairing. Returns 30+ suggestions so
 * the user always has a big, fresh menu to choose from.
 */
export function buildLibrarySuggestions(
  a: TrackAnalysis,
  b: TrackAnalysis,
  opts: { stemsA?: boolean; stemsB?: boolean } = {},
): CopilotResponse {
  const dropEntry = chooseDropEntry(b);
  const dropB =
    b.drops.find((d) => d > 4) ?? b.sections.find((s) => s.kind === "drop")?.start ?? chooseEntry(b);
  const harmonic = keyCompatible(a.camelotKey, b.camelotKey);
  const bpmGap = Math.abs(a.bpm - b.bpm);
  const blend = blendQuality(a.bpm, b.bpm);
  const vocalHeavy = (a.vocalProbability + b.vocalProbability) / 2 > 0.5;
  const stemsReady = Boolean(opts.stemsA && opts.stemsB);

  const suggestions = TECHNIQUES.flatMap((spec) =>
    spec.lens.map((len) => {
      const isDoubleDrop = spec.key === "double-drop";
      const isSlamMove = spec.energy === "slam";
      let cueOutA = snapToDownbeat(chooseExit(a), a.bpm, a.beatOffset);
      let cueInB = snapToDownbeat(chooseEntry(b), b.bpm, b.beatOffset);

      if (isDoubleDrop) {
        const pair = chooseDoubleDropCues(
          cueOutA,
          a.bpm,
          a.beatOffset,
          dropB,
          b.bpm,
          b.beatOffset,
          len,
        );
        cueOutA = pair.cueOutA;
        cueInB = pair.cueInB;
      } else if (isSlamMove) {
        cueInB = snapToDownbeat(dropEntry, b.bpm, b.beatOffset);
      }

      const recipe = toRecipe(spec, len, cueOutA, cueInB);
      const impact = scoreTechnique(spec, len, { harmonic, bpmGap, vocalHeavy, stemsReady, blend });
      return { impact, recipe };
    }),
  ).sort(compareSuggestionRank);

  const stemNote = stemsReady
    ? "Standard blends are recommended — stem transitions are experimental and listed below."
    : "Separate stems on both decks to unlock stem moves (experimental, listed below standard blends).";

  return {
    suggestions,
    notes: harmonic
      ? `${stemNote} Keys are compatible — harmonic blends will sound especially clean.`
      : `${stemNote} Keys may clash and BPMs differ by ${bpmGap}; stem moves and FX throws keep it tight without tempo warping.`,
  };
}

/** True when a recipe uses separated stems (acapella swap, drum layer, etc.). */
export function recipeUsesStems(recipe: TransitionRecipe): boolean {
  return recipe.steps.some((s) => s.action.type === "stemPreset");
}

/** True when a recipe uses drop slams (double-drop, echo slam, etc.). */
export function recipeUsesSlam(recipe: TransitionRecipe): boolean {
  return recipe.steps.some((s) => s.action.type === "slam");
}
