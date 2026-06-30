import { useCallback, useEffect, useState } from "react";
import { fetchDemoPairs, fileFromDemoUrl } from "../demo/client";
import type { DemoPairFiles } from "../demo/types";
import { guideForDemoSet, workspaceLabel } from "../data/demoSetGuide";
import { useStore } from "../state/store";
import { session } from "../session";

/** Load pairs from public/demo/<folder>/ — one subfolder per set of two songs. */
export function DemoFoldersPanel({ variant = "card" }: { variant?: "card" | "dock" }) {
  const loadPairToDecks = useStore((s) => s.loadPairToDecks);
  const setActiveDemoSetId = useStore((s) => s.setActiveDemoSetId);
  const [pairs, setPairs] = useState<DemoPairFiles[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPairs(await fetchDemoPairs());
    } catch {
      setError("Could not read demo folders — is the API running?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadPair = async (pair: DemoPairFiles) => {
    setLoadingId(pair.id);
    setError(null);
    try {
      const [fileA, fileB] = await Promise.all([
        fileFromDemoUrl(pair.deckA.url, pair.deckA.fileName),
        fileFromDemoUrl(pair.deckB.url, pair.deckB.fileName),
      ]);
      await loadPairToDecks(fileA, fileB);
      setActiveDemoSetId(pair.id);
      const guide = guideForDemoSet(pair.id);
      if (guide?.remixDirection) {
        session.getRemixEngine().setDirection(guide.remixDirection);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load demo pair");
    } finally {
      setLoadingId(null);
    }
  };

  const shell = variant === "dock" ? "demo-folders dock-pane" : "demo-folders";

  if (!loading && pairs.length === 0) {
    return (
      <div className={shell}>
        {variant === "card" && (
          <div className="demo-folders-head">
            <span className="demo-folders-title">Your demo folders</span>
            <button type="button" className="btn ghost small" onClick={() => void refresh()} disabled={loading}>
              ↻
            </button>
          </div>
        )}
        <p className="curated-note">
          Create <code>public/demo/my-pair/</code> with <code>a.mp3</code> + <code>b.mp3</code>, then refresh
          {variant === "card" ? " here" : " (↻ in My files tab)"}.
        </p>
      </div>
    );
  }

  return (
    <div className={shell}>
      {variant === "card" && (
        <div className="demo-folders-head">
          <span className="demo-folders-title">Your demo folders</span>
          <button type="button" className="btn ghost small" onClick={() => void refresh()} disabled={loading}>
            {loading ? "…" : "↻"}
          </button>
        </div>
      )}
      {variant === "dock" && (
        <div className="dock-pane-toolbar">
          <p className="curated-note">
            Folders in <code>public/demo/</code> — name files <code>a</code> and <code>b</code>
          </p>
          <button type="button" className="btn ghost small" onClick={() => void refresh()} disabled={loading}>
            {loading ? "…" : "Refresh"}
          </button>
        </div>
      )}
      {variant === "card" && (
        <p className="curated-note">
          Drop each pair in <code>public/demo/&lt;folder&gt;/</code> with files named{" "}
          <code>a.mp3</code> and <code>b.mp3</code> (or <code>01</code> / <code>02</code>), then refresh.
        </p>
      )}
      {error && <p className="demo-error">{error}</p>}
      <div className="pair-list">
        {pairs.map((pair) => {
          const guide = guideForDemoSet(pair.id);
          return (
          <div key={pair.id} className="pair-card demo-folder-card">
            <div className="pair-decks">
              <div className="pair-deck a">
                <span className="pair-label">A</span>
                <strong>{pair.deckA.fileName}</strong>
              </div>
              <span className="pair-arrow">→</span>
              <div className="pair-deck b">
                <span className="pair-label">B</span>
                <strong>{pair.deckB.fileName}</strong>
              </div>
            </div>
            <div className="demo-folder-row">
              <span className="demo-folder-label">{pair.label}</span>
              {guide && (
                <span className={`demo-set-ws-tag ${guide.workspace}`}>
                  {workspaceLabel(guide.workspace)}
                </span>
              )}
              <button
                type="button"
                className="btn primary small"
                disabled={loadingId !== null}
                onClick={() => void loadPair(pair)}
              >
                {loadingId === pair.id ? "Loading…" : "Load both"}
              </button>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}
