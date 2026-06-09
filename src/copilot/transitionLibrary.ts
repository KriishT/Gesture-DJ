import type {
  CopilotResponse,
  StepAction,
  TrackAnalysis,
  TransitionRecipe,
  TransitionStep,
} from "./recipeTypes";
import { defaultGesture, instructionFor, isDualGesture } from "./choreography";
import { chooseDoubleDropCues, snapToDownbeat } from "../audio/beatAlign";

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
    build: (len) => [playB(), bringB(h(len, 0.15), h(len, 0.35), 0.48), killBassA(h(len, 0.5)), restoreBassB(h(len, 0.52)), bringB(h(len, 0.78), h(len, 0.22))],
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
    build: (len) => [playB(), layerB(0, h(len, 0.7)), killBassA(h(len, 0.4)), restoreBassB(h(len, 0.4)), bringB(h(len, 0.7), len)],
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
    build: (len) => [playB(), hpA(0, len), bringB(h(len, 0.25), len), bringB(h(len, 0.75), len)],
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
    build: (len) => [playB(), bringB(0, len), lpA(h(len, 0.25), len), bringB(h(len, 0.8), len)],
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
    build: (len) => [
      playB(),
      bringB(h(len, 0.15), h(len, 0.25), 0.35),
      echoA(h(len, 0.55)),
      killBassA(h(len, 0.5)),
      restoreBassB(h(len, 0.65)),
      slamB(h(len, 0.78)),
    ],
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
    build: (len) => [playB(), reverbA(h(len, 0.4), h(len, 0.5)), killBassA(h(len, 0.5)), bringB(h(len, 0.6), len)],
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
    build: (len) => [
      playB(),
      bringB(h(len, 0.1), h(len, 0.2), 0.32),
      riserA(h(len, 0.22), h(len, 0.38)),
      killBassA(h(len, 0.52)),
      restoreBassB(h(len, 0.72)),
      slamB(h(len, 0.88)),
    ],
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
    build: (len) => [
      playB(),
      bringB(h(len, 0.12), h(len, 0.2), 0.3),
      killBassA(h(len, 0.45)),
      brakeA(h(len, 0.58)),
      restoreBassB(h(len, 0.72)),
      slamB(h(len, 0.82)),
    ],
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
    build: (len) => [playB(), spinbackA(h(len, 0.5)), cutB(h(len, 0.6))],
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
    build: (len) => [playB(), gateA(h(len, 0.4), h(len, 0.4)), bringB(h(len, 0.3), len), bringB(h(len, 0.8), len)],
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
    build: (len) => [playB(), gateA(h(len, 0.4), h(len, 0.5)), cutB(h(len, 0.7))],
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
    build: (len) => [playB(), riserA(0, h(len, 0.6)), killBassA(h(len, 0.55)), bringB(h(len, 0.6), len)],
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
    build: (len) => [playB(), bringB(0, len, 0.6), hpA(h(len, 0.3), h(len, 0.5)), killBassA(h(len, 0.55)), bringB(h(len, 0.8), len)],
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
    build: (len) => [playB(), bringB(0, len, 0.5), hpA(h(len, 0.3), h(len, 0.4)), killBassA(h(len, 0.5)), restoreBassB(h(len, 0.5)), bringB(h(len, 0.8), len)],
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
    build: (len) => [
      playB(),
      bringB(h(len, 0.12), h(len, 0.22), 0.35),
      gateA(h(len, 0.28), h(len, 0.35)),
      riserA(h(len, 0.35), h(len, 0.35)),
      killBassA(h(len, 0.58)),
      restoreBassB(h(len, 0.72)),
      slamB(h(len, 0.85)),
    ],
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
    build: (len) => [
      playB(),
      bringB(h(len, 0.12), h(len, 0.22), 0.32),
      gateA(h(len, 0.25), h(len, 0.3)),
      echoA(h(len, 0.48)),
      killBassA(h(len, 0.52)),
      restoreBassB(h(len, 0.65)),
      slamB(h(len, 0.78)),
    ],
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
    build: (len) => [playB(), bringB(0, len, 0.5), killBassA(h(len, 0.35)), restoreBassB(h(len, 0.35)), hpA(h(len, 0.6), h(len, 0.4)), bringB(h(len, 0.85), len)],
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
    build: (len) => [
      playB(),
      bringB(h(len, 0.15), h(len, 0.25), 0.4),
      killBassA(h(len, 0.5)),
      restoreBassB(h(len, 0.62)),
      cutB(h(len, 0.75)),
    ],
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
    build: (len) => [
      playB(),
      instB(0),
      bringB(h(len, 0.15), h(len, 0.35), 0.45),
      acapellaA(h(len, 0.45)),
      killBassA(h(len, 0.62)),
      bringB(h(len, 0.82), h(len, 0.18)),
    ],
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
    build: (len) => [
      playB(),
      drumsB(0),
      bringB(h(len, 0.2), h(len, 0.35), 0.42),
      killBassA(h(len, 0.52)),
      restoreBassB(h(len, 0.58)),
      bringB(h(len, 0.82), h(len, 0.18)),
    ],
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
    build: (len) => [
      playB(),
      bassBStem(0),
      bringB(h(len, 0.35), len, 0.45),
      killBassA(h(len, 0.5)),
      bringB(h(len, 0.75), len),
    ],
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
    build: (len) => [
      playB(),
      guitarB(0),
      bringB(0, len, 0.4),
      hpA(h(len, 0.45), h(len, 0.35)),
      bringB(h(len, 0.7), len),
    ],
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
    build: (len) => [
      playB(),
      pianoB(0),
      layerB(h(len, 0.2), h(len, 0.35)),
      acapellaA(h(len, 0.45)),
      bringB(h(len, 0.82), h(len, 0.18)),
    ],
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
    build: (len) => [
      playB(),
      guitarB(0),
      bringB(h(len, 0.15), h(len, 0.3), 0.38),
      acapellaA(h(len, 0.42)),
      bringB(h(len, 0.82), h(len, 0.18)),
    ],
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
    build: (len) => [
      playB(),
      instB(0),
      bringB(h(len, 0.12), h(len, 0.28), 0.42),
      acapellaA(h(len, 0.38)),
      noVocalsA(h(len, 0.58)),
      acapellaB(h(len, 0.68)),
      bringB(h(len, 0.85), h(len, 0.15)),
    ],
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
    build: (len) => [
      playB(),
      instB(0),
      noVocalsA(h(len, 0.15)),
      bringB(h(len, 0.35), len, 0.55),
      echoA(h(len, 0.55)),
      bringB(h(len, 0.75), len),
    ],
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
    build: (len) => [
      playB(),
      drumsB(0),
      bringB(h(len, 0.2), h(len, 0.3), 0.42),
      acapellaA(h(len, 0.38)),
      killBassA(h(len, 0.55)),
      bringB(h(len, 0.82), h(len, 0.18)),
    ],
  },
];

