import { useStore } from "../state/store";
import { Waveform } from "./Waveform";
import { useCopilot } from "./useCopilot";

const COLOR_A = "#ff5e7e";
const COLOR_B = "#00d2a8";

/** Full-width dual waveform row spanning both deck columns above the platters. */
export function WaveformRig() {
  const deckA = useStore((s) => s.decks.A);
  const deckB = useStore((s) => s.decks.B);
  const seek = useStore((s) => s.seek);
  const copilot = useCopilot();
  const recipe = copilot.recipe;

  return (
    <div className="waveform-rig">
      <div className="wave-col A">
        <div className="wave-col-head">
          <span className="wave-tag">A</span>
          <span className="wave-name">{deckA.fileName ?? "Channel A"}</span>
        </div>
        {deckA.hasTrack ? (
          <Waveform
            peaks={deckA.peaks}
            position={deckA.position}
            duration={deckA.duration}
            color={COLOR_A}
            cueOut={recipe?.cueOutA ?? null}
            onSeek={(s) => seek("A", s)}
            variant="rig"
          />
        ) : (
          <div className="wave-empty">Load a track on channel A</div>
        )}
      </div>

      <div className="wave-col center" aria-hidden />

      <div className="wave-col B">
        <div className="wave-col-head">
          <span className="wave-tag">B</span>
          <span className="wave-name">{deckB.fileName ?? "Channel B"}</span>
        </div>
        {deckB.hasTrack ? (
          <Waveform
            peaks={deckB.peaks}
            position={deckB.position}
            duration={deckB.duration}
            color={COLOR_B}
            cueIn={recipe?.cueInB ?? null}
            onSeek={(s) => seek("B", s)}
            variant="rig"
          />
        ) : (
          <div className="wave-empty">Load a track on channel B</div>
        )}
      </div>
    </div>
  );
}
