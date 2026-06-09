import type { AudioEngine } from "../audio/AudioEngine";
import type { DeckId } from "../audio/Deck";
import type { DeckState } from "../state/types";
import { snapToDownbeat } from "../audio/beatAlign";
import type { RemixFit, RemixLayerKind, RemixSessionState, RemixSnapshot } from "./types";
import { initialRemixSession } from "./types";
import {
  applyBedGroove,
  applyLayerStem,
  introCrossfader,
  mashupCrossfader,
  primeRemixDecks,
} from "./remixMix";
import {
  formatSyncRatio,
  layerPrerollPosition,
  lockLayerPosition,
} from "./remixSync";

type DeckUi = () => { decks: Record<DeckId, DeckState>; crossfader: number };

export class RemixEngine {
  private eng: AudioEngine;
  private getDeckUi: DeckUi;
  private onAudioRestored?: () => void;
  private onMorphComplete?: () => void;
  private snapshot: RemixSnapshot | null = null;
  private session: RemixSessionState = initialRemixSession();
  private listeners = new Set<() => void>();
  private pendingLayerKind: RemixLayerKind = "acapella";
  private mashupBedCue = 0;
  private layerAtSwap = 0;
  private syncRatio = 1;
  private layerPreSync = false;
  private introRaf: number | null = null;

  constructor(
    eng: AudioEngine,
    getDeckUi: DeckUi,
    hooks?: { onAudioRestored?: () => void; onMorphComplete?: () => void },
  ) {
    this.eng = eng;
    this.getDeckUi = getDeckUi;
    this.onAudioRestored = hooks?.onAudioRestored;
    this.onMorphComplete = hooks?.onMorphComplete;
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): RemixSessionState => this.session;

  get isActive(): boolean {
    return this.session.phase !== "idle";
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }

  private set(patch: Partial<RemixSessionState>): void {
    this.session = { ...this.session, ...patch };
    this.emit();
  }

  private applyCuePlan(
    plan: NonNullable<RemixFit["cues"]>,
    bedDeck: DeckId,
    layerDeck: DeckId,
  ): Partial<RemixSessionState> {
    const patch: Partial<RemixSessionState> = { cuePlan: plan };
    if (bedDeck === "A") patch.cueA = plan.bedCue;
    else patch.cueB = plan.bedCue;
    if (layerDeck === "A") patch.cueA = plan.layerCue;
    else patch.cueB = plan.layerCue;
    return patch;
  }

  setFit(fit: RemixFit | null): void {
    if (!fit) {
      this.set({ fit: null });
      return;
    }
    this.set({
      fit,
      direction: fit.direction,
      bedDeck: fit.bedDeck,
      layerDeck: fit.layerDeck,
      ...this.applyCuePlan(fit.cues, fit.bedDeck, fit.layerDeck),
    });
  }

  setDirection(direction: RemixFit["direction"]): void {
    if (this.session.direction === direction) return;
    const bedDeck = direction === "bOnA" ? "A" : "B";
    const layerDeck = direction === "bOnA" ? "B" : "A";
    this.set({ direction, bedDeck, layerDeck, fit: null, cuePlan: null });
  }

  startLayer(layerKind: RemixLayerKind = "acapella"): void {
    const { bedDeck, layerDeck, cuePlan } = this.session;
    const bed = this.eng.deck(bedDeck);
    const layer = this.eng.deck(layerDeck);

    if (!layer.stemsReady) {
      this.set({ message: "Layer deck needs separated stems first." });
      return;
    }

    if (!cuePlan) {
      this.set({ message: "Analyze remix fit first — AI picks the start points." });
      return;
    }

    if (!this.snapshot) this.snapshot = this.captureSnapshot();

    void this.eng.ensurePitchLock();

    this.pendingLayerKind = layerKind;
    this.mashupBedCue = cuePlan.bedCue;
    this.syncRatio = cuePlan.syncRatio;

    const bedBpm = this.timingBpm(bedDeck);
    const bedOff = this.timingOffset(bedDeck);
    const layerBpm = this.timingBpm(layerDeck);
    const layerOff = this.timingOffset(layerDeck);

    this.layerAtSwap = lockLayerPosition(
      { position: cuePlan.bedCue, bpm: bedBpm, offset: bedOff },
      cuePlan.layerCue,
      layerBpm,
      layerOff,
    );

    bed.pause();
    layer.pause();
    bed.seek(cuePlan.bedIntroCue);

    primeRemixDecks(bed, layer);
    bed.setRate(1, false, { keyLock: false });
    bed.setStemPreset("full");

    const introSec = Math.max(0, cuePlan.bedCue - cuePlan.bedIntroCue);
    this.layerPreSync = introSec > 0.5;

    if (this.layerPreSync) {
      const layerStart = layerPrerollPosition(
        cuePlan.bedIntroCue,
        cuePlan.bedCue,
        this.layerAtSwap,
        this.syncRatio,
      );
      layer.setRate(this.syncRatio, false, { keyLock: true });
      layer.setStemPreset("full");
      layer.setVolume(0, false);
      layer.seek(layerStart);
      layer.play();
    } else {
      layer.setRate(1, false, { keyLock: false });
      layer.setStemPreset("full");
      layer.setVolume(1, false);
      layer.seek(this.layerAtSwap);
    }

    this.eng.crossfader.setPosition(introCrossfader(bedDeck), true);
    bed.play();

    const syncLabel = formatSyncRatio(this.syncRatio);
    this.set({
      phase: "intro",
      activeLayer: layerKind,
      message: this.layerPreSync
        ? `Intro on ${bedDeck} — layer pre-sync ${syncLabel}, vocal swap on the downbeat.`
        : `Locking ${layerDeck} ${syncLabel} to ${bedDeck}'s grid…`,
    });

    if (this.layerPreSync) {
      this.startIntroMonitor();
    } else {
      this.activateMashup();
    }

    this.onAudioRestored?.();
  }

