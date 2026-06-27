import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// MediaPipe hand landmark indices.
const WRIST = 0;
const THUMB_MCP = 2;
const THUMB_IP = 3;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_MCP = 13;
const RING_PIP = 14;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const PINKY_TIP = 20;

export type Pose = "open" | "fist" | "pinch" | "point" | "peace" | "none";

export interface HandFeatures {
  x: number; // palm center x in [0,1], mirrored to selfie screen space
  y: number; // palm center y in [0,1] (0 top, 1 bottom)
  pose: Pose;
  pinch: number; // 0 open .. 1 thumb+index touching
  openness: number; // 0 fist .. 1 fully open (fraction of extended fingers)
  fingers: { thumb: boolean; index: boolean; middle: boolean; ring: boolean; pinky: boolean };
}

export const GESTURE_THRESHOLDS = {
  fingerStraight: 0.52,
  thumbStraight: 0.78,
  pinchDist: 0.62,
  fistOpenness: 0.22,
  openPalm: 0.42,
};

interface V2 {
  x: number;
  y: number;
}

function sub(a: NormalizedLandmark, b: NormalizedLandmark): V2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function dot(a: V2, b: V2): number {
  return a.x * b.x + a.y * b.y;
}

function mag(a: V2): number {
  return Math.hypot(a.x, a.y) || 1e-6;
}

function dist(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * A finger is extended when joints are collinear OR the tip reaches past the pip.
 * The dual test catches curled-in-webcam angles that fail the cosine check alone.
 */
function fingerExtended(
  lm: NormalizedLandmark[],
  mcp: number,
  pip: number,
  tip: number,
  scale: number,
  straightThreshold: number,
): boolean {
  const a = sub(lm[pip], lm[mcp]);
  const b = sub(lm[tip], lm[pip]);
  const straight = dot(a, b) / (mag(a) * mag(b)) > straightThreshold;
  const tipReach = dist(lm[tip], lm[WRIST]) / scale;
  const pipReach = dist(lm[pip], lm[WRIST]) / scale;
  const byReach = tipReach > pipReach * 1.12;
  return straight || byReach;
}

export function extractFeatures(
  landmarks: NormalizedLandmark[],
  mirror = true,
): HandFeatures {
  const wrist = landmarks[WRIST];
  const middleMcp = landmarks[MIDDLE_MCP];
  const cx = (wrist.x + middleMcp.x) / 2;
  const cy = (wrist.y + middleMcp.y) / 2;
  const scale = dist(wrist, middleMcp) || 1e-3;
  const t = GESTURE_THRESHOLDS;

  const fingers = {
    thumb: fingerExtended(
      landmarks,
      THUMB_MCP,
      THUMB_IP,
      THUMB_TIP,
      scale,
      t.thumbStraight,
    ),
    index: fingerExtended(landmarks, INDEX_MCP, INDEX_PIP, INDEX_TIP, scale, t.fingerStraight),
    middle: fingerExtended(landmarks, MIDDLE_MCP, MIDDLE_PIP, MIDDLE_TIP, scale, t.fingerStraight),
    ring: fingerExtended(landmarks, RING_MCP, RING_PIP, RING_TIP, scale, t.fingerStraight),
    pinky: fingerExtended(landmarks, PINKY_MCP, PINKY_PIP, PINKY_TIP, scale, t.fingerStraight),
  };

  const extendedCount =
    Number(fingers.index) +
    Number(fingers.middle) +
    Number(fingers.ring) +
    Number(fingers.pinky);

  const pinchDist = dist(landmarks[THUMB_TIP], landmarks[INDEX_TIP]) / scale;
  const pinch = clamp01(1 - (pinchDist - 0.15) / 0.75);
  const strongPinch = pinchDist < t.pinchDist || pinch > 0.55;
  const isPinch =
    strongPinch &&
    (!fingers.middle || pinch > 0.72) &&
    (!fingers.ring || pinch > 0.78);

  const openness = extendedCount / 4;

  let pose: Pose;
  if (isPinch) {
    pose = "pinch";
  } else if (extendedCount === 0 || openness <= t.fistOpenness) {
    pose = "fist";
  } else if (fingers.index && !fingers.middle && extendedCount <= 2) {
    pose = "point";
  } else if (fingers.index && fingers.middle && !fingers.ring) {
    pose = "peace";
  } else if (extendedCount >= 2 && openness >= t.openPalm) {
    pose = "open";
  } else if (fingers.index && fingers.middle) {
    pose = "peace";
  } else if (fingers.index) {
    pose = "point";
  } else {
    pose = "none";
  }

  return {
    x: clamp01(mirror ? 1 - cx : cx),
    y: clamp01(cy),
    pose,
    pinch,
    openness,
    fingers,
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
