import { useState } from "react";
import { DemoFoldersPanel } from "./DemoFoldersPanel";
import { CuratedPairsPanel } from "./CuratedPairsPanel";
import type { WorkspaceMode } from "../state/types";

type LibraryTab = "files" | "ideas";

interface LibraryDockProps {
  workspace: WorkspaceMode;
  mode: "assisted" | "solo";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPairLoaded?: () => void;
}

export function LibraryDock({
  workspace,
  mode,
  open,
  onOpenChange,
  onPairLoaded,
}: LibraryDockProps) {
  const show = workspace === "remix" || (workspace === "dj" && mode === "assisted");
  const [tab, setTab] = useState<LibraryTab>("files");

  if (!show) return null;

  return (
    <aside className={`library-dock ${open ? "open" : "collapsed"}`} aria-label="Track library">
      <div className="library-dock-bar">
        <button
          type="button"
          className="library-dock-toggle"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
        >
          <span className="library-dock-icon">{open ? "▾" : "▴"}</span>
          <span>Library</span>
        </button>

        <div className="library-tabs" role="tablist">
          {(
            [
              ["files", "My files"],
              ["ideas", "Pair ideas"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`library-tab ${tab === id ? "active" : ""}`}
              onClick={() => {
                setTab(id);
                if (!open) onOpenChange(true);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {open && (
        <div className="library-dock-body" role="tabpanel">
          {tab === "files" && <DemoFoldersPanel variant="dock" />}
          {tab === "ideas" && (
            <CuratedPairsPanel
              variant="dock"
              onPairLoaded={() => {
                onPairLoaded?.();
                onOpenChange(false);
              }}
            />
          )}
        </div>
      )}
    </aside>
  );
}
