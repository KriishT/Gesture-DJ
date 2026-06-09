import { getEngine } from "../state/store";
import {
  getStreamFps,
  startCaptureCompositor,
  stopCaptureCompositor,
} from "./captureCompositor";

let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];

function pickMime(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "video/webm";
}

export function isRecording(): boolean {
  return recorder !== null && recorder.state === "recording";
}

/** Start recording the full DJ rig (decks + waveforms + camera) + master audio. */
export function startRecording(): boolean {
  if (isRecording()) return true;

  const canvas = startCaptureCompositor();
  if (!canvas) return false;

  const stream = canvas.captureStream(getStreamFps());
  const audio = getEngine().getAudioStream();
  audio.getAudioTracks().forEach((t) => stream.addTrack(t));

  chunks = [];
  recorder = new MediaRecorder(stream, { mimeType: pickMime() });
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start();
  return true;
}

/** Stop recording and trigger a download of the clip. */
export function stopRecording(): void {
  if (!recorder) {
    stopCaptureCompositor();
    return;
  }
  const rec = recorder;
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gesture-dj-${Date.now()}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    recorder = null;
    chunks = [];
    stopCaptureCompositor();
  };
  rec.stop();
}

export { setCaptureRoot } from "./captureCompositor";
