import { useEffect, useRef } from "react";
import { getEngine, type DeckId } from "../state/store";

interface Props {
  deckId: DeckId;
  playing: boolean;
  label?: string;
}

/** Realistic spinning vinyl record — the hero element of each deck. */
export function VinylPlatter({ deckId, playing, label }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastAngle = useRef(0);
  const lastT = useRef(0);

  useEffect(() => {
    let raf = 0;
    const spin = () => {
      raf = requestAnimationFrame(spin);
      const el = ref.current;
      if (!el || dragging.current) return;
      const deck = getEngine().deck(deckId);
      const angle = (deck.position / 1.8) * 360;
      el.style.transform = `rotate(${angle}deg)`;
    };
    raf = requestAnimationFrame(spin);
    return () => cancelAnimationFrame(raf);
  }, [deckId]);

  const angleFromEvent = (e: React.PointerEvent): number => {
    const el = ref.current!;
    const rect = el.getBoundingClientRect();
    return Math.atan2(e.clientY - (rect.top + rect.height / 2), e.clientX - (rect.left + rect.width / 2));
  };

  return (
    <div className="vinyl-wrap">
      <div
        ref={ref}
        className={`vinyl ${playing ? "playing" : ""}`}
        onPointerDown={(e) => {
          dragging.current = true;
          lastAngle.current = angleFromEvent(e);
          lastT.current = performance.now();
          getEngine().deck(deckId).beginScratch();
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          const a = angleFromEvent(e);
          const now = performance.now();
          let da = a - lastAngle.current;
          if (da > Math.PI) da -= 2 * Math.PI;
          if (da < -Math.PI) da += 2 * Math.PI;
          const dt = Math.max(1e-3, (now - lastT.current) / 1000);
          const rate = da / dt;
          getEngine().deck(deckId).scratch(rate >= 0 ? 1 + rate * 0.25 : rate * 0.35);
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
        <div className="vinyl-grooves" />
        <div className="vinyl-label">
          <span>{label ?? deckId}</span>
        </div>
        <div className="vinyl-spindle" />
      </div>
    </div>
  );
}
