import { useRef, useState } from "react";
import { useStore, type DeckId } from "../state/store";
import { STEM_NAMES } from "../stems/client";
import { formatTime } from "./format";
import { Knob } from "./Knob";
import { Fader } from "./Fader";
import { VinylPlatter } from "./VinylPlatter";
import { ChannelMeter } from "./ChannelMeter";

const ACCENT = "#ff8a1e";
const LOOP_LENGTHS = [4, 8, 16];

export function DeckView({ id }: { id: DeckId }) {
  const deck = useStore((s) => s.decks[id]);
  const loadFile = useStore((s) => s.loadFile);
  const togglePlay = useStore((s) => s.togglePlay);
  const setVolume = useStore((s) => s.setVolume);
  const setFilter = useStore((s) => s.setFilter);
  const setEq = useStore((s) => s.setEq);
  const setRate = useStore((s) => s.setRate);
  const seek = useStore((s) => s.seek);
  const toggleBassKill = useStore((s) => s.toggleBassKill);
  const toggleEcho = useStore((s) => s.toggleEcho);
  const toggleReverb = useStore((s) => s.toggleReverb);
  const syncDeck = useStore((s) => s.syncDeck);
  const setCue = useStore((s) => s.setCue);
  const jumpCue = useStore((s) => s.jumpCue);
  const toggleLoop = useStore((s) => s.toggleLoop);
  const deckBrake = useStore((s) => s.deckBrake);
  const deckSpinback = useStore((s) => s.deckSpinback);
  const deckGate = useStore((s) => s.deckGate);
  const setStemPreset = useStore((s) => s.setStemPreset);
  const toggleStem = useStore((s) => s.toggleStem);
  const padMode = useStore((s) => s.padMode);

  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const num = id === "A" ? "1" : "2";

  const onFiles = (files: FileList | null) => {
    if (files && files[0]) void loadFile(id, files[0]);
  };

  return (
    <section className={`deck ${id}`} style={{ ["--accent" as string]: ACCENT }}>
      <div className="deck-head">
        <div className="deck-label">CH {id}</div>
        <div className="deck-title">{deck.fileName ?? "Drop audio file here or click LOAD"}</div>
        <button className="mini-btn" onClick={() => inputRef.current?.click()}>
          LOAD
        </button>
      </div>

      <div className="deck-meta">
        <div className="readout time">{formatTime(deck.position)}</div>
        <div className="meta-right">
          <ChannelMeter level={deck.channelLevel} color={ACCENT} label="" />
          <span className="bpm">
            <b>{deck.bpm ? deck.bpm.toFixed(0) : "---"}</b>
            <small>BPM</small>
          </span>
          <span className="keybox">{deck.analysis?.camelotKey ?? "--"}</span>
          {deck.keyLock && <span className="keylock-badge">KEY</span>}
          <span className="rem">-{formatTime(Math.max(0, deck.duration - deck.position))}</span>
        </div>
      </div>

      {deck.hasTrack && (
        <div className={`stem-bar ${deck.stemsStatus}`}>
          {deck.stemsStatus === "processing" && (
            <>
              <span>Separating stems… {Math.round(deck.stemsProgress * 100)}%</span>
              {deck.stemsElapsedSec != null && (
                <span className="stem-time">{deck.stemsElapsedSec.toFixed(1)}s</span>
              )}
            </>
          )}
          {deck.stemsStatus === "ready" && (
            <span>
              ✓ 6 stems ready
              {deck.stemsElapsedSec != null ? ` (${deck.stemsElapsedSec.toFixed(1)}s)` : ""}
            </span>
          )}
          {deck.stemsStatus === "unavailable" && (
            <span title={deck.stemsError ?? undefined}>
              Stems need GPU setup — see docs/STEMS_SETUP.md
            </span>
          )}
          {deck.stemsStatus === "error" && (
            <span title={deck.stemsError ?? undefined}>Stem error</span>
          )}
        </div>
      )}

      {deck.hasTrack ? (
        <>
          <div className="deck-jog-row">
            <VinylPlatter deckId={id} playing={deck.playing} label={num} />

            <div className="deck-controls">
              <div className="knob-bank">
                <Knob label="HI" value={deck.eq.high} min={-26} max={6} color={ACCENT} onChange={(v) => setEq(id, { high: v })} />
                <Knob label="MID" value={deck.eq.mid} min={-26} max={6} color={ACCENT} onChange={(v) => setEq(id, { mid: v })} />
                <Knob label="LOW" value={deck.eq.low} min={-26} max={6} color={ACCENT} onChange={(v) => setEq(id, { low: v })} />
                <Knob label="FILTER" value={deck.filter} min={-1} max={1} color={ACCENT} onChange={(v) => setFilter(id, v)} />
                <Knob
                  label="TEMPO"
                  value={deck.rate}
                  min={0.9}
                  max={1.1}
                  color={ACCENT}
                  format={(v) => `${((v - 1) * 100).toFixed(1)}`}
                  onChange={(v) => setRate(id, v)}
                />
              </div>

              <div className="fader-col">
                <Fader value={deck.volume} color={ACCENT} onChange={(v) => setVolume(id, v)} height={120} />
                <span className="fader-label">VOL</span>
              </div>
            </div>
          </div>

          <div className="transport-row">
            <button className="cue-btn" onClick={() => seek(id, 0)} title="Back to start">
              CUE
            </button>
            <button
              className={`play-btn ${deck.playing ? "on" : ""}`}
              onClick={() => togglePlay(id)}
              aria-label={deck.playing ? "Pause" : "Play"}
            >
              {deck.playing ? "❚❚" : "►"}
            </button>
            <button className="mini-btn wide" onClick={() => syncDeck(id)}>
              SYNC
            </button>
          </div>

          <div className={`pad-grid ${padMode === "fx" ? "emphasis-fx" : "emphasis-cue"}`}>
            {[0, 1, 2, 3].map((i) => (
              <button
                key={i}
                className={`pad cue ${deck.cues[i] >= 0 ? "set" : ""}`}
                onClick={() => jumpCue(id, i)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCue(id, i);
                }}
                title="Click to jump / set · right-click to set"
              >
                CUE {i + 1}
              </button>
            ))}
            {LOOP_LENGTHS.map((b) => (
              <button
                key={`loop${b}`}
                className={`pad loop ${deck.loopBeats === b ? "on" : ""}`}
                onClick={() => toggleLoop(id, b)}
              >
                LOOP {b}
              </button>
            ))}
            <button className={`pad fx ${deck.bassKill ? "on" : ""}`} onClick={() => toggleBassKill(id)}>
              BASS
            </button>
            <button className={`pad fx ${deck.echoOn ? "on" : ""}`} onClick={() => toggleEcho(id)}>
              ECHO
            </button>
            <button className={`pad fx ${deck.reverbOn ? "on" : ""}`} onClick={() => toggleReverb(id)}>
              REVERB
            </button>
            <button className="pad fx" onClick={() => deckGate(id)}>
              GATE
            </button>
            <button className="pad fx" onClick={() => deckBrake(id)}>
              BRAKE
            </button>
            <button className="pad fx" onClick={() => deckSpinback(id)}>
              SPIN
            </button>
          </div>

          {deck.stemsStatus === "ready" && (
            <>
              <div className="pad-grid stem-presets">
                {(
                  [
                    ["full", "FULL"],
                    ["acapella", "ACA"],
                    ["instrumental", "INST"],
                    ["drums", "DRUM"],
                    ["bass", "BASS"],
                    ["guitar", "GUIT"],
                    ["piano", "PIAN"],
                  ] as const
                ).map(([preset, label]) => (
                  <button
                    key={preset}
                    className={`pad stem ${deck.stemPreset === preset ? "on" : ""}`}
                    onClick={() => setStemPreset(id, preset)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="pad-grid stem-toggles">
                {STEM_NAMES.map((stem) => (
                  <button
                    key={stem}
                    className={`pad stem-toggle ${deck.stemLevels[stem] > 0.5 ? "on" : ""}`}
                    onClick={() => toggleStem(id, stem)}
                    title={`Toggle ${stem} stem`}
                  >
                    {stem.slice(0, 4).toUpperCase()}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <label
          className={`upload ${drag ? "drag" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            onFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
        >
          {deck.loading ? (
            <div>Analyzing track…</div>
          ) : (
            <div>
              <div style={{ fontSize: 28, marginBottom: 6 }}>＋</div>
              <div>Drop an audio file here</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>or click to browse (mp3, wav)</div>
            </div>
          )}
        </label>
      )}

      <input ref={inputRef} type="file" accept="audio/*" hidden onChange={(e) => onFiles(e.target.files)} />
    </section>
  );
}
