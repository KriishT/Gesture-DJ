import { GESTURE_DOCS, SOLO_TRANSITION_EXAMPLES } from "../control/mappings";

export function GestureGuide({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal guide-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Solo Gesture Guide</h2>
        <p className="guide-intro">
          <b className="a">Left hand</b> = Deck A · <b className="b">Right hand</b> = Deck B.
          Mappings are <b>fixed in Solo mode</b> — learn them once, then mix freely.
          Dual-hand moves (spread, both fists) count as <b>one action</b>.
        </p>

        <h3 className="guide-section">Hand controls</h3>
        {GESTURE_DOCS.map((g) => (
          <div className="guide-item" key={g.id}>
            <div className="controls-tag">{g.controls}</div>
            <div>
              <div className="gtitle">
                {g.title}
                {g.hand === "both" && <span className="hand-tag both">BOTH</span>}
                {g.hand === "left" && <span className="hand-tag a">L</span>}
                {g.hand === "right" && <span className="hand-tag b">R</span>}
              </div>
              <div className="desc">{g.description}</div>
            </div>
          </div>
        ))}

        <h3 className="guide-section">Deck controls (tap on screen)</h3>
        <p className="guide-intro">
          HI / MID / LOW · FILTER · TEMPO knobs · CUE pads · LOOP 4/8/16 · BASS · ECHO · REVERB ·
          GATE · BRAKE · SPIN · drag the vinyl to scratch.
        </p>

        <h3 className="guide-section">Example transitions (gesture sequences)</h3>
        <p className="guide-intro">
          Copy these flows in Solo mode — combine gestures + deck pads to nail popular moves:
        </p>
        {SOLO_TRANSITION_EXAMPLES.map((ex) => (
          <div className="example-card" key={ex.name}>
            <div className="example-head">
              <span className="example-name">{ex.name}</span>
              <span className="example-vibe">{ex.vibe}</span>
            </div>
            <ol className="example-steps">
              {ex.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </div>
        ))}

        <div className="guide-footer">
          <button className="btn primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