function variantName(name: string, len: number, lens: number[]): string {
  if (lens.length < 2) return name;
  const tag = len <= 8 ? "Quick" : len >= 24 ? "Long" : "Classic";
  return `${name} (${tag})`;
}

function toRecipe(spec: TechSpec, len: number, cueOutA: number, cueInB: number): TransitionRecipe {
  const moves = spec.build(len).sort((a, b) => a.atBar - b.atBar);
  const steps: TransitionStep[] = moves.map((m, i) => {
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
export function chooseExit(a: TrackAnalysis): number {
  const lateDrop = a.drops.filter((d) => d > a.durationSec * 0.4).pop();
  if (lateDrop) return lateDrop;
  const bd = a.sections.find(
    (s) => s.start > a.durationSec * 0.5 && (s.kind === "breakdown" || s.kind === "outro"),
  );
  if (bd) return bd.start;
  return Math.max(8, a.durationSec * 0.6);
}

export function chooseEntry(b: TrackAnalysis): number {
  const firstDrop = b.drops[0];
  const build = b.sections.find((s) => s.kind === "build" || s.kind === "drop");
  return Math.max(0, firstDrop ?? build?.start ?? 0);
}

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

/**
 * Build the full catalog ranked for this pairing. Returns 30+ suggestions so
 * the user always has a big, fresh menu to choose from.
 */
export function buildLibrarySuggestions(
  a: TrackAnalysis,
  b: TrackAnalysis,
  opts: { stemsA?: boolean; stemsB?: boolean } = {},
): CopilotResponse {
  const cueOutRaw = chooseExit(a);
  const cueInRaw = chooseEntry(b);
  const dropEntry = chooseDropEntry(b);
  const dropB =
    b.drops.find((d) => d > 4) ?? b.sections.find((s) => s.kind === "drop")?.start ?? cueInRaw;
  const harmonic = keyCompatible(a.camelotKey, b.camelotKey);
  const bpmGap = Math.abs(a.bpm - b.bpm);
  const vocalHeavy = (a.vocalProbability + b.vocalProbability) / 2 > 0.5;
  const stemsReady = Boolean(opts.stemsA && opts.stemsB);

  const suggestions = TECHNIQUES.flatMap((spec) =>
    spec.lens.map((len) => {
      const isDoubleDrop = spec.key === "double-drop";
      const isSlamMove = spec.energy === "slam";
      let cueOutA = snapToDownbeat(cueOutRaw, a.bpm, a.beatOffset);
      let cueInB = snapToDownbeat(cueInRaw, b.bpm, b.beatOffset);

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
      const isStem = spec.key.startsWith("stem-");

      let impact = 0.6;
      if (isStem) {
        impact += stemsReady ? 0.38 : -0.45;
        if (bpmGap > 6 && stemsReady) impact += 0.12;
      }
      if (spec.keySensitive) impact += harmonic ? 0.22 : -0.12;
      if (spec.energy === "slam") impact += bpmGap <= 4 ? 0.12 : bpmGap > 8 ? -0.18 : -0.04;
      if (spec.energy === "smooth") impact += bpmGap > 6 ? 0.14 : 0.04;
      if (!spec.vocalSafe && vocalHeavy && !isStem) impact -= 0.12;
      if (spec.vocalSafe && vocalHeavy) impact += 0.06;
      if (stemsReady && spec.key === "bass-swap" && bpmGap > 8) impact -= 0.08;
      impact += (len >= 16 ? 0.03 : 0) - Math.random() * 0.04;
      return { impact: Math.max(0.2, Math.min(0.98, impact)), recipe };
    }),
  ).sort((x, y) => y.impact - x.impact);

  const stemNote = stemsReady
    ? "Stems ready — vocal & rhythm stems auto-sync to the other deck's beat (pitch-locked)."
    : "Separate stems on both decks to unlock beat-synced acapella overlays and stem swaps.";

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
