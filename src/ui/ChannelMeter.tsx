/** LED-style channel meter (8 segments). */
export function ChannelMeter({
  level,
  color,
  label,
}: {
  level: number;
  color: string;
  label: string;
}) {
  const segments = 12;
  const lit = Math.round(level * segments);
  return (
    <div className="channel-meter">
      <span className="meter-label">{label}</span>
      <div className="meter-leds">
        {Array.from({ length: segments }, (_, i) => (
          <span
            key={i}
            className={`led ${i < lit ? "on" : ""}`}
            style={
              i < lit
                ? {
                    background:
                      i >= segments - 2 ? "var(--red)" : i >= segments - 4 ? "var(--amber)" : color,
                  }
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}
