import { create } from "zustand";
import { AudioEngine } from "../audio/AudioEngine";
import { BeatClock } from "../audio/BeatClock";
import { detectBeat } from "../audio/bpm";
import { computeTransitionSyncRatio } from "../audio/syncRatio";
import type { EqValues, DeckId as AudioDeckId } from "../audio/Deck";
import { analyzeTrack } from "../copilot/trackAnalysis";
import type { StemBackendInfo, StemBackendMode } from "../stems/types";
import {
  separateStems,
  loadStemBackendMode,
  saveStemBackendMode,
  probeStemsBackend,
  type StemName,
  STEM_NAMES,
} from "../stems/client";
import type {
  DeckState,
  GestureState,
  HandState,
  Mode,
  PadMode,
  WorkspaceMode,
} from "./types";
import { defaultStemLevels } from "./types";
import { session } from "../session";

export type DeckId = AudioDeckId;

let engine: AudioEngine | null = null;
const beatClocks: Record<DeckId, BeatClock | null> = { A: null, B: null };

export function getEngine(): AudioEngine {
  if (!engine) engine = new AudioEngine();
  return engine;
}

export function getBeatClock(id: DeckId): BeatClock | null {
  return beatClocks[id];
}

const emptyHand = (): HandState => ({
  detected: false,
  x: 0.5,
  y: 0.5,
  gesture: "none",
  openness: 1,
});

const initialDeck = (id: DeckId): DeckState => ({
  id,
  fileName: null,
  hasTrack: false,
  playing: false,
  position: 0,
  duration: 0,
  bpm: 0,
  beatOffset: 0,
  volume: 1,
  filter: 0,
  eq: { low: 0, mid: 0, high: 0 },
  rate: 1,
  keyLock: false,
  loading: false,
  analysis: null,
  cuePoint: 0,
  peaks: [],
  bassKill: false,
  echoOn: false,
  reverbOn: false,
  cues: [-1, -1, -1, -1],
  loopBeats: 0,
  stemsStatus: "idle",
  stemsProgress: 0,
  stemsElapsedSec: null,
  stemsGpu: null,
  stemsError: null,
  stemPreset: "full",
  stemLevels: defaultStemLevels(),
  channelLevel: 0,
});

/** Downsample an AudioBuffer to ~600 peak values for waveform rendering. */
function computePeaks(buffer: AudioBuffer, buckets = 600): number[] {
  const data = buffer.getChannelData(0);
  const block = Math.floor(data.length / buckets) || 1;
  const peaks: number[] = [];
  let max = 1e-6;
  for (let i = 0; i < buckets; i++) {
    let peak = 0;
    const start = i * block;
    for (let j = 0; j < block; j++) {
      const v = Math.abs(data[start + j] ?? 0);
      if (v > peak) peak = v;
    }
    peaks.push(peak);
    if (peak > max) max = peak;
  }
  return peaks.map((p) => p / max);
}

interface AppState {
  initialized: boolean;
  decks: Record<DeckId, DeckState>;
  crossfader: number;
  masterVolume: number;
  masterLevel: number;
  deckLevelA: number;
  deckLevelB: number;
  quantize: boolean;
  slipMode: boolean;
  padMode: PadMode;
  mode: Mode;
  workspace: WorkspaceMode;
  gesture: GestureState;
  showGuide: boolean;
  /** Active demo folder id (e.g. "set 1") for playbook hints. */
  activeDemoSetId: string | null;
  stemBackendMode: StemBackendMode;
  stemBackendInfo: StemBackendInfo | null;

