import type { BeatInfo } from "./bpm";

export interface BeatPosition {
  beat: number; // absolute beat index from grid origin
  bar: number; // absolute bar index (4 beats per bar)
  beatInBar: number; // 0..3
  phase: number; // 0..1 progress through the current beat
  secondsPerBeat: number;
}

const BEATS_PER_BAR = 4;

/**
 * Derives bar/beat boundaries from a track's BPM + first-beat offset and a
 * live position getter. Used for quantizing actions and timing the co-pilot.
 * The grid is defined at the track's ORIGINAL tempo; callers pass the actual
 * (rate-adjusted) playback position, which already advances faster/slower.
 */
export class BeatClock {
  private beat: BeatInfo;
  private getPosition: () => number;

  constructor(beat: BeatInfo, getPosition: () => number) {
    this.beat = beat;
    this.getPosition = getPosition;
  }

  setBeat(beat: BeatInfo): void {
    this.beat = beat;
  }

  get bpm(): number {
    return this.beat.bpm;
  }

  get secondsPerBeat(): number {
    return 60 / this.beat.bpm;
  }

  now(): BeatPosition {
    const spb = this.secondsPerBeat;
    const pos = Math.max(0, this.getPosition() - this.beat.offset);
    const beatFloat = pos / spb;
    const beat = Math.floor(beatFloat);
    return {
      beat,
      bar: Math.floor(beat / BEATS_PER_BAR),
      beatInBar: ((beat % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR,
      phase: beatFloat - beat,
      secondsPerBeat: spb,
    };
  }

  /** Seconds until the next beat boundary. */
  secondsToNextBeat(): number {
    const { phase, secondsPerBeat } = this.now();
    return (1 - phase) * secondsPerBeat;
  }

  /** Seconds until the next N-bar boundary (e.g. next 8-bar phrase). */
  secondsToNextPhrase(bars = 8): number {
    const spb = this.secondsPerBeat;
    const pos = Math.max(0, this.getPosition() - this.beat.offset);
    const beatsPerPhrase = bars * BEATS_PER_BAR;
    const phraseLen = beatsPerPhrase * spb;
    const into = pos % phraseLen;
    return phraseLen - into;
  }

  /** Track time (s) of a given absolute beat index. */
  timeOfBeat(beatIndex: number): number {
    return this.beat.offset + beatIndex * this.secondsPerBeat;
  }
}
