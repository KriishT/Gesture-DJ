import { useState } from "react";
import { useStore } from "../state/store";
import { session } from "../session";
import {
  BUILDER_ACTIONS,
  buildCustomRecipe,
  defaultBuilderStep,
  type BuilderStep,
} from "../copilot/buildTransition";
import type { StepActionType, TrackAnalysis } from "../copilot/recipeTypes";
import type { DeckState } from "../state/types";
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

export function TransitionBuilder({ onClose }: { onClose: () => void }) {
  const deckA = useStore((s) => s.decks.A);
  const deckB = useStore((s) => s.decks.B);

  const [name, setName] = useState("My Custom Blend");
  const [style, setStyle] = useState("Hand-built");
  const [why, setWhy] = useState("A transition I designed step by step.");
  const [bars, setBars] = useState(16);
  const [steps, setSteps] = useState<BuilderStep[]>([
    defaultBuilderStep("play"),
    defaultBuilderStep("crossfade"),
    defaultBuilderStep("bassKill", "A"),
  ]);

  const addStep = (type: StepActionType, deck: "A" | "B" = "B") => {
    setSteps((s) => [...s, defaultBuilderStep(type, deck)]);
  };

  const removeStep = (id: string) => setSteps((s) => s.filter((x) => x.id !== id));

  const updateStep = (id: string, patch: Partial<BuilderStep>) => {
    setSteps((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };

  const run = () => {
    if (!deckA.hasTrack || !deckB.hasTrack) return;
    const recipe = buildCustomRecipe(
      steps,
      { name, style, why, bars },
      ensureAnalysis(deckA),
      ensureAnalysis(deckB),
    );
    session.prepareTransition(recipe);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal builder-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Build your transition</h2>
        <p className="guide-intro">
          Stack moves in order — each step fires at a bar offset during the blend. Gestures are
          randomized when you run it (AI Assist) so you stay on your toes.
        </p>

        <div className="builder-meta">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Style
            <input value={style} onChange={(e) => setStyle(e.target.value)} />
          </label>
          <label className="wide">
            Why it works
            <input value={why} onChange={(e) => setWhy(e.target.value)} />
          </label>
          <label>
            Length (bars)
            <input
              type="number"
              min={4}
              max={32}
              value={bars}
              onChange={(e) => setBars(Number(e.target.value))}
            />
          </label>
        </div>

        <div className="builder-add-row">
          {BUILDER_ACTIONS.slice(0, 8).map((a) => (
            <button key={`${a.type}-${a.deck}-${a.label}`} className="mini-btn" onClick={() => addStep(a.type, a.deck)}>
              + {a.label}
            </button>
          ))}
        </div>
        <div className="builder-add-row">
          {BUILDER_ACTIONS.slice(8).map((a) => (
            <button key={`${a.type}-${a.deck}-${a.label}`} className="mini-btn" onClick={() => addStep(a.type, a.deck)}>
              + {a.label}
            </button>
          ))}
        </div>

        <div className="builder-steps">
          {steps.map((step, i) => (
            <div className="builder-step" key={step.id}>
              <span className="step-num">{i + 1}</span>
              <label>
                Bar
                <input
                  type="number"
                  min={0}
                  max={bars}
                  value={step.atBar}
                  onChange={(e) => updateStep(step.id, { atBar: Number(e.target.value) })}
                />
              </label>
              <span className="step-action">
                {step.action.type} · Deck {step.action.deck}
                {step.action.beats ? ` · ${step.action.beats}b` : ""}
              </span>
              <input
                className="step-verb"
                value={step.verb}
                onChange={(e) => updateStep(step.id, { verb: e.target.value })}
              />
              <button className="mini-btn" onClick={() => removeStep(step.id)}>
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="builder-cues">
          A out ≈ {formatTime(deckA.analysis ? deckA.duration * 0.6 : 0)} · B in ≈{" "}
          {formatTime(deckB.analysis?.drops[0] ?? 0)}
        </div>

        <div className="guide-footer">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!deckA.hasTrack || !deckB.hasTrack || steps.length === 0}
            onClick={run}
          >
            Run this transition
          </button>
        </div>
      </div>
    </div>
  );
}
