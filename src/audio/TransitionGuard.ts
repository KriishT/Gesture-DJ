import type { AudioEngine } from "./AudioEngine";
import type { StepAction, DeckRef, TransitionRecipe } from "../copilot/recipeTypes";
import { recipeUsesSlam, recipeUsesStems } from "../copilot/transitionLibrary";
import { clamp } from "./audioMath";
import { computeTransitionSyncRatio, computeSyncRatio, shouldBeatmatch } from "./syncRatio";
import {
  alignPositionToMasterBeat,
  computeStemSyncRatio,
  rhythmMasterForStem,
  snapToBeatGrid,
  snapToDownbeat,
  type StemPresetKind,
} from "./beatAlign";

export interface TransitionTiming {
  bpmA: number;
  bpmB: number;
  offsetA: number;
  offsetB: number;
  positionA: number;
  positionB: number;
  rateA: number;
}

export class TransitionGuard {
  private eng: AudioEngine;
  private timing: TransitionTiming = {
    bpmA: 120,
    bpmB: 120,
    offsetA: 0,
    offsetB: 0,
    positionA: 0,
    positionB: 0,
    rateA: 1,
  };
  private usesStems = false;
  private usesSlam = false;
  private syncRatio = 1;
  private tempoRestoreStarted = false;
  private xfAnimId: number | null = null;

  constructor(eng: AudioEngine) {
    this.eng = eng;
  }

  setTiming(t: Partial<TransitionTiming>): void {
    this.timing = { ...this.timing, ...t };
  }

  static realSecondsPerBeat(bpm: number, rate: number): number {
    if (!bpm || bpm <= 0) return 0.5;
    return 60 / (bpm * rate);
  }

  prepare(recipe: TransitionRecipe, timing: TransitionTiming): void {
    this.timing = timing;
    this.usesStems = recipeUsesStems(recipe);
    this.usesSlam = recipeUsesSlam(recipe);
    this.tempoRestoreStarted = false;
    this.syncRatio = 1;
    this.cancelCrossfadeAnim();

    this.eng.deckA.cancelGlideRate();
    this.eng.deckB.cancelGlideRate();
    this.clearFx();

    if (this.usesStems) {
      this.prepareStemTransition(recipe);
    } else if (this.usesSlam) {
      this.prepareSlamTransition(recipe);
    } else {
      this.beatmatch(timing.bpmA, timing.bpmB);
      this.cueDeckB(recipe.cueInB);
    }
    this.primeIncoming();
  }

  private prepareStemTransition(recipe: TransitionRecipe): void {
    const { bpmA, bpmB, offsetA, offsetB, positionA } = this.timing;
    const acapellaOnA = recipe.steps.some(
      (s) =>
        s.action.type === "stemPreset" &&
        s.action.deck === "A" &&
        (s.action.preset === "acapella" || s.action.preset === "noVocals"),
    );

    this.eng.deckA.setRate(1, false, { keyLock: false });

    if (acapellaOnA) {
      this.eng.deckB.setRate(1, false, { keyLock: false });
    } else {
      const ratio = computeStemSyncRatio(bpmA, bpmB);
      this.syncRatio = ratio;
      this.applyDeckSync("B", ratio);
    }

    let cue = snapToDownbeat(recipe.cueInB, bpmB, offsetB);
    cue = alignPositionToMasterBeat(
      { position: positionA, offset: offsetA, bpm: bpmA },
      { position: cue, offset: offsetB, bpm: bpmB },
    );
    this.eng.deckB.seek(cue);
  }

  private prepareSlamTransition(recipe: TransitionRecipe): void {
    const { bpmA, bpmB, offsetA, offsetB, positionA } = this.timing;
    const ratio = computeStemSyncRatio(bpmA, bpmB);
    this.syncRatio = ratio;
    this.eng.deckA.setRate(1, false, { keyLock: false });
    this.applyDeckSync("B", ratio);

    let cue = snapToDownbeat(recipe.cueInB, bpmB, offsetB);
    cue = alignPositionToMasterBeat(
      { position: positionA, offset: offsetA, bpm: bpmA },
      { position: cue, offset: offsetB, bpm: bpmB },
    );
    this.eng.deckB.seek(cue);
  }

  private applyDeckSync(deckId: DeckRef, ratio: number): void {
    if (Math.abs(ratio - 1) > 0.001) {
      this.eng.deck(deckId).setRate(ratio, false, { keyLock: true });
    } else {
      this.eng.deck(deckId).setRate(1, false, { keyLock: false });
    }
  }

