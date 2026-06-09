// Shared helpers for click-free Web Audio parameter automation and curves.

export const SMOOTH_TIME = 0.02; // seconds; short ramp to avoid zipper noise

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Smoothly move an AudioParam toward a target without clicks. */
export function rampParam(
  param: AudioParam,
  target: number,
  now: number,
  time = SMOOTH_TIME,
): void {
  // setTargetAtTime uses an exponential approach; timeConstant ~= time/3.
  param.setTargetAtTime(target, now, Math.max(0.005, time / 3));
}

/** Linear ramp over a fixed duration (used for scripted automation). */
export function linearRamp(
  param: AudioParam,
  target: number,
  now: number,
  duration: number,
): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(target, now + Math.max(0.001, duration));
}

/**
 * Equal-power crossfade gains for a position in [0, 1].
 * 0 => full A, 1 => full B. Keeps perceived loudness constant across the fade.
 */
export function equalPowerGains(position: number): { a: number; b: number } {
  const p = clamp(position, 0, 1);
  const angle = p * (Math.PI / 2);
  return { a: Math.cos(angle), b: Math.sin(angle) };
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}