  private startIntroMonitor(): void {
    this.stopIntroMonitor();
    const bedDeck = this.session.bedDeck;
    const bedBpm = this.timingBpm(bedDeck);
    const spb = 60 / (bedBpm || 120);
    const loop = () => {
      if (this.session.phase !== "intro") {
        this.stopIntroMonitor();
        return;
      }
      const pos = this.eng.deck(bedDeck).position;
      if (pos >= this.mashupBedCue - spb * 0.04) {
        this.activateMashup();
        this.stopIntroMonitor();
        return;
      }
      this.introRaf = requestAnimationFrame(loop);
    };
    this.introRaf = requestAnimationFrame(loop);
  }

  private stopIntroMonitor(): void {
    if (this.introRaf !== null) {
      cancelAnimationFrame(this.introRaf);
      this.introRaf = null;
    }
  }

  private activateMashup(): void {
    if (this.session.phase !== "intro") return;

    const { bedDeck, layerDeck } = this.session;
    const bed = this.eng.deck(bedDeck);
    const layer = this.eng.deck(layerDeck);
    const layerKind = this.pendingLayerKind;
    const plan = this.session.cuePlan;
    if (!plan) return;

    const bedBpm = this.timingBpm(bedDeck);
    const bedOff = this.timingOffset(bedDeck);
    const spb = 60 / (bedBpm || 120);

    this.set({ phase: "layering", message: "Downbeat — vocal swap…" });

    const bedSnap = snapToDownbeat(this.mashupBedCue, bedBpm, bedOff);
    if (Math.abs(bed.position - bedSnap) > 0.02) {
      bed.seek(bedSnap);
    }
    if (!bed.playing) bed.play();

    applyBedGroove(bed, layerKind, bed.stemsReady, 0.35);

    if (this.layerPreSync && layer.playing) {
      layer.setRate(this.syncRatio, false, { keyLock: true });
      const expected = layerPrerollPosition(bed.position, plan.bedCue, this.layerAtSwap, this.syncRatio);
      if (Math.abs(layer.position - expected) > spb * 0.08) {
        layer.seek(expected);
      }
      layer.setVolume(1, true);
      applyLayerStem(layer, layerKind, 0.35);
    } else {
      this.layerPreSync = false;
      layer.pause();
      layer.setRate(this.syncRatio, false, { keyLock: true });
      layer.seek(this.layerAtSwap);
      layer.setVolume(1, false);
      layer.play();
      applyLayerStem(layer, layerKind, 0.35);
    }

    this.eng.crossfader.setPosition(mashupCrossfader(bedDeck), true);

    const stretchPct = Math.round(Math.abs(this.syncRatio - 1) * 100);
    const syncNote =
      stretchPct <= 4
        ? `Layer ${formatSyncRatio(this.syncRatio)} on ${bedDeck}'s grid.`
        : `Layer pitch-locked ${formatSyncRatio(this.syncRatio)} (${stretchPct}% tempo match).`;

    this.set({
      phase: "riding",
      message: `${layerDeck} vocals on ${bedDeck}'s beat — ${syncNote}`,
    });

    this.onAudioRestored?.();
  }

