import { useStore } from "../state/store";

export function Crossfader() {
  const value = useStore((s) => s.crossfader);
  const setCrossfader = useStore((s) => s.setCrossfader);
  const masterLevel = useStore((s) => s.masterLevel);

  return (
    <div className="crossfader">
      <span className="xf-label a">A</span>
      <div style={{ flex: 1 }}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={value}
          onChange={(e) => setCrossfader(Number(e.target.value))}
        />
        <div className="vu">
          <div style={{ width: `${Math.round(masterLevel * 100)}%` }} />
        </div>
      </div>
      <span className="xf-label b">B</span>
    </div>
  );
}
