import type { AudioEngine } from "./AudioEngine";
import type { StepAction, DeckRef, TransitionRecipe } from "../copilot/recipeTypes";
import { recipeUsesSlam, recipeUsesStems } from "../copilot/transitionLibrary";
import { clamp } from "./audioMath";
import { computeTransitionSyncRatio } from "./syncRatio";
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
    this.eng.deckA.cancelGlideRate();
    this.eng.deckB.cancelGlideRate();

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

  /** Drop/slam moves: lock B to A's grid with pitch-locked sync + phase cue. */
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

  primeIncoming(): void {
    this.eng.deckA.setVolume(1, false);
    this.eng.deckB.setVolume(1, false);
    this.eng.deckB.setEq({ low: -40 });
    this.eng.deckB.setFilter(0, false);
    this.eng.crossfader.setPosition(0, true);
  }

  execute(action: StepAction, secondsPerBeat: number): void {
    const deck = this.eng.deck(action.deck as DeckRef);
    const isB = action.deck === "B";
    const beats = action.beats ?? 4;
    const dur = Math.max(0.05, beats * secondsPerBeat);

    switch (action.type) {
      case "play":
        if (!deck.playing) {
          if (isB && (this.usesStems || this.usesSlam)) {
            this.alignDeckToMaster("B", "A");
          }
          deck.play();
        }
        break;
      case "volume": {
        const t = action.target ?? 1;
        this.crossfadeTo(isB ? t : 1 - t, dur);
        if (isB && t >= 0.65) this.beginTempoRestore(dur);
        break;
      }
      case "filter":
        deck.rampFilter(action.target ?? 0, dur);
        break;
      case "bassKill":
        deck.rampEqLow(-40, dur);
        break;
      case "bassRestore":
        deck.rampEqLow(0, dur);
        break;
      case "crossfade":
        this.crossfadeTo(action.target ?? 1, dur);
        if (isB && (action.target ?? 1) >= 0.65) this.beginTempoRestore(dur);
        break;
      case "slam":
        this.executeSlam(secondsPerBeat);
        break;
      case "echoOut": {
        const echo = this.eng.echo(action.deck as DeckRef);
        echo.setFeedback(action.target ?? 0.65);
        echo.setSend(0.75);
        const xfDur = Math.min(dur, secondsPerBeat * 2);
        this.crossfadeTo(isB ? 0 : 1, xfDur);
        if (!isB) this.beginTempoRestore(Math.max(xfDur * 2, secondsPerBeat * 4));
        break;
      }
      case "cut":
        this.crossfadeTo(isB ? 1 : 0, 0.06);
        if (isB) this.beginTempoRestore(secondsPerBeat * 4);
        break;
      case "reverb": {
        const wet = action.target ?? 0.7;
        this.eng.reverb(action.deck as DeckRef).setSend(wet);
        deck.rampFilter(0.75, dur * 0.6);
        this.crossfadeTo(isB ? 0 : 1, dur);
        if (!isB) this.beginTempoRestore(dur);
        break;
      }
      case "brake":
        deck.brake(Math.min(dur, 1.8));
        this.crossfadeTo(isB ? 0 : 1, 0.35);
        if (!isB) this.beginTempoRestore(secondsPerBeat * 4);
        break;
      case "spinback":
        deck.spinback(0.45);
        this.crossfadeTo(isB ? 0 : 1, 0.25);
        if (!isB) this.beginTempoRestore(secondsPerBeat * 3);
        break;
      case "gate":
        deck.gate(dur, secondsPerBeat, action.target ?? 0.5);
        break;
      case "stemPreset": {
        if (!deck.stemsReady) break;
        const preset = (action.preset ?? "full") as StemPresetKind;
        const master = rhythmMasterForStem(action.deck as DeckRef, preset);
        if (master) this.alignDeckToMaster(action.deck as DeckRef, master);
        deck.rampStemPreset(preset, Math.max(0.25, secondsPerBeat * 1.5));
        break;
      }
    }
  }

  /** Real double-drop / peak slam: bass swap on the one, then instant crossfader. */
  private executeSlam(secondsPerBeat: number): void {
    this.alignDeckToMaster("B", "A");
    this.eng.deckA.rampEqLow(-40, secondsPerBeat * 0.4);
    this.eng.deckA.rampFilter(0.55, secondsPerBeat * 0.35);
    this.eng.deckB.rampEqLow(0, secondsPerBeat * 0.45);
    this.eng.deckB.rampFilter(0, secondsPerBeat * 0.3);
    const slamDur = Math.max(0.05, secondsPerBeat * 0.18);
    this.crossfadeTo(1, slamDur);
    this.beginTempoRestore(secondsPerBeat * 8);
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
    const dur = Math.max(blendDurationSec * 1.15, 1.2);
    this.eng.deckB.glideRate(1, dur, {
      keyLock: true,
      releaseKeyLockAtEnd: true,
    });
  }

  private crossfadeTo(target: number, durationSec: number): void {
    const xf = this.eng.crossfader;
    const start = xf.position;
    const startTime = performance.now();
    const tick = () => {
      const raw = clamp((performance.now() - startTime) / (durationSec * 1000), 0, 1);
      const t = raw * raw * (3 - 2 * raw);
      xf.setPosition(start + (target - start) * t, false);
      if (raw < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
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
      b.glideRate(1, 2.5, { keyLock: true, releaseKeyLockAtEnd: true });
    } else if (!offTempo && b.keyLockEnabled) {
      b.setRate(1, false, { keyLock: false });
    }
  }

  finalize(): void {
    this.eng.crossfader.setPosition(1, true);
    this.eng.deckB.setEq({ low: 0, mid: 0, high: 0 });
    this.eng.deckB.setFilter(0);
    this.eng.echoA.setSend(0);
    this.eng.echoB.setSend(0);
    this.eng.reverbA.setSend(0);
    this.eng.reverbB.setSend(0);
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
    this.eng.echoA.setSend(0);
    this.eng.echoB.setSend(0);
    this.eng.reverbA.setSend(0);
    this.eng.reverbB.setSend(0);
  }
}
