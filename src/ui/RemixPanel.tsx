import { useStore } from "../state/store";
import { session } from "../session";
import { useRemix } from "./useRemix";
import { analyzeRemixFit } from "../remix/remixCompatibility";
import type { RemixDirection, RemixLayerKind } from "../remix/types";
import type { TrackAnalysis } from "../copilot/recipeTypes";
import type { DeckId, DeckState } from "../state/types";
import { formatTime } from "./format";

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

export function RemixPanel() {
  const deckA = useStore((s) => s.decks.A);
  const deckB = useStore((s) => s.decks.B);
  const remix = useRemix();
  const engine = () => session.getRemixEngine();

  const ready = deckA.hasTrack && deckB.hasTrack;
  const stemsA = deckA.stemsStatus === "ready";
  const stemsB = deckB.stemsStatus === "ready";
  const active = remix.phase !== "idle";
  const direction = remix.direction;
  const bedId: DeckId = remix.bedDeck;
  const layerId: DeckId = remix.layerDeck;
  const layerStemsReady = layerId === "B" ? stemsB : stemsA;
  const plan = remix.cuePlan;

  const analyzeDirection = (dir: RemixDirection) => {
    if (!ready) return;
    engine().setDirection(dir);
    const a = ensureAnalysis(deckA);
    const b = ensureAnalysis(deckB);
    const bed = dir === "bOnA" ? a : b;
    const layer = dir === "bOnA" ? b : a;
    const fit = analyzeRemixFit(bed, layer, dir, {
      stemsBed: dir === "bOnA" ? stemsA : stemsB,
      stemsLayer: dir === "bOnA" ? stemsB : stemsA,
    });
    engine().setFit(fit);
  };

  const startVocal = () => {
    engine().startLayer("acapella");
  };

  const fit = remix.fit;
  const bedCue = bedId === "A" ? remix.cueA : remix.cueB;
  const layerCue = layerId === "A" ? remix.cueA : remix.cueB;

  return (
    <div className="remix-panel">
      <div className="remix-header">
        <h2>Remix Lab</h2>
        <span className="remix-badge">Isolated from DJ mode</span>
      </div>
      <p className="remix-hint">
        Analyze picks direction-aware start points. Balanced mix: bed groove stays present, layer
        vocals sit on top without drowning the beat.
      </p>

      {!ready && <div className="hint">Load tracks on both decks to start.</div>}

      {ready && (
        <>
          <div className="remix-direction">
            <span className="label">Direction</span>
            <div className="toggle remix-toggle">
              <button
                type="button"
                className={direction === "bOnA" ? "active" : ""}
                disabled={active}
                onClick={() => engine().setDirection("bOnA")}
              >
                B vocal → A beat
              </button>
              <button
                type="button"
                className={direction === "aOnB" ? "active" : ""}
                disabled={active}
                onClick={() => engine().setDirection("aOnB")}
              >
                A vocal → B beat
              </button>
            </div>
          </div>

          <button
            className="btn primary"
            disabled={!ready || active}
            onClick={() => analyzeDirection(direction)}
            style={{ width: "100%" }}
          >
            Analyze remix fit
          </button>

          {plan && fit?.direction === direction && (
            <div className="remix-cue-ai">
              <span className="label">AI start points</span>
              <div className="remix-cue-ai-row">
                <span>Intro (Deck {bedId})</span>
                <strong>{formatTime(plan.bedIntroCue)}</strong>
                <span className="remix-cue-tag">full mix</span>
              </div>
              <div className="remix-cue-ai-row">
                <span>Swap (Deck {bedId} → {layerId})</span>
                <strong>{formatTime(plan.bedCue)}</strong>
                <span className="remix-cue-tag">{plan.bedLabel}</span>
              </div>
              <div className="remix-cue-ai-row">
                <span>Layer vocal (Deck {layerId})</span>
                <strong>{formatTime(layerCue)}</strong>
                <span className="remix-cue-tag">{plan.layerLabel}</span>
              </div>
              <p className="remix-cue-ai-note">
                ~{Math.round(plan.introBars)} bars of bed with its own vocals, then bed vocals mute
                and layer vocals enter beat-locked.
              </p>
            </div>
          )}

          {fit && fit.direction === direction && (
            <div className="remix-fit-card">
              <div className="remix-fit-top">
                <strong>{fit.label}</strong>
                <span className="impact">{Math.round(fit.score * 100)}%</span>
              </div>
              <div className="remix-fit-meta">
                Bed: {fit.bedDeck} @ {formatTime(bedCue)} · Layer: {fit.layerDeck} @{" "}
                {formatTime(layerCue)} · BPM Δ {Math.round(fit.bpmGap)}
                {plan
                  ? ` · Sync ${plan.syncRatio.toFixed(2)}× (${plan.effectiveLayerBpm} BPM)`
                  : ""}
                {fit.harmonic ? " · Keys OK" : " · Keys may clash"}
              </div>
              {fit.warnings.map((w) => (
                <div key={w} className="remix-warn">
                  {w}
                </div>
              ))}
              {fit.tips.map((t) => (
                <div key={t} className="remix-tip">
                  {t}
                </div>
              ))}
            </div>
          )}

          <div className="remix-actions">
            <button
              className="btn primary"
              disabled={!ready || active || !layerStemsReady || !plan}
              onClick={startVocal}
            >
              Start vocal layer
            </button>
            {fit?.direction === direction &&
              fit.suggestedLayers
                .filter((l) => l !== "acapella")
                .slice(0, 2)
                .map((layer) => (
                  <button
                    key={layer}
                    className="btn"
                    disabled={!ready || active || !plan}
                    onClick={() => engine().startLayer(layer as RemixLayerKind)}
                  >
                    + {layer}
                  </button>
                ))}
          </div>

          {active && (
            <div className="remix-live">
              <div className="remix-live-label">
                {remix.phase === "intro"
                  ? `INTRO — full ${remix.bedDeck} before vocal swap`
                  : `LIVE — ${remix.activeLayer} on ${remix.bedDeck}'s grid`}
              </div>
              <div className="remix-actions">
                <button className="btn" onClick={() => engine().stopRemix()}>
                  Stop &amp; restore DJ mix
                </button>
                <button
                  className="btn primary"
                  disabled={remix.phase === "intro"}
                  onClick={() => engine().morphToFull()}
                >
                  Morph → full {remix.layerDeck}
                </button>
              </div>
            </div>
          )}

          <p className="remix-status">{remix.message}</p>
        </>
      )}
    </div>
  );
}
