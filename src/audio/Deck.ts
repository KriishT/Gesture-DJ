import { clamp, rampParam, linearRamp } from "./audioMath";
import { STEM_NAMES, type StemName } from "../stems/client";
import { SoundTouchNode } from "@soundtouchjs/audio-worklet";

export type DeckId = "A" | "B";
export type { StemName };

export interface EqValues {
  low: number; // dB, e.g. -40..+6
  mid: number;
  high: number;
}

const EQ_LOW_FREQ = 120;
const EQ_MID_FREQ = 1000;
const EQ_HIGH_FREQ = 4500;
const FILTER_MIN = 30;
const FILTER_MAX = 20000;

export type StemPreset =
  | "full"
  | "acapella"
  | "instrumental"
  | "drums"
  | "bass"
  | "guitar"
  | "piano"
  | "noVocals";

function levelsForPreset(preset: StemPreset): Record<StemName, number> {
  const on = (): Record<StemName, number> =>
    Object.fromEntries(STEM_NAMES.map((s) => [s, 1])) as Record<StemName, number>;
  const levels = on();
  const off = (...names: StemName[]) => {
    for (const n of names) levels[n] = 0;
  };
  switch (preset) {
    case "acapella":
      off(...STEM_NAMES.filter((s) => s !== "vocals"));
      break;
    case "instrumental":
    case "noVocals":
      off("vocals");
      break;
    case "drums":
      off(...STEM_NAMES.filter((s) => s !== "drums"));
      break;
    case "bass":
      off(...STEM_NAMES.filter((s) => s !== "bass"));
      break;
    case "guitar":
      off(...STEM_NAMES.filter((s) => s !== "guitar"));
      break;
    case "piano":
      off(...STEM_NAMES.filter((s) => s !== "piano"));
      break;
    case "full":
      break;
  }
  return levels;
}

/**
 * A single playback deck. Audio graph:
 *   BufferSource -> highpass -> lowpass -> eqLow -> eqMid -> eqHigh -> volume -> output
 * The `output` node is connected by the AudioEngine to a crossfader channel.
 * Supports starting playback from an arbitrary offset (cue-in points).
 */
export class Deck {
  readonly id: DeckId;
  readonly ctx: AudioContext;
  readonly output: GainNode;

  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private stemSources: AudioBufferSourceNode[] = [];
  private readonly stemGains: Record<StemName, GainNode>;
  private readonly stemBus: GainNode;
  private readonly preFilter: GainNode;
  private stretch: SoundTouchNode | null = null;
  private keyLock = false;
  private stemBusConnected = false;
  private stemBuffers: Partial<Record<StemName, AudioBuffer>> = {};
  private _stemsReady = false;

  private readonly volume: GainNode;
  private readonly eqLow: BiquadFilterNode;
  private readonly eqMid: BiquadFilterNode;
  private readonly eqHigh: BiquadFilterNode;
  private readonly hp: BiquadFilterNode;
  private readonly lp: BiquadFilterNode;

  private _playing = false;
  private _rate = 1;
  // Position bookkeeping
  private startCtxTime = 0;
  private startOffset = 0;
  private _volumeValue = 1;
  private _filterKnob = 0;
  // Scratch state
  private scratching = false;
  private scratchBaseRate = 1;
  // Loop state
  private looping = false;
  private loopStart = 0;
  private loopLen = 0;

  constructor(id: DeckId, ctx: AudioContext) {
    this.id = id;
    this.ctx = ctx;

    this.hp = ctx.createBiquadFilter();
    this.hp.type = "highpass";
    this.hp.frequency.value = FILTER_MIN;
    this.hp.Q.value = 0.7;

    this.lp = ctx.createBiquadFilter();
    this.lp.type = "lowpass";
    this.lp.frequency.value = FILTER_MAX;
    this.lp.Q.value = 0.7;

    this.eqLow = ctx.createBiquadFilter();
    this.eqLow.type = "lowshelf";
    this.eqLow.frequency.value = EQ_LOW_FREQ;

    this.eqMid = ctx.createBiquadFilter();
    this.eqMid.type = "peaking";
    this.eqMid.frequency.value = EQ_MID_FREQ;
    this.eqMid.Q.value = 0.9;

    this.eqHigh = ctx.createBiquadFilter();
    this.eqHigh.type = "highshelf";
    this.eqHigh.frequency.value = EQ_HIGH_FREQ;

    this.volume = ctx.createGain();
    this.volume.gain.value = 1;

    this.stemBus = ctx.createGain();
    this.stemBus.gain.value = 0;

    this.preFilter = ctx.createGain();
    this.preFilter.connect(this.hp);

    this.stemGains = {} as Record<StemName, GainNode>;
    for (const name of STEM_NAMES) {
      const g = ctx.createGain();
      g.gain.value = 1;
      g.connect(this.stemBus);
      this.stemGains[name] = g;
    }

    this.output = ctx.createGain();
    this.output.gain.value = 1;

    this.hp
      .connect(this.lp)
      .connect(this.eqLow)
      .connect(this.eqMid)
      .connect(this.eqHigh)
      .connect(this.volume)
      .connect(this.output);
  }