  init: () => Promise<void>;
  loadFile: (id: DeckId, file: File) => Promise<void>;
  /** Load deck A + B together — parallel decode so one track never blocks the other. */
  loadPairToDecks: (fileA: File, fileB: File) => Promise<void>;
  togglePlay: (id: DeckId) => void;
  setVolume: (id: DeckId, v: number) => void;
  setFilter: (id: DeckId, v: number) => void;
  setEq: (id: DeckId, eq: Partial<EqValues>) => void;
  setRate: (id: DeckId, rate: number) => void;
  seek: (id: DeckId, pos: number) => void;
  setCrossfader: (v: number) => void;
  setMasterVolume: (v: number) => void;
  setQuantize: (v: boolean) => void;
  setSlipMode: (v: boolean) => void;
  setPadMode: (m: PadMode) => void;
  toggleBassKill: (id: DeckId) => void;
  toggleEcho: (id: DeckId) => void;
  toggleReverb: (id: DeckId) => void;
  syncDeck: (id: DeckId) => void;
  commitTransitionComplete: () => void;
  syncAfterTransitionAbort: () => void;
  syncDecksFromEngine: () => void;
  commitRemixMorph: () => void;
  setWorkspace: (w: WorkspaceMode) => void;
  setCue: (id: DeckId, idx: number) => void;
  jumpCue: (id: DeckId, idx: number) => void;
  toggleLoop: (id: DeckId, beats: number) => void;
  deckBrake: (id: DeckId) => void;
  deckSpinback: (id: DeckId) => void;
  deckGate: (id: DeckId) => void;
  setStemPreset: (id: DeckId, preset: DeckState["stemPreset"]) => void;
  toggleStem: (id: DeckId, stem: StemName) => void;
  setMode: (m: Mode) => void;
  setShowGuide: (v: boolean) => void;
  setActiveDemoSetId: (id: string | null) => void;
  setStemBackendMode: (mode: StemBackendMode) => void;
  refreshStemBackendInfo: () => Promise<void>;
  retryStems: (id: DeckId) => void;

  setGestureStatus: (s: GestureState["status"], err?: string) => void;
  setGestureEnabled: (v: boolean) => void;
  updateHands: (left: HandState, right: HandState) => void;
  setCalibrated: (v: boolean) => void;

  // Internal: called by the RAF loop
  _tick: () => void;
}