  beatmatch(bpmA: number, bpmB: number): number {
    this.tempoRestoreStarted = false;
    this.eng.deckB.cancelGlideRate();
    if (!bpmA || !bpmB) {
      this.syncRatio = 1;
      this.eng.deckB.setRate(1, false, { keyLock: false });
      return 1;
    }
    const ratio = computeTransitionSyncRatio(bpmA, bpmB);
    this.syncRatio = ratio;
    this.applyDeckSync("B", ratio);
    return ratio;
  }

  cueDeckB(cueInB: number): void {
    const snapped = snapToDownbeat(cueInB, this.timing.bpmB, this.timing.offsetB);
    this.eng.deckB.seek(snapped);
  }

  private primeIncoming(): void {
    this.eng.deckA.setVolume(1, false);
    this.eng.deckA.setFilter(0, false);
    this.eng.deckA.setEq({ low: 0, mid: 0, high: 0 });
    this.eng.deckB.setVolume(1, false);
    this.eng.deckB.setFilter(0, false);
    this.eng.deckB.setEq({ low: this.usesStems ? -28 : -36, mid: 0, high: 0 });
    this.eng.crossfader.setPosition(0, true);
  }

  /** Start deck B at the transition downbeat so crossfades always have audio underneath. */
  kickoffIncomingDeck(): void {
    this.ensureDeckBPlaying(true);
  }

  private ensureDeckBPlaying(alignToMaster = false): void {
    const b = this.eng.deckB;
    if (!b.hasTrack) return;
    if (alignToMaster && (this.usesStems || this.usesSlam)) {
      this.alignDeckToMaster("B", "A");
    }
    if (!b.playing) {
      b.setVolume(1, false);
      b.play();
    }
  }

  execute(action: StepAction, secondsPerBeat: number): void {
    const deck = this.eng.deck(action.deck as DeckRef);
    const isB = action.deck === "B";
    const beats = action.beats ?? 4;
    const dur = Math.max(0.08, beats * secondsPerBeat);

    switch (action.type) {
      case "play":
        if (isB) this.ensureDeckBPlaying(this.usesStems || this.usesSlam);
        else if (!deck.playing) {
          deck.setVolume(1, false);
          deck.play();
        }
        break;
      case "volume": {
        const t = action.target ?? 1;
        if (isB && t > 0.08) this.ensureDeckBPlaying();
        this.crossfadeTo(isB ? t : 1 - t, Math.max(secondsPerBeat * 2, dur));
        if (isB && t >= 0.55) this.beginTempoRestore(Math.max(dur, secondsPerBeat * 4));
        break;
      }
      case "filter":
        deck.rampFilter(action.target ?? 0, Math.max(secondsPerBeat * 2, dur));
        break;
      case "bassKill":
        deck.rampEqLow(-40, Math.max(secondsPerBeat * 1.5, dur * 0.85));
        break;
      case "bassRestore":
        deck.rampEqLow(0, Math.max(secondsPerBeat * 2, dur));
        break;
      case "crossfade":
        if (isB && (action.target ?? 1) > 0.08) this.ensureDeckBPlaying();
        this.crossfadeTo(action.target ?? 1, Math.max(secondsPerBeat * 3, dur));
        if (isB && (action.target ?? 1) >= 0.55) {
          this.beginTempoRestore(Math.max(dur, secondsPerBeat * 4));
        }
        break;
      case "slam":
        this.executeSlam(secondsPerBeat);
        break;
      case "echoOut": {
        const echo = this.eng.echo(action.deck as DeckRef);
        echo.setFeedback(0.62);
        echo.setSend(0.68);
        deck.rampFilter(0.55, Math.max(secondsPerBeat * 2, dur * 0.5));
        if (!isB) {
          deck.rampEqLow(-40, secondsPerBeat * 1.5);
          const xfDur = Math.max(secondsPerBeat * 3, dur * 0.75);
          this.crossfadeTo(0.75, xfDur);
          this.beginTempoRestore(Math.max(xfDur * 1.5, secondsPerBeat * 6));
        } else {
          this.crossfadeTo(0.35, Math.max(secondsPerBeat * 2, dur * 0.6));
        }
        window.setTimeout(() => echo.setSend(0.15), Math.max(900, dur * 800));
        break;
      }
      case "cut":
        this.crossfadeTo(isB ? 1 : 0, Math.max(0.12, secondsPerBeat * 0.35));
        if (isB) this.beginTempoRestore(secondsPerBeat * 6);
        break;
      case "reverb": {
        const wet = action.target ?? 0.65;
        this.eng.reverb(action.deck as DeckRef).setSend(clamp(wet, 0.35, 0.72));
        deck.rampFilter(0.7, Math.max(secondsPerBeat * 2, dur * 0.65));
        deck.rampEqLow(-38, Math.max(secondsPerBeat * 1.5, dur * 0.5));
        if (!isB) {
          this.crossfadeTo(0.8, Math.max(secondsPerBeat * 4, dur));
          this.beginTempoRestore(Math.max(dur, secondsPerBeat * 5));
        }
        window.setTimeout(() => this.eng.reverb(action.deck as DeckRef).setSend(0), Math.max(1400, dur * 900));
        break;
      }
      case "brake":
        deck.brake(Math.min(dur, secondsPerBeat * 2.5));
        deck.rampEqLow(-40, secondsPerBeat);
        if (!isB) {
          this.crossfadeTo(0.85, Math.max(secondsPerBeat * 2, 0.5));
          this.beginTempoRestore(secondsPerBeat * 5);
        }
        break;
      case "spinback":
        deck.spinback(0.48);
        deck.rampEqLow(-40, secondsPerBeat * 0.8);
        if (!isB) {
          this.crossfadeTo(0.9, Math.max(secondsPerBeat * 1.5, 0.4));
          this.beginTempoRestore(secondsPerBeat * 4);
        }
        break;
      case "gate":
        deck.gate(dur, secondsPerBeat, action.target ?? 0.48);
        if (!isB) {
          this.crossfadeTo(0.62, Math.max(secondsPerBeat * 3, dur * 0.7));
          this.beginTempoRestore(secondsPerBeat * 4);
        }
        break;
      case "stemPreset": {
        if (!deck.stemsReady) break;
        if (isB) this.ensureDeckBPlaying(true);
        const preset = (action.preset ?? "full") as StemPresetKind;
        const master = rhythmMasterForStem(action.deck as DeckRef, preset);
        if (master) this.alignDeckToMaster(action.deck as DeckRef, master);
        const rampSec = Math.max(
          secondsPerBeat * 2.5,
          preset === "acapella" || preset === "noVocals" ? secondsPerBeat * 4 : secondsPerBeat * 2,
        );
        deck.rampStemPreset(preset, rampSec);
        if (action.deck === "A" && (preset === "acapella" || preset === "noVocals")) {
          deck.rampEqLow(-40, secondsPerBeat * 2);
          deck.rampFilter(0.35, secondsPerBeat * 2);
        }
        if (action.deck === "B" && preset !== "full") {
          this.crossfadeTo(Math.min(0.5, this.eng.crossfader.position + 0.12), secondsPerBeat * 3);
        }
        break;
      }
    }
  }

