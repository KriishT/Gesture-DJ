import { guideForDemoSet, workspaceLabel, type DemoSetWorkspace } from "../data/demoSetGuide";
import { useStore } from "../state/store";

export function DemoSetPlaybook({
  context,
}: {
  /** Which panel is showing this — filters which note to emphasize */
  context: "transition" | "remix" | "files";
}) {
  const setId = useStore((s) => s.activeDemoSetId);
  const guide = guideForDemoSet(setId);
  if (!guide) return null;

  const note =
    context === "remix"
      ? guide.remixNote
      : context === "transition"
        ? guide.transitionNote
        : `${guide.transitionNote} ${guide.remixNote ?? ""}`.trim();

  if (!note) return null;

  const showWorkspace =
    (context === "transition" && guide.workspace !== "remix") ||
    (context === "remix" && guide.workspace !== "transition") ||
    context === "files";

  return (
    <div className={`demo-set-playbook ws-${guide.workspace}`}>
      <div className="demo-set-playbook-head">
        <span className="demo-set-playbook-title">{guide.label} playbook</span>
        {showWorkspace && (
          <span className={`demo-set-ws-tag ${guide.workspace}`}>{workspaceLabel(guide.workspace)}</span>
        )}
      </div>
      <p className="demo-set-playbook-note">{note}</p>
      {context === "remix" && guide.remixDirection === "bOnA" && (
        <p className="demo-set-playbook-hint">Tip: use <strong>B vocal → A beat</strong>.</p>
      )}
      {context === "remix" && guide.remixDirection === "aOnB" && (
        <p className="demo-set-playbook-hint">
          Tip: use <strong>A vocal → B beat</strong> — re-analyze for fresh cue points.
        </p>
      )}
    </div>
  );
}

export function isTransitionRecommended(ws: DemoSetWorkspace): boolean {
  return ws === "both" || ws === "transition";
}

export function isRemixRecommended(ws: DemoSetWorkspace): boolean {
  return ws === "both" || ws === "remix";
}
