import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import type { StemBackendInfo, StemBackendMode } from "../stems/types";

const MODES: { id: StemBackendMode; label: string; title: string }[] = [
  { id: "auto", label: "Auto", title: "Your GPU first, Replicate if unavailable or fails" },
  { id: "local", label: "GPU", title: "Local NVIDIA GPU only (fastest)" },
  { id: "cloud", label: "Cloud", title: "Replicate API only (~$0.14/track)" },
];

export function StemBackendControl() {
  const mode = useStore((s) => s.stemBackendMode);
  const setMode = useStore((s) => s.setStemBackendMode);
  const info = useStore((s) => s.stemBackendInfo);
  const refresh = useStore((s) => s.refreshStemBackendInfo);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const showBanner = info && !dismissed;

  return (
    <>
      <div className="stem-backend-toggle" role="group" aria-label="Stem separation backend">
        <span className="stem-backend-label">Stems</span>
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={mode === m.id ? "active" : ""}
            title={m.title}
            disabled={
              (m.id === "local" && Boolean(info && !info.localGpu)) ||
              (info?.serverCloudOnly && m.id !== "cloud")
            }
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {showBanner && (
        <div className={`stem-backend-banner${info.serverCloudOnly ? " warn" : ""}`}>
          <p>{bannerText(mode, info)}</p>
          <button type="button" className="btn ghost sm" onClick={() => setDismissed(true)}>
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}

function bannerText(mode: StemBackendMode, info: StemBackendInfo): string {
  if (info.serverCloudOnly) {
    return "This API server has STEMS_CLOUD_ONLY enabled — all stems run on Replicate (~$0.14/track). Restart the server after changing .env to use your local GPU.";
  }
  if (mode === "cloud") {
    return "Using Replicate cloud stems (~$0.14/track). Switch to Auto or GPU in the top bar if you run the API on your own machine with an NVIDIA GPU.";
  }
  if (!info.localGpu && info.cloud) {
    return "No GPU on this API server — Auto will use Replicate. Deployed apps cannot use your browser GPU; only the machine running the API can.";
  }
  if (info.localGpu && mode === "auto") {
    return "Auto uses this machine's GPU first (fast & free). If GPU separation fails, you'll see an error — use Retry via Replicate only if you want cloud.";
  }
  return info.message;
}
