export interface GestureDoc {
  id: string;
  title: string;
  hand: "left" | "right" | "both";
  description: string;
  controls: string;
}

export interface SoloTransitionExample {
  name: string;
  vibe: string;
  steps: string[];
}

/** Solo mode gesture vocabulary — fixed mapping, never randomized. */
export const GESTURE_DOCS: GestureDoc[] = [
  {
    id: "openPalm",
    title: "Open palm + move up/down",
    hand: "both",
    description: "Open hand, raise to turn that deck up, lower to turn it down.",
    controls: "Volume",
  },
  {
    id: "pinch",
    title: "Pinch + move up/down",
    hand: "both",
    description: "Pinch thumb + index. Move up = high-pass (thin). Move down = low-pass (muffled).",
    controls: "Filter",
  },
  {
    id: "fist",
    title: "Make a fist (one hand)",
    hand: "both",
    description: "Close one hand to kill that deck's bass. Open to restore.",
    controls: "Bass kill",
  },
  {
    id: "bothFist",
    title: "Both fists",
    hand: "both",
    description: "Close BOTH hands to kill bass on both decks at once — clean swap setup.",
    controls: "Dual bass kill",
  },
  {
    id: "point",
    title: "Point index finger",
    hand: "both",
    description: "Point up to play or pause that deck.",
    controls: "Play / pause",
  },
  {
    id: "peace",
    title: "Peace sign + swipe sideways",
    hand: "both",
    description: "Hold two fingers up and swipe to scratch/jog that deck.",
    controls: "Scratch",
  },
  {
    id: "handsApart",
    title: "Both open palms spread apart",
    hand: "both",
    description: "Open BOTH hands and pull them apart to crossfade from Deck A toward Deck B.",
    controls: "Crossfader",
  },
  {
    id: "handsTogether",
    title: "Both hands close together",
    hand: "both",
    description: "Bring both hands toward center to pull the crossfader back to the middle.",
    controls: "Crossfader center",
  },
  {
    id: "bothHandsRise",
    title: "Both hands rise together",
    hand: "both",
    description: "Lift both open hands to build energy on both decks before a drop or slam.",
    controls: "Energy build",
  },
];

/** Popular solo transitions with example gesture sequences. */
export const SOLO_TRANSITION_EXAMPLES: SoloTransitionExample[] = [
  {
    name: "Classic Bass Swap",
    vibe: "Tight club hand-off",
    steps: [
      "Right open palm up → start Deck B underneath (low in mix)",
      "Both hands spread apart → open the crossfader toward B",
      "Left fist → cut Deck A's bass",
      "Right open palm up → bring Deck B's bass back",
      "Left palm down → fade Deck A out via crossfader",
    ],
  },
  {
    name: "Filter Fade Blend",
    vibe: "Smooth hypnotic wash",
    steps: [
      "Right palm up → bring Deck B in quietly",
      "Left pinch + move up → high-pass filter on Deck A",
      "Both hands spread → crossfade toward B over 8 bars",
      "Left palm down → finish fading A out",
    ],
  },
  {
    name: "Echo-Out Slam",
    vibe: "Dramatic throw",
    steps: [
      "Right point → start Deck B cued",
      "Tap ECHO on Deck A (or left fist hold) → throw A into delay",
      "Both hands spread fast → slam crossfader to B",
    ],
  },
  {
    name: "Tape-Stop Drop",
    vibe: "Power-down into slam",
    steps: [
      "Right palm up → start B's build underneath",
      "Tap BRAKE on Deck A → tape-stop A to silence",
      "Both hands spread → slam B in on the drop",
    ],
  },
  {
    name: "Acapella Tease (stems)",
    vibe: "Vocal floats over new beat",
    steps: [
      "Right palm up → bring B's instrumental in",
      "Tap ACA preset on Deck A → isolate A's vocal stem",
      "Both hands spread → blend while vocal rides the new groove",
      "Left fist → cut A's bass (already gone on acapella)",
      "Crossfader full to B + FULL preset on A off",
    ],
  },
  {
    name: "Loop Roll Exit",
    vibe: "Stutter then switch",
    steps: [
      "Tap LOOP 4 on Deck A → catch a phrase",
      "Right point → start Deck B",
      "Tap GATE on Deck A → stutter A out",
      "Both hands spread → cut to B",
    ],
  },
  {
    name: "Spinback Cut",
    vibe: "Cheeky rewind",
    steps: [
      "Right point → cue Deck B ready",
      "Tap SPIN on Deck A → vinyl rewind effect",
      "Both fists briefly → kill both basses",
      "Both hands spread → hard cut to B",
    ],
  },
];

export interface ControlConfig {
  moveThreshold: number;
  velocityThreshold: number;
  fistOpenness: number;
  pinchOn: number;
  openPalm: number;
}

export const DEFAULT_CONTROL: ControlConfig = {
  moveThreshold: 0.1,
  velocityThreshold: 0.38,
  fistOpenness: 0.22,
  pinchOn: 0.52,
  openPalm: 0.42,
};
