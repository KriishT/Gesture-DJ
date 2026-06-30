import { useState, useEffect, useRef } from "react";
import { useStore } from "../state/store";
import { session } from "../session";
import { requestSuggestions } from "../copilot/client";
import { useCopilot } from "./useCopilot";
import { formatTime } from "./format";
import type { Suggestion, TrackAnalysis } from "../copilot/recipeTypes";
import { recipeUsesStems } from "../copilot/transitionLibrary";
import type { DeckState } from "../state/types";
import { DemoSetPlaybook, isTransitionRecommended } from "./DemoSetPlaybook";
import { guideForDemoSet } from "../data/demoSetGuide";

/** Build a minimal analysis if deep analysis hasn't finished yet. */
function ensureAnalysis(deck: DeckState): TrackAnalysis {
  if (deck.analysis) return deck.analysis;
  return {
    fileName: deck.fileName ?? "track",
    durationSec: deck.duration,
    bpm: deck.bpm,
    beatOffset: deck.beatOffset,
    camelotKey: null,
    keyName: null,
    sections: [],
    drops: [],
    energyCurve: [],
    vocalProbability: 0,
  };
}

export function SuggestionPanel({
  onBuild,
  variant = "card",
  autoSuggestToken = 0,
}: {
  onBuild?: () => void;
  variant?: "card" | "dock" | "center";
  /** Increment to auto-fetch suggestions after a pair loads. */
  autoSuggestToken?: number;
}) {
  const deckA = useStore((s) => s.decks.A);
  const deckB = useStore((s) => s.decks.B);
  const activeDemoSetId = useStore((s) => s.activeDemoSetId);
  const demoGuide = guideForDemoSet(activeDemoSetId);
  const rt = useCopilot();

  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [source, setSource] = useState<"ai" | "cache" | "fallback" | null>(null);
  const [notes, setNotes] = useState<string>("");

  const ready = deckA.hasTrack && deckB.hasTrack;
  const stemsReady = deckA.stemsStatus === "ready" && deckB.stemsStatus === "ready";
  const bpmGap =
    deckA.bpm && deckB.bpm ? Math.abs(deckA.bpm - deckB.bpm) : null;

  const fetchSuggestions = async (force = false) => {
    if (!ready) return;
    setLoading(true);
    try {
      const { response, source: src } = await requestSuggestions(
        ensureAnalysis(deckA),
        ensureAnalysis(deckB),
        {
          force,
          stemsA: deckA.stemsStatus === "ready",
          stemsB: deckB.stemsStatus === "ready",
        },
      );
      setSuggestions(response.suggestions);
      setSource(src);
      setNotes(response.notes ?? "");
    } finally {
      setLoading(false);
    }
  };

  const choose = (s: Suggestion) => {
    session.prepareTransition(s.recipe);
  };

  const active = rt.phase === "armed" || rt.phase === "running";
  const lastSuggest = useRef(0);

  useEffect(() => {
    if (autoSuggestToken > 0 && autoSuggestToken !== lastSuggest.current && ready && !loading) {
      lastSuggest.current = autoSuggestToken;
      void fetchSuggestions(false);
    }
  }, [autoSuggestToken, ready, loading]);

  return (
    <div
      className={`suggestions ${variant === "dock" ? "dock-pane" : ""} ${variant === "center" ? "center-panel" : ""}`}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          className="btn primary"
          disabled={!ready || loading}
          onClick={() => fetchSuggestions(false)}
          style={{ flex: 1, minWidth: 120 }}
        >
          {loading ? "Thinking…" : "Suggest transitions"}
        </button>
        <button className="btn" disabled={!ready} onClick={() => onBuild?.()}>
          Build custom
        </button>
        {suggestions.length > 0 && (
          <button className="btn ghost" disabled={loading} onClick={() => fetchSuggestions(true)}>
            ↻
          </button>
        )}
        {active && (
          <button className="btn ghost" onClick={() => session.cancelTransition()}>
            Cancel
          </button>
        )}
      </div>

      {!ready && <div className="hint">Load a track on both decks to get suggestions.</div>}

      <DemoSetPlaybook context="transition" />

      {demoGuide && demoGuide.workspace === "remix" && (
        <div className="demo-set-warn">
          This pair is tuned for <strong>Remix</strong> — switch workspace for best results.
        </div>
      )}

      {ready && stemsReady && (
        <div className="stems-ready-banner">
          Stems ready — standard blends are still the safest pick. Stem moves below are experimental.
        </div>
      )}

      {suggestions.some((s) => recipeUsesStems(s.recipe)) && (
        <div className="stem-experimental-banner">
          Stem transitions are still in progress — results may vary. Try a non-stem blend first.
        </div>
      )}

      {ready && !stemsReady && bpmGap !== null && bpmGap > 6 && (
        <div className="hint">BPM gap {Math.round(bpmGap)} — separate stems to unlock the smoothest moves.</div>
      )}

      {source && (
        <div className="source-tag">
          {suggestions.length} moves ·{" "}
          {source === "fallback"
            ? "Catalog (AI offline)"
            : source === "cache"
              ? "AI picks + catalog (cached)"
              : "AI picks + catalog"}
          {notes ? ` · ${notes}` : ""}
        </div>
      )}

      {suggestions.map((s) => {
        const selected = rt.recipe?.id === s.recipe.id && active;
        const isStem = recipeUsesStems(s.recipe);
        const recTransition = demoGuide && isTransitionRecommended(demoGuide.workspace);
        return (
          <div
            key={s.recipe.id}
            className={`sugg-card ${isStem ? "stem-experimental" : ""} ${recTransition ? "set-recommended" : ""}`}
            onClick={() => choose(s)}
            style={selected ? { borderColor: "var(--accent-2)" } : undefined}
          >
            <div className="title">
              <span className="title-text">
                {s.recipe.name}
                {recTransition && <span className="set-rec-badge">REC</span>}
                {isStem && <span className="stem-badge">STEM · BETA</span>}
              </span>
              <span className="impact">{Math.round(s.impact * 100)}%</span>
            </div>
            <div className="style">{s.recipe.style}</div>
            {isStem && (
              <div className="stem-warning">
                Experimental — stem separation quality varies; standard blends are more reliable.
              </div>
            )}
            <div className="why">{s.recipe.why}</div>
            <div className="cue-row">
              <span>A out: {formatTime(s.recipe.cueOutA)}</span>
              <span>B in: {formatTime(s.recipe.cueInB)}</span>
              <span>{s.recipe.bars} bars</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
