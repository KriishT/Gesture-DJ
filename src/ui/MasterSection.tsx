import { useStore } from "../state/store";
import { ChannelMeter } from "./ChannelMeter";
import { Fader } from "./Fader";

export function MasterSection() {
  const crossfader = useStore((s) => s.crossfader);
  const setCrossfader = useStore((s) => s.setCrossfader);
  const masterVolume = useStore((s) => s.masterVolume);
  const setMasterVolume = useStore((s) => s.setMasterVolume);
  const masterLevel = useStore((s) => s.masterLevel);
  const levelA = useStore((s) => s.deckLevelA);
  const levelB = useStore((s) => s.deckLevelB);
  const quantize = useStore((s) => s.quantize);
  const setQuantize = useStore((s) => s.setQuantize);
  const slipMode = useStore((s) => s.slipMode);
  const setSlipMode = useStore((s) => s.setSlipMode);
  const padMode = useStore((s) => s.padMode);
  const setPadMode = useStore((s) => s.setPadMode);

  return (
    <div className="master-section">
      <div className="master-head">MASTER</div>

      <div className="master-meters">
        <ChannelMeter level={levelA} color="var(--a-color)" label="A" />
        <ChannelMeter level={levelB} color="var(--b-color)" label="B" />
      </div>

      <div className="crossfader master-xf">
        <span className="xf-label a">A</span>
        <div className="xf-track-wrap">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={crossfader}
            onChange={(e) => setCrossfader(Number(e.target.value))}
          />
          <div className="vu master-vu">
            <div style={{ width: `${Math.round(masterLevel * 100)}%` }} />
          </div>
        </div>
        <span className="xf-label b">B</span>
      </div>

      <div className="master-controls">
        <div className="master-fader-wrap">
          <Fader value={masterVolume} color="#ff8a1e" onChange={setMasterVolume} height={42} />
          <span className="fader-label">MST</span>
        </div>

        <div className="master-toggles">
          <button
            className={`mode-btn ${quantize ? "on" : ""}`}
            onClick={() => setQuantize(!quantize)}
            title="Snap cue jumps to nearest beat"
          >
            QUANT
          </button>
          <button
            className={`mode-btn ${slipMode ? "on" : ""}`}
            onClick={() => setSlipMode(!slipMode)}
            title="Slip mode — loop continues under pause (visual)"
          >
            SLIP
          </button>
          <button
            className={`mode-btn ${padMode === "fx" ? "on" : ""}`}
            onClick={() => setPadMode(padMode === "cue" ? "fx" : "cue")}
            title="Toggle pad row emphasis"
          >
            {padMode === "cue" ? "CUE PADS" : "FX PADS"}
          </button>
        </div>
      </div>
    </div>
  );
}
