// Adapts hand-height readings to the user's reach so "low" and "high"
// map to the full control range regardless of how tall they are / how
// they sit relative to the camera.

const KEY = "gdj.calibration.v1";

export interface Calibration {
  topY: number; // y value when hand is raised high (smaller = higher)
  bottomY: number; // y value when hand is lowered
}

const DEFAULT: Calibration = { topY: 0.2, bottomY: 0.85 };

export function loadCalibration(): Calibration {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT, ...(JSON.parse(raw) as Calibration) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT };
}

export function saveCalibration(cal: Calibration): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cal));
  } catch {
    /* ignore */
  }
}

/** Map a raw y (0 top .. 1 bottom) to a control value (0 bottom .. 1 top). */
export function heightToValue(rawY: number, cal: Calibration): number {
  const { topY, bottomY } = cal;
  const t = (bottomY - rawY) / (bottomY - topY || 1);
  return Math.min(1, Math.max(0, t));
}
