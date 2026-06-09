import { useState } from "react";
import { useStore } from "../state/store";
import { session } from "../session";
import { requestSuggestions } from "../copilot/client";
import { useCopilot } from "./useCopilot";
import { formatTime } from "./format";
import type { Suggestion, TrackAnalysis } from "../copilot/recipeTypes";
import { recipeUsesStems } from "../copilot/transitionLibrary";
import type { DeckState } from "../state/types";

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

export function SuggestionPanel({ onBuild }: { onBuild?: () => void }) {
  const deckA = useStore((s) => s.decks.A);
  const deckB = useStore((s) => s.decks.B);
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

  return (
    <div className="suggestions">
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

      {ready && stemsReady && (
        <div className="stems-ready-banner">
          Stems ready — vocals &amp; rhythm stems lock to the other deck&apos;s beat (independent BPM, pitch-locked)
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
        return (
          <div
            key={s.recipe.id}
            className="sugg-card"
            onClick={() => choose(s)}
            style={selected ? { borderColor: "var(--accent-2)" } : undefined}
          >
            <div className="title">
              <span className="title-text">
                {s.recipe.name}
                {recipeUsesStems(s.recipe) && <span className="stem-badge">STEM</span>}
              </span>
              <span className="impact">{Math.round(s.impact * 100)}%</span>
            </div>
            <div className="style">{s.recipe.style}</div>
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
