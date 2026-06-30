export type DemoSetWorkspace = "both" | "transition" | "remix";

export interface DemoSetGuide {
  /** Folder name under public/demo/ */
  id: string;
  label: string;
  workspace: DemoSetWorkspace;
  transitionNote?: string;
  remixNote?: string;
  /** Preferred remix direction when applicable */
  remixDirection?: "bOnA" | "aOnB";
}

/** Playbook for the bundled demo folders (set 1–5). */
export const DEMO_SET_GUIDES: DemoSetGuide[] = [
  {
    id: "set 1",
    label: "Set 1",
    workspace: "both",
    transitionNote: "Transitions and remix both sound good on this pair.",
    remixNote: "Either direction works — try B vocal on A beat or the reverse.",
  },
  {
    id: "set 2",
    label: "Set 2",
    workspace: "both",
    transitionNote: "Solid transition pair — slam and echo moves land well.",
    remixNote: "Recommended: B vocals over A beat (Levels groove under Good Feeling vocal).",
    remixDirection: "bOnA",
  },
  {
    id: "set 3",
    label: "Set 3",
    workspace: "transition",
    transitionNote: "Best for DJ transitions — Daft Punk blends are the sweet spot.",
    remixNote: "Remix mode is optional; transitions are the highlight here.",
  },
  {
    id: "set 4",
    label: "Set 4",
    workspace: "transition",
    transitionNote: "Transition only — pop-to-pop hand-offs work best.",
    remixNote: "Skip remix for this pair unless you want to experiment.",
  },
  {
    id: "set 5",
    label: "Set 5",
    workspace: "remix",
    transitionNote: "Transitions are hit-or-miss — remix is the main event.",
    remixNote: "A vocal on B beat — analyze again and retry for different cue picks.",
    remixDirection: "aOnB",
  },
];

export function guideForDemoSet(id: string | null | undefined): DemoSetGuide | null {
  if (!id) return null;
  const key = id.trim().toLowerCase();
  return DEMO_SET_GUIDES.find((g) => g.id.toLowerCase() === key) ?? null;
}

export function workspaceLabel(ws: DemoSetWorkspace): string {
  switch (ws) {
    case "both":
      return "Transition + Remix";
    case "transition":
      return "Transition";
    case "remix":
      return "Remix";
  }
}
