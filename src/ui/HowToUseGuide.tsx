export function HowToUseGuide({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal guide-modal howto-modal" onClick={(e) => e.stopPropagation()}>
        <h2>How to use Gesture DJ</h2>
        <p className="guide-intro">
          Mix two decks with your hands (or mouse). AI Assist walks you through pro-style transitions.
        </p>

        <h3 className="guide-section">Quick start</h3>
        <ol className="howto-steps">
          <li>
            <b>Click once</b> anywhere to enable audio.
          </li>
          <li>
            Open <b>Library</b> → <b>My files</b> and <b>Load both</b>, or use <b>LOAD</b> on each deck.
          </li>
          <li>
            Click <b>Start camera</b> for hand control (optional).
          </li>
          <li>
            In <b>AI Assist</b>, click <b>Suggest transitions</b>, pick one, play Deck A, follow the cues.
          </li>
        </ol>

        <h3 className="guide-section">Top bar</h3>
        <ul className="howto-list">
          <li>
            <b>DJ / Remix</b> — mixing vs vocal mashups
          </li>
          <li>
            <b>AI Assist / Solo</b> — co-pilot vs fixed gesture map
          </li>
          <li>
            <b>Stems</b> — Auto / GPU / Cloud (live site uses Cloud, ~1–4 min per track)
          </li>
          <li>
            <b>Library</b> — My files (demo sets) + Pair ideas
          </li>
          <li>
            <b>Record</b> — export session as .webm
          </li>
        </ul>

        <h3 className="guide-section">During a transition</h3>
        <p className="guide-intro">
          Play toward the <b>amber marker</b> on the waveform. Gesture hints appear on the camera.
          <b> Green</b> = on time · <b>Red</b> = missed (mix still runs). Use <b>Build custom</b> to
          design your own move stack.
        </p>

        <h3 className="guide-section">Stems</h3>
        <p className="guide-intro">
          When stems finish, use stem preset pads (acapella, drums, bass, etc.) for advanced transitions.
          Best results when <b>both</b> decks have stems ready.
        </p>

        <h3 className="guide-section">Tips</h3>
        <ul className="howto-list">
          <li>Use <b>SYNC</b> when BPMs are far apart.</li>
          <li>No demo files? <b>LOAD</b> your own MP3/WAV on each deck.</li>
          <li>Solo mode: open <b>Gesture guide</b> for the full hand map.</li>
        </ul>

        <div className="guide-footer">
          <button type="button" className="btn primary" onClick={onClose}>
            Got it — let&apos;s mix
          </button>
        </div>
      </div>
    </div>
  );
}