  private executeSlam(secondsPerBeat: number): void {
    this.alignDeckToMaster("B", "A");
    if (!this.eng.deckB.playing) {
      this.eng.deckB.setVolume(1, false);
      this.eng.deckB.play();
    }
    this.eng.deckA.rampEqLow(-40, secondsPerBeat * 0.45);
    this.eng.deckA.rampFilter(0.5, secondsPerBeat * 0.4);
    this.eng.deckB.rampEqLow(0, secondsPerBeat * 0.5);
    this.eng.deckB.rampFilter(0, secondsPerBeat * 0.35);
    const slamDur = Math.max(0.08, secondsPerBeat * 0.22);
    this.crossfadeTo(1, slamDur);
    this.beginTempoRestore(secondsPerBeat * 10);
  }

  private alignDeckToMaster(slave: DeckRef, master: DeckRef): void {
    const masterDeck = this.eng.deck(master);
    const slaveDeck = this.eng.deck(slave);
    const masterBpm = master === "A" ? this.timing.bpmA : this.timing.bpmB;
    const slaveBpm = slave === "A" ? this.timing.bpmA : this.timing.bpmB;
    const masterOff = master === "A" ? this.timing.offsetA : this.timing.offsetB;
    const slaveOff = slave === "A" ? this.timing.offsetA : this.timing.offsetB;

    const ratio = computeStemSyncRatio(masterBpm, slaveBpm);
    const aligned = alignPositionToMasterBeat(
      { position: masterDeck.position, offset: masterOff, bpm: masterBpm },
      { position: slaveDeck.position, offset: slaveOff, bpm: slaveBpm },
    );
    const snapped = snapToBeatGrid(aligned, slaveBpm, slaveOff);

    const wasPlaying = slaveDeck.playing;
    if (wasPlaying) slaveDeck.pause();

    this.applyDeckSync(slave, ratio);
    slaveDeck.seek(snapped);
    if (wasPlaying) slaveDeck.play();

    if (slave === "B") this.syncRatio = ratio;
  }

