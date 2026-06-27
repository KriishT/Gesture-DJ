import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { extractFeatures, type HandFeatures } from "./gestures";
import { OneEuroFilter } from "./smoothing";

const WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm";
const LOCAL_MODEL = "/models/hand_landmarker.task";
const CDN_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export interface TrackedHand {
  features: HandFeatures;
  landmarks: NormalizedLandmark[]; // raw, mirrored handled by drawer
}

export interface FrameResult {
  left: TrackedHand | null; // user's left hand -> Deck A
  right: TrackedHand | null; // user's right hand -> Deck B
  raw: HandLandmarkerResult;
}

interface AxisFilters {
  x: OneEuroFilter;
  y: OneEuroFilter;
  open: OneEuroFilter;
  pinch: OneEuroFilter;
}

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private running = false;
  private rafId: number | null = null;
  private lastVideoTime = -1;
  private onResult: (r: FrameResult) => void = () => {};

  private filters: Record<"left" | "right", AxisFilters> = {
    left: makeFilters(),
    right: makeFilters(),
  };
  /** Prevents deck flip when a single hand hovers near screen center. */
  private lastSingleSide: "left" | "right" | null = null;

  async init(video: HTMLVideoElement): Promise<void> {
    this.video = video;
    const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
    this.landmarker = await this.createLandmarker(vision);

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: "user" },
      audio: false,
    });
    video.srcObject = this.stream;
    await video.play();
  }

  private async createLandmarker(
    vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
  ): Promise<HandLandmarker> {
    const make = (modelAssetPath: string) =>
      HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.4,
        minHandPresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
      });
    try {
      return await make(LOCAL_MODEL);
    } catch {
      // Fall back to Google-hosted model if the local copy is missing.
      return await make(CDN_MODEL);
    }
  }

  start(onResult: (r: FrameResult) => void): void {
    this.onResult = onResult;
    this.running = true;
    this.loop();
  }

  private loop = (): void => {
    if (!this.running || !this.landmarker || !this.video) return;
    this.rafId = requestAnimationFrame(this.loop);
    const video = this.video;
    if (video.readyState < 2 || video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;

    const result = this.landmarker.detectForVideo(video, performance.now());
    this.onResult(this.assign(result));
  };

  private assign(result: HandLandmarkerResult): FrameResult {
    const now = performance.now();
    const hands = result.landmarks ?? [];
    // Compute mirrored screen x to decide left/right side.
    const items = hands.map((lm) => ({ lm, feat: extractFeatures(lm, true) }));
    items.sort((a, b) => a.feat.x - b.feat.x); // smaller x = user's left

    let left: TrackedHand | null = null;
    let right: TrackedHand | null = null;
    if (items.length === 1) {
      const only = items[0];
      let side: "left" | "right";
      if (only.feat.x < 0.36) side = "left";
      else if (only.feat.x > 0.64) side = "right";
      else side = this.lastSingleSide ?? (only.feat.x < 0.5 ? "left" : "right");
      this.lastSingleSide = side;
      if (side === "left") left = this.smooth("left", only);
      else right = this.smooth("right", only);
    } else if (items.length >= 2) {
      this.lastSingleSide = null;
      left = this.smooth("left", items[0]);
      right = this.smooth("right", items[items.length - 1]);
    }
    if (!left) this.reset("left", now);
    if (!right) this.reset("right", now);
    return { left, right, raw: result };
  }

  private smooth(
    side: "left" | "right",
    item: { lm: NormalizedLandmark[]; feat: HandFeatures },
  ): TrackedHand {
    const now = performance.now();
    const f = this.filters[side];
    return {
      landmarks: item.lm,
      features: {
        ...item.feat,
        x: f.x.filter(item.feat.x, now),
        y: f.y.filter(item.feat.y, now),
        openness: f.open.filter(item.feat.openness, now),
        pinch: f.pinch.filter(item.feat.pinch, now),
      },
    };
  }

  private reset(side: "left" | "right", _now: number): void {
    // Reinitialize filters so a re-acquired hand doesn't jump.
    this.filters[side] = makeFilters();
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.landmarker?.close();
    this.landmarker = null;
  }
}

function makeFilters(): AxisFilters {
  return {
    x: new OneEuroFilter(1.0, 0.022),
    y: new OneEuroFilter(1.0, 0.022),
    open: new OneEuroFilter(1.6, 0.028),
    pinch: new OneEuroFilter(1.6, 0.028),
  };
}
