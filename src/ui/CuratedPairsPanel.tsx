import { useEffect, useState } from "react";

import { CURATED_PAIRS, type CuratedPair } from "../data/curatedPairs";

import { fetchDemoPairs, loadDemoPairById } from "../demo/client";
import { guideForDemoSet } from "../data/demoSetGuide";
import { session } from "../session";

import { useStore } from "../state/store";



function PairCard({

  pair,

  hasFiles,

  loading,

  onActivate,

}: {

  pair: CuratedPair;

  hasFiles: boolean;

  loading: boolean;

  onActivate: () => void;

}) {

  const modeLabel =

    pair.mode === "both" ? "Transition + Remix" : pair.mode === "remix" ? "Remix" : "Transition";



  return (

    <button

      type="button"

      className={`pair-card pair-card-btn ${loading ? "loading" : ""} ${hasFiles ? "has-files" : ""}`}

      onClick={onActivate}

      disabled={loading}

    >

      <div className="pair-card-top">

        <span className="pair-card-action">{hasFiles ? "Load pair →" : "Tap for folder name"}</span>

        {hasFiles && <span className="pair-tag ready">Files ready</span>}

      </div>

      <div className="pair-decks">

        <div className="pair-deck a">

          <span className="pair-label">A</span>

          <strong>{pair.deckA.title}</strong>

          <span className="pair-artist">{pair.deckA.artist}</span>

        </div>

        <span className="pair-arrow">→</span>

        <div className="pair-deck b">

          <span className="pair-label">B</span>

          <strong>{pair.deckB.title}</strong>

          <span className="pair-artist">{pair.deckB.artist}</span>

        </div>

      </div>

      <div className="pair-meta">

        <span className={`pair-tag ${pair.difficulty}`}>{pair.difficulty}</span>

        <span className="pair-tag">{modeLabel}</span>

        {pair.stemsRecommended && <span className="pair-tag stem">Stems</span>}

        <span className="pair-tag muted">{pair.genres}</span>

      </div>

      <p className="pair-why">{pair.why}</p>

      <div className="pair-picks">

        <span className="pair-picks-label">Try:</span> {pair.transitions.join(" · ")}

      </div>

      {pair.remixTip && <p className="pair-remix">{pair.remixTip}</p>}

      <p className="pair-bpm">

        {hasFiles ? (

          <>Folder: <code>public/demo/{pair.id}/</code></>

        ) : (

          <>

            Add <code>public/demo/{pair.id}/a.mp3</code> + <code>b.mp3</code>

          </>

        )}

      </p>

    </button>

  );

}



/** Recommended song pairs — click to load from matching demo folder. */

export function CuratedPairsPanel({

  variant = "card",

  onPairLoaded,

}: {

  variant?: "card" | "dock";

  onPairLoaded?: () => void;

}) {

  const loadPairToDecks = useStore((s) => s.loadPairToDecks);
  const setActiveDemoSetId = useStore((s) => s.setActiveDemoSetId);

  const [open, setOpen] = useState(variant === "dock");

  const [filter, setFilter] = useState<"all" | "transition" | "remix">("all");

  const [demoIds, setDemoIds] = useState<Set<string>>(new Set());

  const [loadingId, setLoadingId] = useState<string | null>(null);

  const [message, setMessage] = useState<string | null>(null);



  useEffect(() => {

    void fetchDemoPairs().then((pairs) => setDemoIds(new Set(pairs.map((p) => p.id))));

  }, []);



  const pairs = CURATED_PAIRS.filter((p) => {

    if (filter === "all") return true;

    if (filter === "remix") return p.mode === "remix" || p.mode === "both";

    return p.mode === "transition" || p.mode === "both";

  });



  const activatePair = async (pair: CuratedPair) => {

    setMessage(null);

    setLoadingId(pair.id);

    try {

      const loaded = await loadDemoPairById(pair.id);

      if (!loaded) {

        setMessage(

          `No files yet — create public/demo/${pair.id}/ with a.mp3 and b.mp3, then click ↻ on My files.`,

        );

        return;

      }

      await loadPairToDecks(loaded.fileA, loaded.fileB);
      const guide = guideForDemoSet(pair.id);
      setActiveDemoSetId(guide ? pair.id : null);
      if (guide?.remixDirection) {
        session.getRemixEngine().setDirection(guide.remixDirection);
      }

      setMessage(`Loaded ${pair.deckA.title} → ${pair.deckB.title}`);

      onPairLoaded?.();

    } catch (e) {

      setMessage(e instanceof Error ? e.message : "Failed to load pair");

    } finally {

      setLoadingId(null);

    }

  };



  const shell = variant === "dock" ? "curated-pairs dock-pane" : "curated-pairs";

  const expanded = variant === "dock" || open;



  return (

    <div className={shell}>

      {variant === "card" && (

        <button type="button" className="curated-pairs-toggle" onClick={() => setOpen((v) => !v)}>

          <span>Recommended pairs</span>

          <span className="curated-count">{CURATED_PAIRS.length} sets</span>

          <span>{open ? "▾" : "▸"}</span>

        </button>

      )}



      {expanded && (

        <>

          <p className="curated-note">

            Click a pair to load both tracks from <code>public/demo/&lt;id&gt;/</code> — folder name

            must match the pair id (e.g. <code>house-classics</code>).

          </p>

          {message && <p className="pair-load-msg">{message}</p>}

          <div className="pair-filters">

            {(["all", "transition", "remix"] as const).map((f) => (

              <button

                key={f}

                type="button"

                className={`btn ghost small ${filter === f ? "active" : ""}`}

                onClick={() => setFilter(f)}

              >

                {f === "all" ? "All" : f === "remix" ? "Remix" : "Transitions"}

              </button>

            ))}

          </div>

          <div className="pair-list">

            {pairs.map((p) => (

              <PairCard

                key={p.id}

                pair={p}

                hasFiles={demoIds.has(p.id)}

                loading={loadingId === p.id}

                onActivate={() => void activatePair(p)}

              />

            ))}

          </div>

        </>

      )}

    </div>

  );

}


