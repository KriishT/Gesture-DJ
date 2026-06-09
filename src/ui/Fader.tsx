import { useCallback, useRef } from "react";

interface Props {
  value: number; // 0..1
  onChange: (v: number) => void;
  color?: string;
  height?: number;
  label?: string;
}

/** Vertical channel fader with a draggable cap. */
export function Fader({ value, onChange, color = "#00d2ff", height = 150, label }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const setFromEvent = useCallback(
    (clientY: number) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const t = 1 - (clientY - rect.top) / rect.height;
      onChange(Math.min(1, Math.max(0, t)));
    },
    [onChange],
  );

  return (
    <div className="fader-wrap">
      <div
        ref={ref}
        className="fader"
        style={{ height }}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.target as Element).setPointerCapture(e.pointerId);
          setFromEvent(e.clientY);
        }}
        onPointerMove={(e) => dragging.current && setFromEvent(e.clientY)}
        onPointerUp={() => (dragging.current = false)}
      >
        <div className="fader-track" />
        <div
          className="fader-cap"
          style={{ bottom: `calc(${value * 100}% - 9px)`, borderColor: color }}
        />
      </div>
      {label && <span className="fader-label">{label}</span>}
    </div>
  );
}