  morphToFull(): void {
    if (this.session.phase === "idle") return;
    const { layerDeck, bedDeck } = this.session;
    const layer = this.eng.deck(layerDeck);
    const bed = this.eng.deck(bedDeck);
    const spb = 60 / (this.timingBpm(bedDeck) || 120);

    this.set({ phase: "morphing", message: "Morphing to full track…" });

    layer.rampStemPreset("full", spb * 4);
    layer.rampEqLow(0, spb * 2);
    bed.rampEqLow(-40, spb * 0.5);

    const xf = this.eng.crossfader;
    const start = xf.position;
    const startTime = performance.now();
    const dur = spb * 8 * 1000;

    const tick = () => {
      const t = Math.min(1, (performance.now() - startTime) / dur);
      const ease = t * t * (3 - 2 * t);
      xf.setPosition(start + (1 - start) * ease, false);
      if (t < 1) {
        requestAnimationFrame(tick);
        return;
      }
      bed.pause();
      layer.glideRate(1, spb * 4, { keyLock: true, releaseKeyLockAtEnd: true });
      layer.setStemPreset("full");
      bed.setStemPreset("full");
      bed.setEq({ low: 0, mid: 0, high: 0 });
      bed.setFilter(0);
      this.snapshot = null;
      this.layerPreSync = false;
      this.set({
        phase: "idle",
        activeLayer: null,
        message: `Full ${layerDeck} — remix complete.`,
      });
      this.onMorphComplete?.();
    };
    requestAnimationFrame(tick);
  }

  stopRemix(): void {
    this.stopIntroMonitor();
    this.layerPreSync = false;
    this.restoreSnapshot();
    this.set({
      phase: "idle",
      activeLayer: null,
      message: "Remix stopped — DJ mix restored.",
    });
  }

  exitWorkspace(): void {
    if (this.session.phase === "morphing") return;
    this.stopRemix();
    this.set({ ...initialRemixSession(), fit: this.session.fit, cuePlan: this.session.cuePlan });
  }

  private captureSnapshot(): RemixSnapshot {
    const ui = this.getDeckUi();
    const snapDeck = (id: DeckId) => {
      const d = this.eng.deck(id);
      const u = ui.decks[id];
      return {
        rate: d.rate,
        keyLock: d.keyLockEnabled,
        volume: d.volumeValue,
        stemPreset: u.stemPreset,
        eq: d.getEq(),
        filter: u.filter,
        bassKill: u.bassKill,
        playing: d.playing,
        position: d.position,
      };
    };
    return {
      crossfader: ui.crossfader,
      A: snapDeck("A"),
      B: snapDeck("B"),
    };
  }

  private restoreSnapshot(): void {
    if (!this.snapshot) return;
    const s = this.snapshot;
    this.eng.deckA.cancelGlideRate();
    this.eng.deckB.cancelGlideRate();

    for (const id of ["A", "B"] as const) {
      const d = this.eng.deck(id);
      const snap = s[id];
      d.setStemPreset(snap.stemPreset === "custom" ? "full" : snap.stemPreset);
      d.setRate(snap.rate, false, { keyLock: snap.keyLock });
      d.setVolume(snap.volume, false);
      d.setEq(snap.eq);
      d.setFilter(snap.filter, false);
      d.seek(snap.position);
      if (!snap.playing) d.pause();
    }
    this.eng.crossfader.setPosition(s.crossfader, true);
    this.snapshot = null;
    this.onAudioRestored?.();
  }

  private timingBpm(id: DeckId): number {
    return id === "A" ? this._bpmA : this._bpmB;
  }

  private timingOffset(id: DeckId): number {
    return id === "A" ? this._offsetA : this._offsetB;
  }

  private bedPosition(timing: { positionA: number; positionB: number }): number {
    return this.session.bedDeck === "A" ? timing.positionA : timing.positionB;
  }

  private _bpmA = 120;
  private _bpmB = 120;
  private _offsetA = 0;
  private _offsetB = 0;

  tick(timing: {
    bpmA: number;
    bpmB: number;
    offsetA: number;
    offsetB: number;
    positionA: number;
    positionB: number;
  }): void {
    this._bpmA = timing.bpmA;
    this._bpmB = timing.bpmB;
    this._offsetA = timing.offsetA;
    this._offsetB = timing.offsetB;

    if (this.session.phase === "intro" && this.layerPreSync) {
      const bedBpm = this.timingBpm(this.session.bedDeck);
      const spb = 60 / (bedBpm || 120);
      const pos = this.bedPosition(timing);
      if (pos >= this.mashupBedCue - spb * 0.04) {
        this.activateMashup();
      }
    }
  }
}
