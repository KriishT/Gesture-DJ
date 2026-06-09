import { useCopilot } from "./useCopilot";

export function CoachOverlay() {
  const rt = useCopilot();
  if (rt.phase === "idle" || !rt.recipe) return null;

  const countdown = Math.ceil(rt.countdownBeats);
  const showBeat = rt.phase === "running" && !rt.live && countdown > 0 && countdown <= 8;

  return (
    <div className={`coach ${rt.live ? "live" : ""}`}>
      {showBeat && <div className="beat-ring">{countdown}</div>}
      {rt.phase === "running" && rt.live && <div className="go-badge">NOW</div>}
      <div className="name">{rt.recipe.name}</div>
      <div className="instruction">{rt.instruction}</div>
      {rt.phase === "armed" && (
        <div className="count">Play Deck A toward the amber marker to begin.</div>
      )}
      {rt.phase === "complete" && (
        <div className="count score-line">
          {rt.results.filter((r) => r === "green").length}/{rt.results.length} hits
        </div>
      )}
      {rt.phase === "complete" && (
        <div className="count">Pick another move or load fresh tracks.</div>
      )}
      <div className="steps">
        {rt.results.map((r, i) => (
          <div key={i} className={`pip ${r}`} />
        ))}
      </div>
    </div>
  );
}
