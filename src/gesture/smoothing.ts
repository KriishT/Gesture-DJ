// One-Euro filter: low latency + low jitter smoothing for noisy signals.
// Reference: Casiez et al., "1€ Filter".

import type { Pose } from "./gestures";

class LowPass {
  private y: number | null = null;
  private s: number | null = null;

  filter(value: number, alpha: number): number {
    if (this.y === null) {
      this.s = value;
    } else {
      this.s = alpha * value + (1 - alpha) * (this.s as number);
    }
    this.y = value;
    return this.s as number;
  }

  hasLast(): boolean {
    return this.y !== null;
  }

  last(): number {
    return this.s ?? 0;
  }
}

export class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private x = new LowPass();
  private dx = new LowPass();
  private lastTime: number | null = null;

  constructor(minCutoff = 1.4, beta = 0.02, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, timestampMs: number): number {
    const t = timestampMs / 1000;
    if (this.lastTime === null) {
      this.lastTime = t;
      return this.x.filter(value, 1);
    }
    const dt = Math.max(1e-3, t - this.lastTime);
    this.lastTime = t;

    const dValue = this.x.hasLast() ? (value - this.x.last()) / dt : 0;
    const edValue = this.dx.filter(dValue, this.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edValue);
    return this.x.filter(value, this.alpha(cutoff, dt));
  }
}

/** Debounce a boolean so brief flickers don't trigger/untrigger. */
export class BoolDebounce {
  private state: boolean;
  private pending: boolean;
  private pendingSince = 0;
  private holdMs: number;

  constructor(initial = false, holdMs = 120) {
    this.state = initial;
    this.pending = initial;
    this.holdMs = holdMs;
  }

  update(raw: boolean, nowMs: number): boolean {
    if (raw === this.pending) {
      if (raw !== this.state && nowMs - this.pendingSince >= this.holdMs) {
        this.state = raw;
      }
    } else {
      this.pending = raw;
      this.pendingSince = nowMs;
    }
    return this.state;
  }

  get value(): boolean {
    return this.state;
  }
}

/** Fast to activate poses, slower to release — reduces flicker without feeling laggy. */
export class PoseDebouncer {
  private active: Pose = "none";
  private candidate: Pose = "none";
  private candidateSince = 0;

  constructor(
    private enterMs = 42,
    private exitMs = 95,
  ) {}

  update(raw: Pose, nowMs: number): Pose {
    if (raw === this.active) {
      this.candidate = raw;
      return this.active;
    }
    if (raw !== this.candidate) {
      this.candidate = raw;
      this.candidateSince = nowMs;
    }
    const hold = raw === "none" || raw === this.active ? this.exitMs : this.enterMs;
    if (nowMs - this.candidateSince >= hold) {
      this.active = raw;
    }
    return this.active;
  }

  reset(): void {
    this.active = "none";
    this.candidate = "none";
    this.candidateSince = 0;
  }
}
