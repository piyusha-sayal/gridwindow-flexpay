import { RUN_STATUS_LABEL } from "@/components/recoveryCopy";
import type { RecoveryReceipt } from "@/server/services/recoveryReceipt";

/**
 * Driver-facing outcome of recovery runs that no longer await a decision (declined, infeasible, expired, applied).
 * A run with no written schedule version leaves the original schedule in place, and the text says so.
 */
export function RecoveryStatus({ recovery }: { recovery: RecoveryReceipt }) {
  const settled = recovery.runs.filter((run) => run.status !== "NEEDS_APPROVAL" && run.status !== "RUNNING");
  if (settled.length === 0) return null;
  return (
    <section className="card p-5 sm:p-6 space-y-3" aria-labelledby="recovery-status-title">
      <h2 id="recovery-status-title" className="text-[18px] font-semibold tracking-[-0.01em]">
        Charging change outcome
      </h2>
      <p className="meta">Disturbances on this reservation are SYNTHETIC simulated inputs.</p>
      <ul className="space-y-2 text-[14px]">
        {settled.map((run) => (
          <li key={run.runId}>
            <strong>{RUN_STATUS_LABEL[run.status]}</strong>
            {run.reason && <span> · {run.reason}</span>}
            {run.consent === null && <span> Your original schedule is unchanged.</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
