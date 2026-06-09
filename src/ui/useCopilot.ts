import { useSyncExternalStore } from "react";
import { session } from "../session";
import type { CopilotRuntime } from "../copilot/CoPilotEngine";

/** Subscribe a component to the co-pilot runtime state. */
export function useCopilot(): CopilotRuntime {
  const copilot = session.getCopilot();
  return useSyncExternalStore(copilot.subscribe, copilot.getSnapshot);
}
