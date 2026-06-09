import { useCallback, useRef } from "react";

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  size?: number;
  color?: string;
  format?: (v: number) => string;
}

const ANGLE = 135; // degrees of travel each direction from center

export function Knob({
  label,
  value,
  min,
  max,
  onChange,
  size = 46,
  color = "#00d2ff",
  format,
}: Props) {
  const dragging = useRef(false);
  const startY = useRef(0);
  const startVal = useRef(0);

  const norm = (value - min) / (max - min);
  const rot = -ANGLE + norm * (ANGLE * 2);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      startY.current = e.clientY;
      startVal.current = value;
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [value],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const dy = startY.current - e.clientY;
      const range = max - min;
      const next = startVal.current + (dy / 140) * range;
      onChange(Math.min(max, Math.max(min, next)));
    },
    [max, min, onChange],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  const onDouble = useCallback(() => {
    onChange((min + max) / 2);
  }, [min, max, onChange]);

  return (
    <div className="knob" style={{ width: size }}>
      <div
        className="knob-dial"
        style={{ width: size, height: size }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDouble}
      >
        <div className="knob-face" style={{ transform: `rotate(${rot}deg)` }}>
          <span className="knob-indicator" style={{ background: color }} />
        </div>
      </div>
      <span className="knob-label">{label}</span>
      {format && <span className="knob-value">{format(value)}</span>}
    </div>
  );
}
