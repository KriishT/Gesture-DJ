import { useState } from "react";
import { startRecording, stopRecording } from "./recorder";

export function RecordButton() {
  const [recording, setRecording] = useState(false);

  const toggle = () => {
    if (recording) {
      stopRecording();
      setRecording(false);
    } else {
      const ok = startRecording();
      if (ok) setRecording(true);
    }
  };

  return (
    <button
      className="btn"
      onClick={toggle}
      title="Record decks, waveforms, camera, and mix audio"
      style={recording ? { borderColor: "var(--red)", color: "var(--red)" } : undefined}
    >
      {recording ? "■ Stop & save" : "● Record clip"}
    </button>
  );
}
