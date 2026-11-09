import type { AppDeps } from "../deps";
import type { DisturbanceEventView } from "./scheduleService";
import { orchestrateRecovery } from "./recoveryOrchestrator";

/**
 * Starts autonomous recovery once a disturbance is recorded. Runs in the background so the operator's request never
 * waits on the model. Tests set deps.awaitRecovery to run the same path inline. Failures are logged, never thrown.
 */
export async function onDisruptionRecorded(deps: AppDeps, event: DisturbanceEventView): Promise<void> {
  const run = orchestrateRecovery(deps, event.eventId).then(
    () => undefined,
    (err: unknown) => console.warn("[gridwindow] recovery failed:", err instanceof Error ? err.name : "UNKNOWN"),
  );
  if (deps.awaitRecovery) await run;
}
