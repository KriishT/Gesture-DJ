import { useEffect, useRef } from "react";
import { session } from "../session";
import { useStore } from "../state/store";
import { CoachOverlay } from "./CoachOverlay";
import { ActionCue } from "./ActionCue";

function coverFit(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): { dx: number; dy: number; dw: number; dh: number } {
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const dw = srcW * scale;
  const dh = srcH * scale;
  return { dx: (dstW - dw) / 2, dy: (dstH - dh) / 2, dw, dh };
}

const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export function CameraOverlay() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gesture = useStore((s) => s.gesture);

  useEffect(() => {
    session.overlayCanvas = canvasRef.current;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const video = videoRef.current;
      const frame = session.latestFrame;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Mirror the whole canvas so it matches a selfie view.
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);

      // Composite the camera frame (cover-fit) so clips capture everything.
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        const { dx, dy, dw, dh } = coverFit(video.videoWidth, video.videoHeight, w, h);
        ctx.drawImage(video, dx, dy, dw, dh);
      }

      if (frame) {
        const drawHand = (
          landmarks: { x: number; y: number }[] | undefined,
          color: string,
        ) => {
          if (!landmarks) return;
          const px = (lm: { x: number; y: number }) => lm.x * w;
          const py = (lm: { x: number; y: number }) => lm.y * h;
          ctx.strokeStyle = color;
          ctx.lineWidth = 2.5;
          for (const [a, b] of HAND_CONNECTIONS) {
            ctx.beginPath();
            ctx.moveTo(px(landmarks[a]), py(landmarks[a]));
            ctx.lineTo(px(landmarks[b]), py(landmarks[b]));
            ctx.stroke();
          }
          ctx.fillStyle = color;
          for (const lm of landmarks) {
            ctx.beginPath();
            ctx.arc(px(lm), py(lm), 3.5, 0, Math.PI * 2);
            ctx.fill();
          }
        };
        drawHand(frame.left?.landmarks, "#ff5e7e");
        drawHand(frame.right?.landmarks, "#00d2a8");
      }
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      session.overlayCanvas = null;
    };
  }, []);

  // Start/stop camera based on enabled flag.
  useEffect(() => {
    if (gesture.enabled && videoRef.current) {
      if (gesture.status === "off") void session.enableCamera(videoRef.current);
    }
  }, [gesture.enabled, gesture.status]);

  const labelText = (g: string) =>
    ({
      volume: "Volume",
      filter: "Filter",
      bassKill: "Bass kill",
      play: "Play / Pause",
      scratch: "Scratch",
      idle: "Ready",
      none: "",
    }[g] ?? "");

  return (
    <div className="camera-panel">
      <video ref={videoRef} playsInline muted />
      <canvas ref={canvasRef} className="overlay" />

      {gesture.left.detected && (
        <div className="hand-badge left">L · {labelText(gesture.left.gesture)}</div>
      )}
      {gesture.right.detected && (
        <div className="hand-badge right">R · {labelText(gesture.right.gesture)}</div>
      )}

      {!gesture.enabled && (
        <div className="camera-empty">
          <div>
            <div style={{ fontSize: 30, marginBottom: 8 }}>🖐️</div>
            <div style={{ fontWeight: 600 }}>Camera off</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              Turn on the camera to control the decks with your hands.
            </div>
          </div>
        </div>
      )}
      {gesture.status === "loading" && (
        <div className="camera-empty">Loading hand tracking…</div>
      )}
      {gesture.status === "error" && (
        <div className="camera-empty" style={{ color: "var(--red)" }}>
          {gesture.errorMessage ?? "Camera error"}
        </div>
      )}

      <ActionCue />
      <CoachOverlay />
    </div>
  );
}