export const useStore = create<AppState>((set, get) => {
  let loadGen = 0;
  const stemSourceFiles: Partial<Record<DeckId, File>> = {};

  const startStemSeparation = (id: DeckId, file: File, gen: number) => {
    stemSourceFiles[id] = file;
    const backend = get().stemBackendMode;
    set((s) => ({
      decks: {
        ...s.decks,
        [id]: { ...s.decks[id], stemsStatus: "processing", stemsProgress: 0, stemsGpu: null, stemsError: null },
      },
    }));
    separateStems(
      file,
      backend,
      (st) => {
      if (gen !== loadGen) return;
      set((s) => ({
        decks: {
          ...s.decks,
          [id]: {
            ...s.decks[id],
            stemsProgress: st.progress,
            stemsElapsedSec: st.elapsedSec ?? null,
            stemsGpu: st.gpu ?? null,
          },
        },
      }));
    })
      .then(async (result) => {
        if (gen !== loadGen) return;
        const eng = getEngine();
        const stemBuffers: Partial<Record<StemName, AudioBuffer>> = {};
        for (const name of STEM_NAMES) {
          const ab = result.stems[name];
          if (ab) stemBuffers[name] = await eng.decode(ab.slice(0));
        }
        eng.deck(id).loadStems(stemBuffers);
        set((s) => ({
          decks: {
            ...s.decks,
            [id]: {
              ...s.decks[id],
              stemsStatus: "ready",
              stemsProgress: 1,
              stemsElapsedSec: result.elapsedSec,
              stemsGpu: result.gpu ?? null,
              stemLevels: defaultStemLevels(),
            },
          },
        }));
      })
      .catch((err) => {
        if (gen !== loadGen) return;
        const msg = err instanceof Error ? err.message : String(err);
        const unavailable = msg.includes("CUDA") || msg.includes("Python");
        set((s) => ({
          decks: {
            ...s.decks,
            [id]: {
              ...s.decks[id],
              stemsStatus: unavailable ? "unavailable" : "error",
              stemsError: msg,
            },
          },
        }));
      });
  };

  const commitLoadedDeck = (
    id: DeckId,
    file: File,
    audioBuffer: AudioBuffer,
    beat: { bpm: number; offset: number },
    gen: number,
  ) => {
    const eng = getEngine();
    beatClocks[id] = new BeatClock(beat, () => eng.deck(id).position);
    const peaks = computePeaks(audioBuffer);
    set((s) => ({
      decks: {
        ...s.decks,
        [id]: {
          ...s.decks[id],
          hasTrack: true,
          loading: false,
          duration: audioBuffer.duration,
          bpm: beat.bpm,
          beatOffset: beat.offset,
          playing: false,
          position: 0,
          cuePoint: 0,
          peaks,
        },
      },
    }));
    analyzeTrack(audioBuffer, file.name, beat)
      .then((analysis) => {
        if (gen !== loadGen) return;
        set((s) => ({
          decks: { ...s.decks, [id]: { ...s.decks[id], analysis } },
        }));
      })
      .catch(() => {
        /* analysis is best-effort */
      });
    startStemSeparation(id, file, gen);
  };

  const ingestOneTrack = async (id: DeckId, file: File, gen: number): Promise<void> => {
    const eng = getEngine();
    const arrayBuffer = await file.arrayBuffer();
    if (gen !== loadGen) return;
    const audioBuffer = await eng.decode(arrayBuffer.slice(0));
    if (gen !== loadGen) return;
    eng.deck(id).loadBuffer(audioBuffer);
    const beat = await detectBeat(audioBuffer);
    if (gen !== loadGen) return;
    commitLoadedDeck(id, file, audioBuffer, beat, gen);
  };

  return {
  initialized: false,
  decks: { A: initialDeck("A"), B: initialDeck("B") },
  crossfader: 0,
  masterVolume: 0.9,
  masterLevel: 0,
  deckLevelA: 0,
  deckLevelB: 0,
  quantize: true,
  slipMode: false,
  padMode: "cue",
  mode: "assisted",
  workspace: "dj",
  showGuide: false,
  activeDemoSetId: null,
  stemBackendMode: loadStemBackendMode(),
  stemBackendInfo: null,
  gesture: {
    enabled: true,
    status: "off",
    left: emptyHand(),
    right: emptyHand(),
    calibrated: false,
  },

  init: async () => {
    const eng = getEngine();
    await eng.ensurePitchLock();
    await eng.resume();
    set({ initialized: true });
    startRenderLoop();
    session.ensureTickLoop();
  },

  loadFile: async (id, file) => {
    const gen = ++loadGen;
    const eng = getEngine();
    await eng.resume();
    if (!get().initialized) await get().init();
    set((s) => ({
      decks: { ...s.decks, [id]: { ...s.decks[id], loading: true, fileName: file.name } },
    }));
    try {
      await ingestOneTrack(id, file, gen);
    } catch (e) {
      set((s) => ({
        decks: {
          ...s.decks,
          [id]: { ...s.decks[id], loading: false, hasTrack: false, fileName: null },
        },
      }));
      console.error("Failed to load track", e);
      throw e;
    }
  },

  loadPairToDecks: async (fileA, fileB) => {
    const gen = ++loadGen;
    const eng = getEngine();
    await eng.resume();
    if (!get().initialized) await get().init();
    set((s) => ({
      decks: {
        A: { ...s.decks.A, loading: true, fileName: fileA.name },
        B: { ...s.decks.B, loading: true, fileName: fileB.name },
      },
    }));
    try {
      const [rawA, rawB] = await Promise.all([fileA.arrayBuffer(), fileB.arrayBuffer()]);
      if (gen !== loadGen) return;
      const audioA = await eng.decode(rawA.slice(0));
      if (gen !== loadGen) return;
      const audioB = await eng.decode(rawB.slice(0));
      if (gen !== loadGen) return;
      eng.deckA.loadBuffer(audioA);
      eng.deckB.loadBuffer(audioB);
      const [beatA, beatB] = await Promise.all([detectBeat(audioA), detectBeat(audioB)]);
      if (gen !== loadGen) return;
      commitLoadedDeck("A", fileA, audioA, beatA, gen);
      commitLoadedDeck("B", fileB, audioB, beatB, gen);
    } catch (e) {
      set((s) => ({
        decks: {
          A: { ...s.decks.A, loading: false, hasTrack: false, fileName: null },
          B: { ...s.decks.B, loading: false, hasTrack: false, fileName: null },
        },
      }));
      console.error("Failed to load pair", e);
      throw e;
    }
  },

  togglePlay: (id) => {
    const eng = getEngine();
    void eng.resume();
    eng.deck(id).toggle();
    // If exactly one deck is now playing, put the crossfader on its side so
    // a lone track is heard at full level.
    const aPlaying = eng.deckA.playing;
    const bPlaying = eng.deckB.playing;
    let crossfader: number | undefined;
    if (aPlaying && !bPlaying) crossfader = 0;
    else if (bPlaying && !aPlaying) crossfader = 1;
    if (crossfader !== undefined) eng.crossfader.setPosition(crossfader);
    set((s) => ({
      decks: { ...s.decks, [id]: { ...s.decks[id], playing: eng.deck(id).playing } },
      ...(crossfader !== undefined ? { crossfader } : {}),
    }));
  },

  setVolume: (id, v) => {
    getEngine().deck(id).setVolume(v);
    set((s) => ({ decks: { ...s.decks, [id]: { ...s.decks[id], volume: v } } }));
  },

  setFilter: (id, v) => {
    getEngine().deck(id).setFilter(v);
    set((s) => ({ decks: { ...s.decks, [id]: { ...s.decks[id], filter: v } } }));
  },

  setEq: (id, eq) => {
    getEngine().deck(id).setEq(eq);
    set((s) => ({
      decks: { ...s.decks, [id]: { ...s.decks[id], eq: { ...s.decks[id].eq, ...eq } } },
    }));
  },

  setRate: (id, rate) => {
    getEngine().deck(id).setRate(rate, true, { keyLock: false });
    set((s) => ({
      decks: { ...s.decks, [id]: { ...s.decks[id], rate, keyLock: false } },
    }));
  },

  seek: (id, pos) => {
    let p = pos;
    if (get().quantize) {
      const d = get().decks[id];
      if (d.bpm > 0) {
        const spb = 60 / d.bpm;
        p = Math.round(p / spb) * spb;
      }
    }
    p = Math.max(0, Math.min(p, get().decks[id].duration || p));
    getEngine().deck(id).seek(p);
    set((s) => ({ decks: { ...s.decks, [id]: { ...s.decks[id], position: p } } }));
  },

  setCrossfader: (v) => {
    getEngine().crossfader.setPosition(v);
    set({ crossfader: v });
  },

  setMasterVolume: (v) => {
    getEngine().setMasterVolume(v);
    set({ masterVolume: v });
  },

  setQuantize: (v) => set({ quantize: v }),
  setSlipMode: (v) => set({ slipMode: v }),
  setPadMode: (m) => set({ padMode: m }),

  toggleBassKill: (id) => {
    const next = !get().decks[id].bassKill;
    getEngine().deck(id).setEq({ low: next ? -40 : 0 });
    set((s) => ({
      decks: {
        ...s.decks,
        [id]: { ...s.decks[id], bassKill: next, eq: { ...s.decks[id].eq, low: next ? -40 : 0 } },
      },
    }));
  },

  toggleEcho: (id) => {
    const next = !get().decks[id].echoOn;
    const eng = getEngine();
    eng.echo(id).setTimeFromBpm(get().decks[id].bpm || 120);
    eng.echo(id).setSend(next ? 0.55 : 0);
    set((s) => ({ decks: { ...s.decks, [id]: { ...s.decks[id], echoOn: next } } }));
  },

  toggleReverb: (id) => {
    const next = !get().decks[id].reverbOn;
    getEngine().reverb(id).setSend(next ? 0.5 : 0);
    set((s) => ({ decks: { ...s.decks, [id]: { ...s.decks[id], reverbOn: next } } }));
  },

  setCue: (id, idx) => {
    const pos = getEngine().deck(id).position;
    set((s) => {
      const cues = [...s.decks[id].cues];
      cues[idx] = pos;
      return { decks: { ...s.decks, [id]: { ...s.decks[id], cues } } };
    });
  },

  jumpCue: (id, idx) => {
    const cue = get().decks[id].cues[idx];
    if (cue < 0) {
      get().setCue(id, idx);
      return;
    }
    get().seek(id, cue);
  },

  toggleLoop: (id, beats) => {
    const deck = getEngine().deck(id);
    const cur = get().decks[id].loopBeats;
    if (cur === beats) {
      deck.clearLoop();
      set((s) => ({ decks: { ...s.decks, [id]: { ...s.decks[id], loopBeats: 0 } } }));
      return;
    }
    const bpm = get().decks[id].bpm || 120;
    const spb = 60 / (bpm * deck.rate);
    deck.setLoop(beats * spb);
    set((s) => ({ decks: { ...s.decks, [id]: { ...s.decks[id], loopBeats: beats } } }));
  },

  deckBrake: (id) => getEngine().deck(id).brake(1.6),
  deckSpinback: (id) => getEngine().deck(id).spinback(0.55),
  deckGate: (id) => {
    const deck = getEngine().deck(id);
    const bpm = get().decks[id].bpm || 120;
    const spb = 60 / (bpm * deck.rate);
    deck.gate(spb * 4, spb, 0.5);
  },

  setStemPreset: (id, preset) => {
    if (preset === "custom") return;
    getEngine().deck(id).setStemPreset(preset);
    set((s) => ({
      decks: {
        ...s.decks,
        [id]: { ...s.decks[id], stemPreset: preset, stemLevels: defaultStemLevels() },
      },
    }));
  },

  toggleStem: (id, stem) => {
    const levels = { ...get().decks[id].stemLevels };
    const next = levels[stem] > 0.5 ? 0 : 1;
    levels[stem] = next;
    getEngine().deck(id).setStemLevel(stem, next);
    set((s) => ({
      decks: {
        ...s.decks,
        [id]: { ...s.decks[id], stemLevels: levels, stemPreset: "custom" },
      },
    }));
  },

  syncDeck: (id) => {
    const other = id === "A" ? "B" : "A";
    const thisBpm = get().decks[id].bpm;
    const otherBpm = get().decks[other].bpm;
    if (!thisBpm || !otherBpm) return;
    const rate = computeTransitionSyncRatio(otherBpm, thisBpm);
    const keyLock = Math.abs(rate - 1) > 0.001;
    getEngine().deck(id).setRate(rate, false, { keyLock });
    set((s) => ({
      decks: { ...s.decks, [id]: { ...s.decks[id], rate, keyLock } },
    }));
  },

  commitTransitionComplete: () => {
    const eng = getEngine();
    const a = eng.deckA;
    const b = eng.deckB;
    const cleanEq = { low: 0, mid: 0, high: 0 };
    set((s) => ({
      crossfader: 1,
      decks: {
        A: {
          ...s.decks.A,
          playing: false,
          position: a.position,
          rate: a.rate,
          keyLock: a.keyLockEnabled,
          eq: cleanEq,
          filter: 0,
          bassKill: false,
          echoOn: false,
          reverbOn: false,
          stemPreset: "full",
          stemLevels: defaultStemLevels(),
        },
        B: {
          ...s.decks.B,
          playing: b.playing,
          position: b.position,
          rate: b.rate,
          keyLock: b.keyLockEnabled,
          eq: cleanEq,
          filter: 0,
          bassKill: false,
          echoOn: false,
          reverbOn: false,
          stemPreset: "full",
          stemLevels: defaultStemLevels(),
        },
      },
    }));
  },

  syncDecksFromEngine: () => {
    const eng = getEngine();
    const a = eng.deckA;
    const b = eng.deckB;
    set((s) => ({
      crossfader: eng.crossfader.position,
      decks: {
        A: {
          ...s.decks.A,
          playing: a.playing,
          position: a.position,
          rate: a.rate,
          keyLock: a.keyLockEnabled,
          stemPreset: "full",
          stemLevels: defaultStemLevels(),
          eq: a.getEq(),
          filter: s.decks.A.filter,
          bassKill: a.getEq().low <= -30,
        },
        B: {
          ...s.decks.B,
          playing: b.playing,
          position: b.position,
          rate: b.rate,
          keyLock: b.keyLockEnabled,
          stemPreset: "full",
          stemLevels: defaultStemLevels(),
          eq: b.getEq(),
          filter: s.decks.B.filter,
          bassKill: b.getEq().low <= -30,
        },
      },
    }));
  },

  commitRemixMorph: () => {
    const eng = getEngine();
    const layerDeck = session.getRemixEngine().getSnapshot().layerDeck;
    const layerIsA = layerDeck === "A";
    const xf = layerIsA ? 0 : 1;
    eng.crossfader.setPosition(xf, true);
    const a = eng.deckA;
    const b = eng.deckB;
    const cleanEq = { low: 0, mid: 0, high: 0 };
    set((s) => ({
      crossfader: xf,
      decks: {
        A: {
          ...s.decks.A,
          playing: a.playing,
          position: a.position,
          rate: a.rate,
          keyLock: a.keyLockEnabled,
          eq: layerIsA ? a.getEq() : cleanEq,
          filter: layerIsA ? s.decks.A.filter : 0,
          bassKill: false,
          stemPreset: "full",
          stemLevels: defaultStemLevels(),
        },
        B: {
          ...s.decks.B,
          playing: b.playing,
          position: b.position,
          rate: b.rate,
          keyLock: b.keyLockEnabled,
          eq: layerIsA ? cleanEq : b.getEq(),
          filter: layerIsA ? 0 : s.decks.B.filter,
          bassKill: false,
          stemPreset: "full",
          stemLevels: defaultStemLevels(),
        },
      },
    }));
  },

  setWorkspace: (w) => set({ workspace: w }),

  syncAfterTransitionAbort: () => {
    const eng = getEngine();
    const a = eng.deckA;
    const b = eng.deckB;
    const cleanEq = { low: 0, mid: 0, high: 0 };
    set((s) => ({
      crossfader: 0,
      decks: {
        A: {
          ...s.decks.A,
          playing: a.playing,
          position: a.position,
          rate: a.rate,
          keyLock: a.keyLockEnabled,
          eq: cleanEq,
          filter: 0,
          bassKill: false,
          echoOn: false,
          reverbOn: false,
          stemPreset: "full",
          stemLevels: defaultStemLevels(),
        },
        B: {
          ...s.decks.B,
          playing: b.playing,
          position: b.position,
          rate: 1,
          keyLock: false,
          eq: cleanEq,
          filter: 0,
          bassKill: false,
          echoOn: false,
          reverbOn: false,
          stemPreset: "full",
          stemLevels: defaultStemLevels(),
        },
      },
    }));
  },

  setMode: (m) => set({ mode: m }),
  setShowGuide: (v) => set({ showGuide: v }),
  setActiveDemoSetId: (id) => set({ activeDemoSetId: id }),

  setStemBackendMode: (mode) => {
    saveStemBackendMode(mode);
    set({ stemBackendMode: mode });
  },

  refreshStemBackendInfo: async () => {
    const info = await probeStemsBackend();
    set({ stemBackendInfo: info });
    if (info.serverCloudOnly) {
      set({ stemBackendMode: "cloud" });
    }
  },

  retryStems: (id) => {
    const file = stemSourceFiles[id];
    if (!file) return;
    startStemSeparation(id, file, loadGen);
  },

  setGestureStatus: (status, err) =>
    set((s) => ({ gesture: { ...s.gesture, status, errorMessage: err } })),

  setGestureEnabled: (v) =>
    set((s) => ({ gesture: { ...s.gesture, enabled: v } })),

  updateHands: (left, right) =>
    set((s) => ({ gesture: { ...s.gesture, left, right } })),

  setCalibrated: (v) => set((s) => ({ gesture: { ...s.gesture, calibrated: v } })),

  _tick: () => {
    const eng = engine;
    if (!eng) return;
    const a = eng.deckA;
    const b = eng.deckB;
    set((s) => ({
      masterLevel: eng.getMasterLevel(),
      deckLevelA: eng.getDeckLevel("A"),
      deckLevelB: eng.getDeckLevel("B"),
      decks: {
        A: {
          ...s.decks.A,
          position: a.position,
          playing: a.playing,
          rate: a.rate,
          keyLock: a.keyLockEnabled,
          channelLevel: eng.getDeckLevel("A"),
        },
        B: {
          ...s.decks.B,
          position: b.position,
          playing: b.playing,
          rate: b.rate,
          keyLock: b.keyLockEnabled,
          channelLevel: eng.getDeckLevel("B"),
        },
      },
    }));
  },
};
});

let rafId: number | null = null;
let lastTick = 0;
function startRenderLoop(): void {
  if (rafId !== null) return;
  const loop = (t: number) => {
    rafId = requestAnimationFrame(loop);
    // Throttle store updates to ~30fps to keep React light.
    if (t - lastTick < 33) return;
    lastTick = t;
    useStore.getState()._tick();
  };
  rafId = requestAnimationFrame(loop);
}
