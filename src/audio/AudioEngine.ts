import { Deck, type DeckId } from "./Deck";
import { Crossfader } from "./Crossfader";
import { EchoSend, ReverbSend } from "./effects";
import { clamp } from "./audioMath";
import { SoundTouchNode } from "@soundtouchjs/audio-worklet";
import processorUrl from "@soundtouchjs/audio-worklet/processor?url";

/**
 * Owns the AudioContext and the whole mixing graph:
 *   Deck A ─┐
 *           ├─ Crossfader ─ master ─ analyser ─ destination
 *   Deck B ─┘
 * Each deck output also feeds a per-deck EchoSend into the master bus.
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly deckA: Deck;
  readonly deckB: Deck;
  readonly crossfader: Crossfader;
  readonly echoA: EchoSend;
  readonly echoB: EchoSend;
  readonly reverbA: ReverbSend;
  readonly reverbB: ReverbSend;

  private readonly master: GainNode;
  private readonly analyser: AnalyserNode;
  private readonly analyserA: AnalyserNode;
  private readonly analyserB: AnalyserNode;
  private readonly recordDest: MediaStreamAudioDestinationNode;
  private readonly freqData: Uint8Array;
  private readonly timeData: Uint8Array;
  private readonly timeDataA: Uint8Array;
  private readonly timeDataB: Uint8Array;
  private readonly pitchLockReady: Promise<boolean>;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: "interactive" });

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;

    this.analyserA = this.ctx.createAnalyser();
    this.analyserA.fftSize = 512;
    this.analyserA.smoothingTimeConstant = 0.75;
    this.analyserB = this.ctx.createAnalyser();
    this.analyserB.fftSize = 512;
    this.analyserB.smoothingTimeConstant = 0.75;

    this.freqData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    this.timeData = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
    this.timeDataA = new Uint8Array(new ArrayBuffer(this.analyserA.fftSize));
    this.timeDataB = new Uint8Array(new ArrayBuffer(this.analyserB.fftSize));

    this.master.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    // Tap for recording shareable clips (does not affect playback).
    this.recordDest = this.ctx.createMediaStreamDestination();
    this.master.connect(this.recordDest);

    this.crossfader = new Crossfader(this.ctx, this.master);
    this.deckA = new Deck("A", this.ctx);
    this.deckB = new Deck("B", this.ctx);
    this.deckA.output.connect(this.crossfader.inputA);
    this.deckB.output.connect(this.crossfader.inputB);
    this.deckA.output.connect(this.analyserA);
    this.deckB.output.connect(this.analyserB);

    this.echoA = new EchoSend(this.ctx, this.master);
    this.echoB = new EchoSend(this.ctx, this.master);
    this.deckA.output.connect(this.echoA.input);
    this.deckB.output.connect(this.echoB.input);

    this.reverbA = new ReverbSend(this.ctx, this.master);
    this.reverbB = new ReverbSend(this.ctx, this.master);
    this.deckA.output.connect(this.reverbA.input);
    this.deckB.output.connect(this.reverbB.input);

    this.pitchLockReady = this.initPitchLock();
  }

  private async initPitchLock(): Promise<boolean> {
    try {
      await SoundTouchNode.register(this.ctx, processorUrl);
      this.deckA.initStretch();
      this.deckB.initStretch();
      return true;
    } catch (err) {
      console.warn("[Gesture DJ] Pitch-lock unavailable — SYNC will use vinyl tempo.", err);
      return false;
    }
  }

  /** Wait for SoundTouch worklet registration (call on first user gesture). */
  async ensurePitchLock(): Promise<boolean> {
    return this.pitchLockReady;
  }

  deck(id: DeckId): Deck {
    return id === "A" ? this.deckA : this.deckB;
  }

  echo(id: DeckId): EchoSend {
    return id === "A" ? this.echoA : this.echoB;
  }

  reverb(id: DeckId): ReverbSend {
    return id === "A" ? this.reverbA : this.reverbB;
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== "running") {
      await this.ctx.resume();
    }
  }

  async decode(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    return await this.ctx.decodeAudioData(arrayBuffer);
  }

  setMasterVolume(value: number): void {
    this.master.gain.setTargetAtTime(clamp(value, 0, 1), this.ctx.currentTime, 0.02);
  }

  /** Master output level (RMS-ish) in [0, 1] for VU metering. */
  getMasterLevel(): number {
    return this.rmsFromAnalyser(this.analyser, this.timeData);
  }

  getDeckLevel(id: DeckId): number {
    return id === "A"
      ? this.rmsFromAnalyser(this.analyserA, this.timeDataA)
      : this.rmsFromAnalyser(this.analyserB, this.timeDataB);
  }

  private rmsFromAnalyser(analyser: AnalyserNode, buf: Uint8Array): number {
    analyser.getByteTimeDomainData(buf as Uint8Array<ArrayBuffer>);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    return clamp(Math.sqrt(sum / buf.length) * 1.8, 0, 1);
  }

  getFrequencyData(): Uint8Array {
    this.analyser.getByteFrequencyData(this.freqData as Uint8Array<ArrayBuffer>);
    return this.freqData;
  }

  /** Audio MediaStream of the master mix, for recording shareable clips. */
  getAudioStream(): MediaStream {
    return this.recordDest.stream;
  }
}
