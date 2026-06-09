import type { BeatInfo } from "../audio/bpm";
import { detectKey } from "../audio/keyDetect";
import type {
  TrackAnalysis,
  TrackSection,
  SectionKind,
} from "./recipeTypes";

/** Mix all channels to a single mono Float32Array. */
function toMono(buffer: AudioBuffer): Float32Array {
  const len = buffer.length;
  const mono = new Float32Array(len);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) mono[i] += data[i];
  }
  const inv = 1 / buffer.numberOfChannels;
  for (let i = 0; i < len; i++) mono[i] *= inv;
  return mono;
}

/** RMS energy curve sampled at ~`hopSec` resolution, normalized 0..1. */
function energyCurve(mono: Float32Array, sampleRate: number, hopSec: number): number[] {
  const hop = Math.max(1, Math.floor(sampleRate * hopSec));
  const out: number[] = [];
  for (let i = 0; i < mono.length; i += hop) {
    let sum = 0;
    const end = Math.min(mono.length, i + hop);
    for (let j = i; j < end; j++) sum += mono[j] * mono[j];
    out.push(Math.sqrt(sum / (end - i)));
  }
  const max = Math.max(...out, 1e-6);
  return out.map((v) => v / max);
}

/** Estimate vocal presence via mid-band (300-3000Hz) energy fluctuation. */
function estimateVocalProbability(mono: Float32Array, sampleRate: number): number {
  // Cheap proxy: vocals add strong, variable mid-band content.
  // Compare framed mid-band energy variance to full-band.
  const frame = Math.floor(sampleRate * 0.25);
  let prevMid = 0;
  let flux = 0;
  let count = 0;
  // simple one-pole bandpass-ish via difference of running means
  for (let i = 0; i + frame < mono.length; i += frame) {
    let lowSum = 0;
    let midSum = 0;
    for (let j = i; j < i + frame; j++) {
      const s = mono[j];
      lowSum += Math.abs(s);
      // crude high-frequency emphasis
      const hp = j > 0 ? s - mono[j - 1] : 0;
      midSum += Math.abs(hp);
    }
    const mid = midSum / (lowSum + 1e-6);
    flux += Math.abs(mid - prevMid);
    prevMid = mid;
    count++;
  }
  const avgFlux = flux / (count || 1);
  return Math.max(0, Math.min(1, avgFlux * 2.5));
}

function segmentSections(energy: number[], hopSec: number, duration: number): TrackSection[] {
  if (energy.length === 0) return [];
  const sections: TrackSection[] = [];
  // Smooth the curve
  const smooth = energy.map((_, i) => {
    const a = Math.max(0, i - 2);
    const b = Math.min(energy.length, i + 3);
    let s = 0;
    for (let k = a; k < b; k++) s += energy[k];
    return s / (b - a);
  });

  const classify = (e: number): SectionKind => {
    if (e > 0.78) return "drop";
    if (e > 0.55) return "chorus";
    if (e > 0.35) return "build";
    if (e > 0.18) return "verse";
    return "breakdown";
  };

  let startIdx = 0;
  let curKind = classify(smooth[0]);
  const minLen = Math.max(2, Math.floor(4 / hopSec)); // >= ~4s

  const push = (endIdx: number, kind: SectionKind) => {
    const start = startIdx * hopSec;
    const end = Math.min(duration, endIdx * hopSec);
    if (end - start < 0.5) return;
    let sum = 0;
    for (let k = startIdx; k < endIdx; k++) sum += smooth[k] ?? 0;
    sections.push({ start, end, kind, energy: sum / Math.max(1, endIdx - startIdx) });
  };

  for (let i = 1; i < smooth.length; i++) {
    const kind = classify(smooth[i]);
    if (kind !== curKind && i - startIdx >= minLen) {
      push(i, curKind);
      startIdx = i;
      curKind = kind;
    }
  }
  push(smooth.length, curKind);

  // Label the very first and last segments as intro/outro for clarity.
  if (sections.length > 0) {
    if (sections[0].energy < 0.5) sections[0].kind = "intro";
    const last = sections[sections.length - 1];
    if (last.energy < 0.5) last.kind = "outro";
  }
  return sections;
}

function findDrops(energy: number[], hopSec: number): number[] {
  const drops: number[] = [];
  for (let i = 4; i < energy.length - 1; i++) {
    const before = (energy[i - 4] + energy[i - 3] + energy[i - 2]) / 3;
    if (energy[i] > 0.72 && before < 0.45 && energy[i] >= energy[i - 1]) {
      drops.push(i * hopSec);
      i += Math.floor(8 / hopSec); // skip ahead to avoid duplicates
    }
  }
  return drops;
}

export async function analyzeTrack(
  buffer: AudioBuffer,
  fileName: string,
  beat: BeatInfo,
): Promise<TrackAnalysis> {
  const mono = toMono(buffer);
  const hopSec = 0.5;
  const energy = energyCurve(mono, buffer.sampleRate, hopSec);
  const sections = segmentSections(energy, hopSec, buffer.duration);
  const drops = findDrops(energy, hopSec);
  const vocalProbability = estimateVocalProbability(mono, buffer.sampleRate);

  // Downsample for key detection to keep the FFT cheap.
  const key = detectKey(mono, buffer.sampleRate);

  // Compact the energy curve to ~64 points for transport to the AI.
  const compact = compactCurve(energy, 64);

  return {
    fileName,
    durationSec: buffer.duration,
    bpm: beat.bpm,
    beatOffset: beat.offset,
    camelotKey: key?.camelot ?? null,
    keyName: key?.name ?? null,
    sections,
    drops,
    energyCurve: compact,
    vocalProbability,
  };
}

function compactCurve(curve: number[], points: number): number[] {
  if (curve.length <= points) return curve.map(round2);
  const out: number[] = [];
  const step = curve.length / points;
  for (let i = 0; i < points; i++) {
    const a = Math.floor(i * step);
    const b = Math.floor((i + 1) * step);
    let s = 0;
    for (let k = a; k < b; k++) s += curve[k];
    out.push(round2(s / Math.max(1, b - a)));
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
