import { useEffect, useRef } from "react";
import { getEngine, type DeckId } from "../state/store";

interface Props {
  deckId: DeckId;
  color: string;
  playing: boolean;
}

/**
 * Spinning DJ platter. Rotates with playback and can be dragged to
 * scratch/jog the deck (pitch-bend), like a real jog wheel.
 */
export function JogWheel({ deckId, color, playing }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastAngle = useRef(0);
  const lastT = useRef(0);

  useEffect(() => {
    let raf = 0;
    const spin = () => {
      raf = requestAnimationFrame(spin);
      const el = ref.current;
      if (!el) return;
      const deck = getEngine().deck(deckId);
      // ~1 rotation per 1.8s of audio, scaled by rate.
      const angle = (deck.position / 1.8) * 360;
      if (!dragging.current) el.style.transform = `rotate(${angle}deg)`;
    };
    raf = requestAnimationFrame(spin);
    return () => cancelAnimationFrame(raf);
  }, [deckId]);

  const angleFromEvent = (e: React.PointerEvent): number => {
    const el = ref.current!;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return Math.atan2(e.clientY - cy, e.clientX - cx);
  };

  return (
    <div className="jog">
      <div
        ref={ref}
        className={`jog-platter ${playing ? "spinning" : ""}`}
        style={{ boxShadow: `0 0 24px ${color}55, inset 0 0 30px #000` }}
        onPointerDown={(e) => {
          dragging.current = true;
          lastAngle.current = angleFromEvent(e);
          lastT.current = performance.now();
          getEngine().deck(deckId).beginScratch();
          (e.target as Element).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          const a = angleFromEvent(e);
          const now = performance.now();
          let da = a - lastAngle.current;
          if (da > Math.PI) da -= 2 * Math.PI;
          if (da < -Math.PI) da += 2 * Math.PI;
          const dt = Math.max(1e-3, (now - lastT.current) / 1000);
          const angVel = da / dt; // rad/s
          getEngine().deck(deckId).scratch(1 + angVel * 0.25);
          (ref.current as HTMLDivElement).style.transform = `rotate(${(a * 180) / Math.PI}deg)`;
          lastAngle.current = a;
          lastT.current = now;
        }}
        onPointerUp={() => {
          if (!dragging.current) return;
          dragging.current = false;
          getEngine().deck(deckId).endScratch();
        }}
      >
        <div className="jog-center" style={{ borderColor: color }} />
        <div className="jog-mark" style={{ background: color }} />
      </div>
    </div>
  );
}