  /** Attach SoundTouch pitch-lock processor (called once after worklet registration). */
  initStretch(): void {
    if (this.stretch) return;
    this.stretch = new SoundTouchNode({ context: this.ctx });
    this.stretch.connect(this.preFilter);
    this.stretch.pitch.value = 1;
    this.stretch.playbackRate.value = 1;
  }

  get hasStretch(): boolean {
    return this.stretch !== null;
  }

  get keyLockEnabled(): boolean {
    return this.keyLock;
  }

  private routeInput(): AudioNode {
    return this.keyLock && this.stretch ? this.stretch : this.preFilter;
  }

  private connectStemBus(): void {
    if (this.stemBusConnected) {
      try {
        this.stemBus.disconnect();
      } catch {
        /* not connected */
      }
    }
    this.stemBus.connect(this.routeInput());
    this.stemBusConnected = true;
  }

  private enableKeyLock(on: boolean): void {
    const next = on && this.stretch !== null;
    if (this.keyLock === next) return;
    this.keyLock = next;
    this.connectStemBus();
    if (this._playing) this.restartAtCurrentPosition();
  }

  private restartAtCurrentPosition(): void {
    const pos = this.position;
    const wasPlaying = this._playing;
    this.stopSource();
    this._playing = false;
    this.startOffset = pos;
    if (wasPlaying) this.play();
  }

  get stemsReady(): boolean {
    return this._stemsReady;
  }

  /** Load separated stems; playback will use the stem bus on next play/seek. */
  loadStems(buffers: Partial<Record<StemName, AudioBuffer>>): void {
    this.stemBuffers = buffers;
    this._stemsReady = Object.keys(buffers).length >= 4;
    if (this._stemsReady) {
      this.stemBus.gain.value = 1;
      this.setStemPreset("full");
      this.connectStemBus();
    }
  }

  /** Mute/unmute a single stem (0 = off, 1 = on). */
  setStemLevel(stem: StemName, level: number, smooth = true): void {
    const v = clamp(level, 0, 1);
    if (smooth) rampParam(this.stemGains[stem].gain, v, this.ctx.currentTime, 0.04);
    else this.stemGains[stem].gain.value = v;
  }

  setStemPreset(preset: StemPreset): void {
    const levels = levelsForPreset(preset);
    for (const s of STEM_NAMES) this.setStemLevel(s, levels[s], false);
  }

  /** Crossfade stem levels smoothly — avoids clicks when swapping acapella/instrumental. */
  rampStemPreset(preset: StemPreset, durationSec: number): void {
    const levels = levelsForPreset(preset);
    const now = this.ctx.currentTime;
    for (const s of STEM_NAMES) {
      linearRamp(this.stemGains[s].gain, levels[s], now, durationSec);
    }
  }

  getStemLevel(stem: StemName): number {
    return this.stemGains[stem].gain.value;
  }

  /** Peak level 0..1 for channel metering. */
  getOutputLevel(): number {
    // Approximate from volume * playing state; analyser added in AudioEngine.
    return this._playing ? this._volumeValue : 0;
  }

  get hasTrack(): boolean {
    return this.buffer !== null;
  }

