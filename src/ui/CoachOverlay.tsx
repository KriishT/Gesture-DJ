import { useCopilot } from "./useCopilot";
import { useStore } from "../state/store";

export function CoachOverlay() {
  const rt = useCopilot();
  const cameraOn = useStore((s) => s.gesture.enabled && s.gesture.status === "ready");
  if (rt.phase === "idle" || !rt.recipe) return null;

  const passive = rt.passive || !cameraOn;

  const countdown = Math.ceil(rt.countdownBeats);
  const showBeat =
    !passive &&
    rt.phase === "running" &&
    !rt.live &&
    countdown > 0 &&
    countdown <= 8;

  return (
    <div className={`coach ${rt.live ? "live" : ""} ${passive ? "passive" : ""}`}>
      {passive && rt.phase === "running" && (
        <div className="passive-badge">Auto mix</div>
      )}
      {showBeat && <div className="beat-ring">{countdown}</div>}
      {rt.phase === "running" && rt.live && !passive && <div className="go-badge">NOW</div>}
      <div className="name">{rt.recipe.name}</div>
      <div className="instruction">{rt.instruction}</div>
      {rt.phase === "armed" && (
        <div className="count">
          {passive
            ? "Play Deck A toward the marker — mix runs automatically (camera off)."
            : "Play Deck A toward the amber marker to begin."}
        </div>
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
