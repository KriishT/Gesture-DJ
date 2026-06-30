import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { session } from "../session";
import { setCaptureRoot } from "./recorder";
import { DeckView } from "./DeckView";
import { MasterSection } from "./MasterSection";
import { TransitionBuilder } from "./TransitionBuilder";
import { CameraOverlay } from "./CameraOverlay";
import { LibraryDock } from "./LibraryDock";
import { GestureGuide } from "./GestureGuide";
import { RecordButton } from "./RecordButton";
import { WaveformRig } from "./WaveformRig";
import { RemixPanel } from "./RemixPanel";
import { SuggestionPanel } from "./SuggestionPanel";
import { StemBackendControl } from "./StemBackendControl";
import type { WorkspaceMode } from "../state/types";

export function App() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const workspace = useStore((s) => s.workspace);
  const setWorkspaceStore = useStore((s) => s.setWorkspace);
  const init = useStore((s) => s.init);
  const gesture = useStore((s) => s.gesture);
  const setGestureEnabled = useStore((s) => s.setGestureEnabled);
  const [showGuide, setShowGuide] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [autoSuggest, setAutoSuggest] = useState(0);
  const captureRootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCaptureRoot(captureRootRef.current);
    return () => setCaptureRoot(null);
  }, []);

  // Initialize the audio context on first user interaction (autoplay policy).
  useEffect(() => {
    const start = () => {
      void init();
      window.removeEventListener("pointerdown", start);
    };
    window.addEventListener("pointerdown", start);
    return () => window.removeEventListener("pointerdown", start);
  }, [init]);

  const toggleCamera = () => {
    if (gesture.enabled) session.disableCamera();
    else setGestureEnabled(true);
  };

  const setWorkspace = (w: WorkspaceMode) => {
    if (w === "dj") session.exitRemixWorkspace();
    else session.enterRemixWorkspace();
    setWorkspaceStore(w);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          GESTURE DJ
        </div>

        <div className="toggle" role="tablist" aria-label="Workspace">
          <button
            className={workspace === "dj" ? "active" : ""}
            onClick={() => setWorkspace("dj")}
          >
            DJ
          </button>
          <button
            className={workspace === "remix" ? "active" : ""}
            onClick={() => setWorkspace("remix")}
          >
            Remix
          </button>
        </div>

        {workspace === "dj" && (
          <div className="toggle" role="tablist" aria-label="AI mode">
            <button
              className={mode === "assisted" ? "active" : ""}
              onClick={() => setMode("assisted")}
            >
              AI Assist
            </button>
            <button className={mode === "solo" ? "active" : ""} onClick={() => setMode("solo")}>
              Solo
            </button>
          </div>
        )}

        <div className="topbar-actions">
          <StemBackendControl />
          {((workspace === "dj" && mode === "assisted") || workspace === "remix") && (
            <button
              type="button"
              className={`btn ${libraryOpen ? "primary" : "ghost"}`}
              onClick={() => setLibraryOpen((o) => !o)}
            >
              Library
            </button>
          )}
          <span className={`status-pill ${gesture.status}`}>
            {gesture.status === "ready"
              ? "Hands ready"
              : gesture.status === "loading"
                ? "Loading…"
                : gesture.status === "error"
                  ? "Camera error"
                  : "Camera off"}
          </span>
          <button
            type="button"
            className={`btn ${gesture.enabled ? "ghost" : "primary"}`}
            onClick={toggleCamera}
          >
            {gesture.enabled ? "Stop camera" : "Start camera"}
          </button>
          <RecordButton />
          <button className="btn ghost" onClick={() => setShowGuide(true)}>
            Gesture guide
          </button>
        </div>
      </header>

      <div ref={captureRootRef} className="record-capture-root">
        <WaveformRig />

        <main className="stage dj-rig">
          <DeckView id="A" />

          <div className="center">
            <CameraOverlay />
            <MasterSection />
            {workspace === "dj" && mode === "assisted" && (
              <SuggestionPanel
                variant="center"
                onBuild={() => setShowBuilder(true)}
                autoSuggestToken={autoSuggest}
              />
            )}
            {workspace === "remix" && <RemixPanel variant="center" />}
          </div>

          <DeckView id="B" />
        </main>
      </div>

      <LibraryDock
        workspace={workspace}
        mode={mode}
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        onPairLoaded={() => setAutoSuggest((n) => n + 1)}
      />

      {showGuide && <GestureGuide onClose={() => setShowGuide(false)} />}
      {showBuilder && <TransitionBuilder onClose={() => setShowBuilder(false)} />}
    </div>
  );
}