  get playing(): boolean {
    return this._playing;
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  get rate(): number {
    return this._rate;
  }

  get volumeValue(): number {
    return this._volumeValue;
  }

  loadBuffer(buffer: AudioBuffer): void {
    this.stop();
    this.buffer = buffer;
    this.startOffset = 0;
  }

  /** Current playback position in seconds. */
  get position(): number {
    if (!this.buffer) return 0;
    if (!this._playing) return this.startOffset;
    const elapsed = (this.ctx.currentTime - this.startCtxTime) * this._rate;
    if (this.looping && this.loopLen > 0) {
      return this.loopStart + ((this.startOffset - this.loopStart + elapsed) % this.loopLen);
    }
    return clamp(this.startOffset + elapsed, 0, this.buffer.duration);
  }

  get isLooping(): boolean {
    return this.looping;
  }

  /** Loop a region starting at the current position for `lengthSec` seconds. */
  setLoop(lengthSec: number): void {
    if (!this.buffer || lengthSec <= 0) return;
    const start = this.position;
    this.loopStart = start;
    this.loopLen = Math.min(lengthSec, this.buffer.duration - start);
    this.looping = true;
    if (this.source || this.stemSources.length) {
      for (const src of this.activeSources()) {
        src.loopStart = this.loopStart;
        src.loopEnd = this.loopStart + this.loopLen;
        src.loop = true;
      }
      // Re-anchor so position math stays inside the loop.
      this.startOffset = this.loopStart;
      this.startCtxTime = this.ctx.currentTime;
    }
  }

  clearLoop(): void {
    if (!this.looping) return;
    const pos = this.position;
    this.looping = false;
    if (this.source || this.stemSources.length) {
      for (const src of this.activeSources()) src.loop = false;
      this.startOffset = pos;
      this.startCtxTime = this.ctx.currentTime;
    }
  }

  private createSource(): void {
    this.stopSource();
    if (this._stemsReady && this.buffer) {
      this.stemSources = [];
      for (const name of STEM_NAMES) {
        const buf = this.stemBuffers[name];
        if (!buf) continue;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = this._rate;
        src.connect(this.stemGains[name]);
        this.stemSources.push(src);
      }
      this.stemBus.gain.value = 1;
      this.connectStemBus();
      const anchor = this.startOffset;
      const t = this.ctx.currentTime;
      for (const src of this.stemSources) {
        if (this.looping && this.loopLen > 0) {
          src.loop = true;
          src.loopStart = this.loopStart;
          src.loopEnd = this.loopStart + this.loopLen;
        }
        src.start(t, anchor);
        src.onended = () => {
          if (this._playing && this.position >= this.duration - 0.05) {
            this._playing = false;
            this.startOffset = this.duration;
          }
        };
      }
      return;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this._rate;
    src.connect(this.routeInput());
    this.stemBus.gain.value = 0;
    if (this.looping && this.loopLen > 0) {
      src.loop = true;
      src.loopStart = this.loopStart;
      src.loopEnd = this.loopStart + this.loopLen;
    }
    src.onended = () => {
      if (this._playing && this.position >= this.duration - 0.05) {
        this._playing = false;
        this.startOffset = this.duration;
      }
    };
    this.source = src;
  }

  private activeSources(): AudioBufferSourceNode[] {
    if (this.stemSources.length) return this.stemSources;
    return this.source ? [this.source] : [];
  }

  /** Start (or resume) playback, optionally from a specific offset (cue point). */
  play(offset?: number): void {
    if (!this.buffer) return;
    if (this._playing && this.activeSources().length > 0) return;
    if (offset !== undefined) {
      this.startOffset = clamp(offset, 0, this.buffer.duration);
    }
    this.createSource();
    this.startCtxTime = this.ctx.currentTime;
    const t = this.startCtxTime;
    if (this.source) this.source.start(t, this.startOffset);
    this._playing = true;
  }

  pause(): void {
    if (!this._playing) return;
    this.startOffset = this.position;
    this.stopSource();
    this._playing = false;
  }

  toggle(): void {
    if (this._playing) this.pause();
    else this.play();
  }

  /** Seek to a position; preserves play/pause state. */
  seek(offset: number): void {
    const wasPlaying = this._playing;
    this.stopSource();
    this._playing = false;
    this.startOffset = clamp(offset, 0, this.duration);
    if (wasPlaying) this.play();
  }

  private stopSource(): void {
    for (const src of this.stemSources) {
      try {
        src.onended = null;
        src.stop();
      } catch {
        /* already stopped */
      }
      src.disconnect();
    }
    this.stemSources = [];
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
  }

  stop(): void {
    this.stopSource();
    this._playing = false;
    this.startOffset = 0;
  }

  /**
   * Set playback rate (tempo). With `keyLock`, SoundTouch keeps pitch natural
   * while matching BPM — used by SYNC and transition beatmatch.
   */
  setRate(rate: number, smooth = true, options?: { keyLock?: boolean }): void {
    if (options?.keyLock !== undefined) this.enableKeyLock(options.keyLock);
    this.applyRate(rate, smooth);
  }

  /** Apply rate without toggling key-lock routing (used by glideRate). */
  private applyRate(rate: number, smooth: boolean): void {
    const r = clamp(rate, 0.5, 2);
    this.startOffset = this.position;
    this.startCtxTime = this.ctx.currentTime;
    this._rate = r;
    const now = this.ctx.currentTime;
    for (const src of this.activeSources()) {
      if (smooth) rampParam(src.playbackRate, r, now, 0.05);
      else src.playbackRate.value = r;
    }
    if (this.keyLock && this.stretch) {
      if (smooth) {
        rampParam(this.stretch.playbackRate, r, now, 0.05);
        this.stretch.pitch.setValueAtTime(1, now);
      } else {
        this.stretch.playbackRate.value = r;
        this.stretch.pitch.value = 1;
      }
    }
  }

  /** Begin a scratch: remember the base rate to restore afterwards. */
  beginScratch(): void {
    if (this.scratching) return;
    this.scratchBaseRate = this._rate;
    this.scratching = true;
    this.enableKeyLock(false);
  }

  /** Set an instantaneous scratch rate (jog/pitch-bend). Negative = reverse scrub. */
  scratch(targetRate: number): void {
    if (!this.buffer) return;
    if (targetRate < 0) {
      const seekDelta = Math.abs(targetRate) * 0.028;
      const pos = clamp(this.position - seekDelta, 0, this.duration);
      if (Math.abs(pos - this.position) < 1e-4) return;
      const wasPlaying = this._playing;
      this.stopSource();
      this._playing = false;
      this.startOffset = pos;
      if (wasPlaying || this.scratching) this.play();
      return;
    }
    const r = clamp(targetRate, 0.1, 2.5);
    this.startOffset = this.position;
    this.startCtxTime = this.ctx.currentTime;
    this._rate = r;
    const now = this.ctx.currentTime;
    for (const src of this.activeSources()) {
      rampParam(src.playbackRate, r, now, 0.012);
    }
    if (this.keyLock && this.stretch) {
      rampParam(this.stretch.playbackRate, r, now, 0.012);
      this.stretch.pitch.setValueAtTime(1, now);
    }
  }

  /** End scratching and ramp back to the base rate. */
  endScratch(): void {
    if (!this.scratching) return;
    this.scratching = false;
    this.setRate(this.scratchBaseRate);
  }

  setVolume(value: number, smooth = true): void {
    this._volumeValue = clamp(value, 0, 1);
    if (smooth) rampParam(this.volume.gain, this._volumeValue, this.ctx.currentTime);
    else this.volume.gain.value = this._volumeValue;
  }

  /** Automate volume over a duration (for scripted transitions). */
  rampVolume(target: number, duration: number): void {
    this._volumeValue = clamp(target, 0, 1);
    linearRamp(this.volume.gain, this._volumeValue, this.ctx.currentTime, duration);
  }

  setEq(values: Partial<EqValues>): void {
    const now = this.ctx.currentTime;
    if (values.low !== undefined) rampParam(this.eqLow.gain, values.low, now);
    if (values.mid !== undefined) rampParam(this.eqMid.gain, values.mid, now);
    if (values.high !== undefined) rampParam(this.eqHigh.gain, values.high, now);
  }

  rampEqLow(targetDb: number, duration: number): void {
    linearRamp(this.eqLow.gain, targetDb, this.ctx.currentTime, duration);
  }

  getEq(): EqValues {
    return {
      low: this.eqLow.gain.value,
      mid: this.eqMid.gain.value,
      high: this.eqHigh.gain.value,
    };
  }

  /**
   * Single combined DJ filter knob in [-1, 1].
   *  0  => fully open (no effect)
   *  <0 => low-pass sweeping down (muffles)
   *  >0 => high-pass sweeping up (thins)
   */
  setFilter(knob: number, smooth = true): void {
    const k = clamp(knob, -1, 1);
    this._filterKnob = k;
    const now = this.ctx.currentTime;
    let hpFreq = FILTER_MIN;
    let lpFreq = FILTER_MAX;
    if (k < 0) {
      // map -1..0 to a downward low-pass sweep (exponential feel)
      const t = -k; // 0..1
      lpFreq = FILTER_MAX * Math.pow(200 / FILTER_MAX, t);
    } else if (k > 0) {
      const t = k;
      hpFreq = FILTER_MIN * Math.pow(3000 / FILTER_MIN, t);
    }
    if (smooth) {
      rampParam(this.hp.frequency, hpFreq, now, 0.04);
      rampParam(this.lp.frequency, lpFreq, now, 0.04);
    } else {
      this.hp.frequency.value = hpFreq;
      this.lp.frequency.value = lpFreq;
    }
  }

  /** Gradually sweep the combined filter knob to a target over `duration` s. */
  rampFilter(target: number, duration: number): void {
    const start = this._filterKnob;
    const to = clamp(target, -1, 1);
    const startTime = performance.now();
    const tick = () => {
      const t = clamp((performance.now() - startTime) / (duration * 1000), 0, 1);
      const eased = start + (to - start) * t;
      this._filterKnob = eased;
      this.setFilter(eased);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** Tape-stop: smoothly ramp the pitch down to a near-stop over `duration`. */
  brake(duration = 1.8): void {
    const sources = this.activeSources();
    if (!sources.length) return;
    const now = this.ctx.currentTime;
    for (const src of sources) {
      const pr = src.playbackRate;
      pr.cancelScheduledValues(now);
      pr.setValueAtTime(Math.max(0.06, pr.value), now);
      pr.linearRampToValueAtTime(0.04, now + duration);
    }
  }

  spinback(duration = 0.55): void {
    const sources = this.activeSources();
    if (!sources.length) return;
    const now = this.ctx.currentTime;
    for (const src of sources) {
      const pr = src.playbackRate;
      pr.cancelScheduledValues(now);
      pr.setValueAtTime(Math.max(0.1, pr.value), now);
      pr.exponentialRampToValueAtTime(0.06, now + duration);
    }
  }

  /**
   * Trance-gate: rhythmically chop the deck's volume for a stuttery build.
   * `division` is in beats (0.5 = 8th notes). Restores level afterwards.
   */
  gate(durationSec: number, secondsPerBeat: number, division = 0.5): void {
    const now = this.ctx.currentTime;
    const stepSec = Math.max(0.04, secondsPerBeat * division);
    const totalSteps = Math.max(2, Math.round(durationSec / stepSec));
    const perStep = 12;
    const curve = new Float32Array(totalSteps * perStep);
    for (let s = 0; s < totalSteps; s++) {
      const on = s % 2 === 0 ? 1 : 0;
      for (let k = 0; k < perStep; k++) {
        // Soft attack/release within each gate step to avoid clicks.
        const env = on ? Math.sin((Math.min(k, perStep - k) / perStep) * Math.PI) : 0;
        curve[s * perStep + k] = on ? Math.max(0.04, env) * this._volumeValue : 0;
      }
    }
    const dur = totalSteps * stepSec;
    this.volume.gain.cancelScheduledValues(now);
    this.volume.gain.setValueCurveAtTime(curve, now, dur);
    this.volume.gain.setValueAtTime(this._volumeValue, now + dur + 0.001);
  }

  private glideRaf: number | null = null;

  /** Gradually glide playback rate; keeps pitch locked for the whole glide when requested. */
  glideRate(
    target: number,
    duration: number,
    options?: { keyLock?: boolean; releaseKeyLockAtEnd?: boolean; onComplete?: () => void },
  ): void {
    if (this.glideRaf !== null) cancelAnimationFrame(this.glideRaf);
    if (options?.keyLock !== undefined) this.enableKeyLock(options.keyLock);
    const start = this._rate;
    const to = clamp(target, 0.5, 2);
    const startTime = performance.now();
    const tick = () => {
      const raw = clamp((performance.now() - startTime) / (duration * 1000), 0, 1);
      const t = raw * raw * (3 - 2 * raw);
      this.applyRate(start + (to - start) * t, false);
      if (raw < 1 && this._playing) {
        this.glideRaf = requestAnimationFrame(tick);
        return;
      }
      this.glideRaf = null;
      if (options?.releaseKeyLockAtEnd && Math.abs(to - 1) < 0.001) {
        this.enableKeyLock(false);
      }
      options?.onComplete?.();
    };
    this.glideRaf = requestAnimationFrame(tick);
  }

  cancelGlideRate(): void {
    if (this.glideRaf !== null) {
      cancelAnimationFrame(this.glideRaf);
      this.glideRaf = null;
    }
  }
}
