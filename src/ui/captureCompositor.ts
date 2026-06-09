import html2canvas from "html2canvas";

const STREAM_FPS = 30;
const MAX_SCALE = 1.25;
const BG_REFRESH_MS = 4000;

let captureRoot: HTMLElement | null = null;
let compositeCanvas: HTMLCanvasElement | null = null;
let compositeRaf = 0;
let backgroundShot: HTMLCanvasElement | null = null;
let bgCapturing = false;
let lastBgMs = 0;
let scale = 1;

export function setCaptureRoot(el: HTMLElement | null): void {
  captureRoot = el;
}

function layoutCanvas(root: HTMLElement, canvas: HTMLCanvasElement): number {
  const rect = root.getBoundingClientRect();
  scale = Math.min(MAX_SCALE, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  return scale;
}

/** One slow DOM snapshot for deck chrome, vinyl, labels — not per video frame. */
async function captureBackground(root: HTMLElement): Promise<HTMLCanvasElement> {
  return html2canvas(root, {
    backgroundColor: "#07080d",
    scale,
    logging: false,
    useCORS: true,
    allowTaint: true,
    imageTimeout: 0,
    removeContainer: true,
    onclone: (doc) => {
      // Static snapshot only — live layers are painted every frame on top.
      for (const c of doc.querySelectorAll("canvas")) {
        const el = c as HTMLCanvasElement;
        const ctx = el.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, el.width, el.height);
      }
    },
  });
}

function paintLiveLayers(root: HTMLElement, canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (backgroundShot) {
    ctx.drawImage(backgroundShot, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = "#07080d";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const rootRect = root.getBoundingClientRect();
  for (const node of root.querySelectorAll("canvas")) {
    const c = node as HTMLCanvasElement;
    if (c.width === 0 || c.height === 0) continue;
    const r = c.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const x = (r.left - rootRect.left) * scale;
    const y = (r.top - rootRect.top) * scale;
    ctx.drawImage(c, x, y, r.width * scale, r.height * scale);
  }
}

function maybeRefreshBackground(root: HTMLElement, now: number): void {
  if (bgCapturing) return;
  if (backgroundShot && now - lastBgMs < BG_REFRESH_MS) return;
  bgCapturing = true;
  lastBgMs = now;
  void captureBackground(root)
    .then((shot) => {
      backgroundShot = shot;
    })
    .finally(() => {
      bgCapturing = false;
    });
}

/** Hidden canvas stream — static UI snapshot + live canvas layers at 30fps. */
export function startCaptureCompositor(): HTMLCanvasElement | null {
  if (!captureRoot) return null;
  stopCaptureCompositor();

  const root = captureRoot;
  compositeCanvas = document.createElement("canvas");
  compositeCanvas.setAttribute("aria-hidden", "true");
  compositeCanvas.style.position = "fixed";
  compositeCanvas.style.left = "-9999px";
  compositeCanvas.style.top = "0";
  compositeCanvas.style.pointerEvents = "none";
  document.body.appendChild(compositeCanvas);

  layoutCanvas(root, compositeCanvas);
  lastBgMs = 0;
  void captureBackground(root).then((shot) => {
    backgroundShot = shot;
  });

  const loop = (now: number) => {
    if (!compositeCanvas || !captureRoot) return;
    compositeRaf = requestAnimationFrame(loop);
    layoutCanvas(captureRoot, compositeCanvas);
    paintLiveLayers(captureRoot, compositeCanvas);
    maybeRefreshBackground(captureRoot, now);
  };

  compositeRaf = requestAnimationFrame(loop);
  return compositeCanvas;
}

export function stopCaptureCompositor(): void {
  if (compositeRaf) cancelAnimationFrame(compositeRaf);
  compositeRaf = 0;
  backgroundShot = null;
  bgCapturing = false;
  compositeCanvas?.remove();
  compositeCanvas = null;
}

export function getStreamFps(): number {
  return STREAM_FPS;
}
