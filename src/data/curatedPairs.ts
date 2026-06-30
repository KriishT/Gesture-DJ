export type PairMode = "transition" | "remix" | "both";

export interface CuratedPair {
  id: string;
  deckA: { title: string; artist: string };
  deckB: { title: string; artist: string };
  genres: string;
  mode: PairMode;
  why: string;
  /** Approx BPM — helps you sanity-check after load. */
  bpmHint: { a: number; b: number };
  transitions: string[];
  remixTip?: string;
  stemsRecommended: boolean;
  difficulty: "easy" | "medium" | "bold";
}

/**
 * Curated pair ideas — load your own audio files matching these titles.
 * We cannot ship copyrighted music; this is a DJ cheat sheet baked into the app.
 */
export const CURATED_PAIRS: CuratedPair[] = [
  {
    id: "house-classics",
    deckA: { title: "Show Me Love", artist: "Robin S" },
    deckB: { title: "Gypsy Woman", artist: "Crystal Waters" },
    genres: "90s house → vocal house",
    mode: "both",
    why: "Same era and pocket (~124 BPM). Keys sit close on the Camelot wheel — long blends feel effortless.",
    bpmHint: { a: 124, b: 124 },
    transitions: ["Bass Swap", "Long Groove Blend", "High-Pass Lift"],
    remixTip: "Strip A to acapella over B's instrumental for a live-edit feel.",
    stemsRecommended: false,
    difficulty: "easy",
  },
  {
    id: "levels-good-feeling",
    deckA: { title: "Levels", artist: "Avicii" },
    deckB: { title: "Good Feeling", artist: "Flo Rida" },
    genres: "EDM anthem → pop-rap banger",
    mode: "transition",
    why: "Same Etta James sample DNA. Crowd knows both drops — slam moves land huge.",
    bpmHint: { a: 126, b: 128 },
    transitions: ["Echo-Out Slam", "Double-Drop Slam", "Hard Cut on the Drop"],
    stemsRecommended: false,
    difficulty: "easy",
  },
  {
    id: "daft-punk",
    deckA: { title: "One More Time", artist: "Daft Punk" },
    deckB: { title: "Around the World", artist: "Daft Punk" },
    genres: "French house → filter house",
    mode: "both",
    why: "Same producers, same groove language (~121 BPM). Filter sweeps and patient layering sound intentional.",
    bpmHint: { a: 123, b: 121 },
    transitions: ["Remix Layer", "Filter High-Pass Lift", "EQ Trade-Off"],
    remixTip: "Vocal tease from A over B's loop — feels like a secret Daft Punk set.",
    stemsRecommended: true,
    difficulty: "easy",
  },
  {
    id: "one-dance-latch",
    deckA: { title: "One Dance", artist: "Drake" },
    deckB: { title: "Latch", artist: "Disclosure ft. Sam Smith" },
    genres: "dancehall-pop → UK garage",
    mode: "remix",
    why: "Warm, syncopated vocals over a faster garage bed — classic remix energy without feeling forced.",
    bpmHint: { a: 104, b: 122 },
    transitions: ["True Acapella Overlay", "Instrumental Bridge"],
    remixTip: "Best in Remix workspace: A vocal over B instrumental, then morph to full Latch.",
    stemsRecommended: true,
    difficulty: "medium",
  },
  {
    id: "disco-afrobeats",
    deckA: { title: "I Feel Love", artist: "Donna Summer" },
    deckB: { title: "Last Last", artist: "Burna Boy" },
    genres: "disco → afrobeats",
    mode: "both",
    why: "Hypnotic four-on-the-floor meets afro swing. Big BPM gap — stems or FX throws keep it tight.",
    bpmHint: { a: 128, b: 100 },
    transitions: ["Reverb Wash", "Drums + Acapella Stack", "Echo-Out Slam"],
    remixTip: "Donna vocal stem riding Burna's drums is a festival moment.",
    stemsRecommended: true,
    difficulty: "bold",
  },
  {
    id: "get-lucky-blinding",
    deckA: { title: "Get Lucky", artist: "Daft Punk ft. Pharrell" },
    deckB: { title: "Blinding Lights", artist: "The Weeknd" },
    genres: "disco-funk → synth-pop",
    mode: "both",
    why: "Funk pocket into 80s synth hook. Contrast is the point — tease bass stem then slam the drop.",
    bpmHint: { a: 116, b: 171 },
    transitions: ["Bass Stem Tease", "Tape-Stop Drop", "Build & Slam"],
    remixTip: "Use stems: guitar/bass tease from A, then Weeknd chorus as the payoff.",
    stemsRecommended: true,
    difficulty: "bold",
  },
  {
    id: "adele-lizzo",
    deckA: { title: "Rolling in the Deep", artist: "Adele" },
    deckB: { title: "About Damn Time", artist: "Lizzo" },
    genres: "soul-pop → disco-funk",
    mode: "remix",
    why: "Two iconic vocal performances. Acapella overlay hides tempo differences — goosebumps if stems are ready.",
    bpmHint: { a: 105, b: 109 },
    transitions: ["True Acapella Overlay", "Acapella Crossfade", "Piano Stem Layer"],
    remixTip: "Remix mode: Adele vocal over Lizzo groove, then hand off on the hook.",
    stemsRecommended: true,
    difficulty: "medium",
  },
  {
    id: "brightside-feel-close",
    deckA: { title: "Mr. Brightside", artist: "The Killers" },
    deckB: { title: "Feel So Close", artist: "Calvin Harris" },
    genres: "indie rock → progressive house",
    mode: "both",
    why: "Rock anthem energy into festival house. Guitar stem float or filter wash sells the genre jump.",
    bpmHint: { a: 148, b: 128 },
    transitions: ["Guitar Stem Float", "High-Pass Lift", "Echo Gate Throw"],
    remixTip: "Brightside melody over Feel So Close kick — then full swap on the drop.",
    stemsRecommended: true,
    difficulty: "medium",
  },
];

export const PAIRS_BY_MODE = {
  transition: CURATED_PAIRS.filter((p) => p.mode === "transition" || p.mode === "both"),
  remix: CURATED_PAIRS.filter((p) => p.mode === "remix" || p.mode === "both"),
};
