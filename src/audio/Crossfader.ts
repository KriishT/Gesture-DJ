import { equalPowerGains, rampParam, clamp } from "./audioMath";

/**
 * Equal-power crossfader between two deck channels.
 * position in [0, 1]: 0 => full A, 0.5 => both, 1 => full B.
 */
export class Crossfader {
  readonly ctx: AudioContext;
  readonly inputA: GainNode;
  readonly inputB: GainNode;
  private _position = 0.5;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.inputA = ctx.createGain();
    this.inputB = ctx.createGain();
    this.inputA.connect(destination);
    this.inputB.connect(destination);
    this.setPosition(0, false); // default full A so a lone deck is at unity
  }

  get position(): number {
    return this._position;
  }

  setPosition(position: number, smooth = true): void {
    this._position = clamp(position, 0, 1);
    const { a, b } = equalPowerGains(this._position);
    const now = this.ctx.currentTime;
    if (smooth) {
      rampParam(this.inputA.gain, a, now);
      rampParam(this.inputB.gain, b, now);
    } else {
      this.inputA.gain.value = a;
      this.inputB.gain.value = b;
    }
  }
}