  private beginTempoRestore(blendDurationSec: number): void {
    if (this.tempoRestoreStarted || Math.abs(this.syncRatio - 1) < 0.008) return;
    if (Math.abs(this.eng.deckB.rate - 1) < 0.008) return;
    this.tempoRestoreStarted = true;
    const dur = Math.max(blendDurationSec * 1.15, 1.5);
    this.eng.deckB.glideRate(1, dur, {
      keyLock: true,
      releaseKeyLockAtEnd: true,
    });
  }

  private cancelCrossfadeAnim(): void {
    if (this.xfAnimId !== null) {
      cancelAnimationFrame(this.xfAnimId);
      this.xfAnimId = null;
    }
  }

  private crossfadeTo(target: number, durationSec: number): void {
    if (target > 0.08) this.ensureDeckBPlaying();
    this.cancelCrossfadeAnim();
    const xf = this.eng.crossfader;
    const start = xf.position;
    const startTime = performance.now();
    const durMs = Math.max(80, durationSec * 1000);
    const tick = () => {
      const raw = clamp((performance.now() - startTime) / durMs, 0, 1);
      const t = raw * raw * (3 - 2 * raw);
      xf.setPosition(start + (target - start) * t, false);
      if (raw < 1) {
        this.xfAnimId = requestAnimationFrame(tick);
      } else {
        this.xfAnimId = null;
      }
    };
    this.xfAnimId = requestAnimationFrame(tick);
  }

  private clearFx(): void {
    this.eng.echoA.setSend(0);
    this.eng.echoB.setSend(0);
    this.eng.reverbA.setSend(0);
    this.eng.reverbB.setSend(0);
  }

  private resetStemMix(): void {
    if (this.eng.deckA.stemsReady) this.eng.deckA.setStemPreset("full");
    if (this.eng.deckB.stemsReady) this.eng.deckB.setStemPreset("full");
  }

  private restoreDeckTempos(): void {
    this.eng.deckA.cancelGlideRate();
    this.eng.deckA.setRate(1, false, { keyLock: false });

    const b = this.eng.deckB;
    const offTempo = Math.abs(b.rate - 1) > 0.008;
    if (offTempo && !this.tempoRestoreStarted) {
      b.glideRate(1, 3, { keyLock: true, releaseKeyLockAtEnd: true });
    } else if (!offTempo && b.keyLockEnabled) {
      b.setRate(1, false, { keyLock: false });
    }
  }

  finalize(): void {
    this.cancelCrossfadeAnim();
    this.ensureDeckBPlaying();
    this.eng.crossfader.setPosition(1, true);
    this.eng.deckB.setVolume(1, false);
    this.eng.deckB.setEq({ low: 0, mid: 0, high: 0 });
    this.eng.deckB.setFilter(0);
    this.clearFx();
    this.eng.deckA.setEq({ low: 0, mid: 0, high: 0 });
    this.eng.deckA.setFilter(0);
    this.resetStemMix();
    this.eng.deckA.pause();
    this.restoreDeckTempos();
    this.syncRatio = 1;
    this.tempoRestoreStarted = false;
    this.usesStems = false;
    this.usesSlam = false;
  }

  reset(): void {
    this.cancelCrossfadeAnim();
    this.eng.deckB.cancelGlideRate();
    this.syncRatio = 1;
    this.tempoRestoreStarted = false;
    this.usesStems = false;
    this.usesSlam = false;
    this.eng.crossfader.setPosition(0, true);
    this.eng.deckA.setEq({ low: 0, mid: 0, high: 0 });
    this.eng.deckA.setFilter(0);
    this.eng.deckB.setEq({ low: 0, mid: 0, high: 0 });
    this.eng.deckB.setFilter(0);
    this.eng.deckA.setRate(1, false, { keyLock: false });
    this.eng.deckB.setRate(1, false, { keyLock: false });
    this.resetStemMix();
    this.clearFx();
  }
}

/** Exported for ranking — how well two BPMs can blend with pitch lock. */
export function blendQuality(bpmA: number, bpmB: number): number {
  if (!bpmA || !bpmB) return 0.5;
  const ratio = computeSyncRatio(bpmA, bpmB);
  if (shouldBeatmatch(ratio)) return 1;
  const dev = Math.abs(ratio - 1);
  if (dev <= 0.06) return 0.85;
  if (dev <= 0.1) return 0.65;
  if (dev <= 0.15) return 0.45;
  return 0.2;
}
