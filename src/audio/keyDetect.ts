// Best-effort musical key detection via chromagram + Krumhansl-Schmuckler.
// Not perfect from audio alone, but good enough to guide harmonic mixing.

const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Krumhansl-Schmuckler key profiles.
const MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

// Camelot wheel mapping: [majorCamelot, minorCamelot] indexed by pitch class (C..B).
const CAMELOT_MAJOR = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"];
const CAMELOT_MINOR = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"];

export interface KeyResult {
  camelot: string;
  name: string; // e.g. "A minor"
}

/** Iterative in-place radix-2 FFT on real input; returns magnitude spectrum. */
function fftMagnitude(input: Float32Array): Float32Array {
  const n = input.length;
  const re = Float32Array.from(input);
  const im = new Float32Array(n);

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + len / 2] = aRe - bRe;
        im[i + k + len / 2] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }

  const mag = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

function buildChroma(mono: Float32Array, sampleRate: number): number[] {
  const fftSize = 4096;
  const hop = fftSize; // non-overlapping windows keep it fast
  const chroma = new Array(12).fill(0);
  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1)); // Hann
  }

  // Sample at most ~400 windows spread across the track for speed.
  const totalWindows = Math.floor((mono.length - fftSize) / hop);
  const stride = Math.max(1, Math.floor(totalWindows / 400));

  const frame = new Float32Array(fftSize);
  for (let w = 0; w < totalWindows; w += stride) {
    const start = w * hop;
    for (let i = 0; i < fftSize; i++) frame[i] = mono[start + i] * window[i];
    const mag = fftMagnitude(frame);
    for (let bin = 1; bin < mag.length; bin++) {
      const freq = (bin * sampleRate) / fftSize;
      if (freq < 55 || freq > 4000) continue;
      const midi = 69 + 12 * Math.log2(freq / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] += mag[bin];
    }
  }
  const sum = chroma.reduce((a, b) => a + b, 0) || 1;
  return chroma.map((v) => v / sum);
}

function correlate(a: number[], b: number[]): number {
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / (Math.sqrt(da * db) || 1);
}

export function detectKey(mono: Float32Array, sampleRate: number): KeyResult | null {
  try {
    const chroma = buildChroma(mono, sampleRate);
    let best = { score: -Infinity, pc: 0, major: true };
    for (let pc = 0; pc < 12; pc++) {
      const rotMajor = MAJOR_PROFILE.map((_, i) => MAJOR_PROFILE[(i - pc + 12) % 12]);
      const rotMinor = MINOR_PROFILE.map((_, i) => MINOR_PROFILE[(i - pc + 12) % 12]);
      const sMaj = correlate(chroma, rotMajor);
      const sMin = correlate(chroma, rotMinor);
      if (sMaj > best.score) best = { score: sMaj, pc, major: true };
      if (sMin > best.score) best = { score: sMin, pc, major: false };
    }
    const name = `${PITCH_NAMES[best.pc]} ${best.major ? "major" : "minor"}`;
    const camelot = best.major ? CAMELOT_MAJOR[best.pc] : CAMELOT_MINOR[best.pc];
    return { camelot, name };
  } catch {
    return null;
  }
}
