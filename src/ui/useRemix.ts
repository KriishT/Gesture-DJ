import { useEffect, useState } from "react";
import { session } from "../session";
import type { RemixSessionState } from "../remix/types";

export function useRemix(): RemixSessionState {
  const [snap, setSnap] = useState<RemixSessionState>(() =>
    session.getRemixEngine().getSnapshot(),
  );
  useEffect(() => session.getRemixEngine().subscribe(() => {
    setSnap(session.getRemixEngine().getSnapshot());
  }), []);
  return snap;
}
