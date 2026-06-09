import { clamp, rampParam } from "./audioMath";

/**
 * A simple tempo-syncable feedback delay used for "echo out" transitions.
 * A send gain controls how much signal is thrown into the echo.
 */
export class EchoSend {
  readonly ctx: AudioContext;
  readonly input: GainNode; // connect deck output here
  private readonly delay: DelayNode;
  private readonly feedback: GainNode;
  private readonly wet: GainNode;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.input.gain.value = 0; // send amount, 0 = off

    this.delay = ctx.createDelay(2.0);
    this.delay.delayTime.value = 0.4;

    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0.45;

    this.wet = ctx.createGain();
    this.wet.gain.value = 1;

    this.input.connect(this.delay);
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.delay.connect(this.wet);
    this.wet.connect(destination);
  }

  /** Set echo time from BPM (defaults to a 1/4-note echo). */
  setTimeFromBpm(bpm: number, division = 1): void {
    if (!bpm || bpm <= 0) return;
    const quarter = 60 / bpm;
    this.delay.delayTime.setTargetAtTime(
      clamp(quarter * division, 0.02, 2),
      this.ctx.currentTime,
      0.02,
    );
  }

  /** Send amount in [0, 1]. */
  setSend(amount: number): void {
    rampParam(this.input.gain, clamp(amount, 0, 1), this.ctx.currentTime, 0.03);
  }

  setFeedback(amount: number): void {
    rampParam(this.feedback.gain, clamp(amount, 0, 0.95), this.ctx.currentTime, 0.03);
  }
}

/**
 * A lush reverb send for big "wash" transitions. A synthesized impulse
 * response (exponentially-decaying noise) keeps it dependency-free.
 */
export class ReverbSend {
  readonly ctx: AudioContext;
  readonly input: GainNode; // connect deck output here
  private readonly convolver: ConvolverNode;
  private readonly wet: GainNode;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.input.gain.value = 0; // send amount, 0 = off

    this.convolver = ctx.createConvolver();
    this.convolver.buffer = makeImpulse(ctx, 2.8, 2.4);

    this.wet = ctx.createGain();
    this.wet.gain.value = 1;

    this.input.connect(this.convolver);
    this.convolver.connect(this.wet);
    this.wet.connect(destination);
  }

  /** Send amount in [0, 1]. */
  setSend(amount: number): void {
    rampParam(this.input.gain, clamp(amount, 0, 1), this.ctx.currentTime, 0.05);
  }
}

function makeImpulse(ctx: AudioContext, durationSec: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * durationSec));
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}
