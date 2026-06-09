import { useEffect, useRef } from "react";

interface Props {
  peaks: number[];
  position: number;
  duration: number;
  color: string;
  cueIn?: number | null; // seconds (deck B entry)
  cueOut?: number | null; // seconds (deck A exit / transition window)
  onSeek?: (seconds: number) => void;
  variant?: "deck" | "rig";
}

export function Waveform({
  peaks,
  position,
  duration,
  color,
  cueIn,
  cueOut,
  onSeek,
  variant = "deck",
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const mid = h / 2;
    const n = peaks.length || 1;
    const barW = w / n;
    const progress = duration > 0 ? position / duration : 0;

    for (let i = 0; i < n; i++) {
      const p = peaks[i];
      const barH = Math.max(1, p * (h * 0.9));
      const played = i / n < progress;
      ctx.fillStyle = played ? color : "rgba(255,255,255,0.18)";
      ctx.fillRect(i * barW, mid - barH / 2, Math.max(1, barW - 0.5), barH);
    }

    const drawMarker = (sec: number, mColor: string) => {
      if (duration <= 0) return;
      const x = (sec / duration) * w;
      ctx.strokeStyle = mColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    };
    if (cueOut != null) drawMarker(cueOut, "#ffb020");
    if (cueIn != null) drawMarker(cueIn, "#00d2ff");

    // Playhead
    const px = progress * w;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
  }, [peaks, position, duration, color, cueIn, cueOut]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSeek || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onSeek(ratio * duration);
  };

  return (
    <canvas
      ref={ref}
      className={`waveform ${variant === "rig" ? "waveform-rig-canvas" : ""}`}
      onClick={handleClick}
    />
  );
}
