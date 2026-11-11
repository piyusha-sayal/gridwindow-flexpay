"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/components/api";
import { describeRecoveryError, FORECAST_NOTE } from "@/components/recoveryCopy";
import { Alert, Badge } from "@/components/ui";
import { formatLocalTime } from "@/domain/time";
import { formatKWh, formatUsd, SLOT_MS, SLOTS_PER_HOUR } from "@/domain/units";
import type { RecoveryProposal, RecoveryRunView } from "@/server/services/recoveryRuns";
import type { ReservationView } from "@/server/services/viewService";

/** Grid energy in Wh for a per-slot watt plan (each slot is 1/SLOTS_PER_HOUR of an hour). */
function planWh(powerW: readonly number[]): number {
  return Math.round(powerW.reduce((sum, w) => sum + w / SLOTS_PER_HOUR, 0));
}

/** Start of the slot after the last charging slot: when the plan stops drawing power. */
function finishMs(gridStartMs: number, powerW: readonly number[]): number | null {
  let last = -1;
  powerW.forEach((w, i) => {
    if (w > 0) last = i;
  });
  return last < 0 ? null : gridStartMs + (last + 1) * SLOT_MS;
}

function fmtTime(ms: number | null, r: ReservationView): string {
  return ms === null ? "no charging" : formatLocalTime(ms, r.timeZone);
}

interface PendingRun {
  runId: string;
  run: RecoveryRunView;
}

/**
 * Driver consent for a recovery proposal. Shows the unchanged promise next to the proposed plan, and approve or
 * decline buttons. Only the driver's own pending runs appear; the server re-checks ownership, version and expiry.
 */
export function RecoveryConsent({ r, onChanged }: { r: ReservationView; onChanged: () => void }) {
  // Results are keyed by the pending run ids, so a stale load never shows for a different set of runs.
  const [loaded, setLoaded] = useState<{ key: string; items: PendingRun[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pendingIds = (r.recovery?.runs ?? []).filter((run) => run.status === "NEEDS_APPROVAL").map((run) => run.runId).join(",");
  const pending = pendingIds && loaded?.key === pendingIds ? loaded.items : [];
  const error = actionError ?? loadError;

  useEffect(() => {
    if (!pendingIds) return;
    let alive = true;
    Promise.all(
      pendingIds.split(",").map((runId) => api<{ run: RecoveryRunView }>(`/api/recovery/runs/${encodeURIComponent(runId)}`).then(({ run }) => ({ runId, run }))),
    ).then(
      (items) => {
        if (!alive) return;
        setLoaded({ key: pendingIds, items });
        setLoadError(null);
      },
      (e: unknown) => alive && setLoadError(e instanceof ApiError ? e.message : "Could not load the proposal."),
    );
    return () => {
      alive = false;
    };
  }, [pendingIds]);

  // A decision that closed the proposal leaves its error visible, so the driver learns why nothing changed.
  if (pending.length === 0) return error ? <Alert tone="danger">{error}</Alert> : null;

  async function decide(runId: string, decision: "approve" | "reject") {
    setBusy(runId);
    setActionError(null);
    try {
      await api(`/api/recovery/runs/${encodeURIComponent(runId)}/${decision}`, { method: "POST", json: {} });
      onChanged();
    } catch (e) {
      setActionError(e instanceof ApiError ? describeRecoveryError(e.code, e.message) : "The decision could not be recorded.");
      // The proposal may have closed on the server (stale, expired or decided elsewhere): reload its current state.
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card card-amber pulse-ring p-5 sm:p-6 space-y-5" aria-labelledby="consent-title">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="consent-title" className="text-[22px] font-semibold tracking-[-0.01em]">
          Charging change proposed
        </h2>
        <Badge tone="warn">Needs your approval</Badge>
      </div>
      <p className="text-[14px] text-muted">
        A synthetic disturbance affected your charge. Your charging continues on your original schedule until you approve a change. Declining keeps the original schedule.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}

      <div className="stagger grid gap-4 sm:grid-cols-2">
        <OriginalPromise r={r} />
        {pending.map(({ runId, run }) => (
          <ProposalCard key={runId} r={r} run={run} busy={busy === runId} onDecide={(d) => void decide(runId, d)} />
        ))}
      </div>
    </section>
  );
}

function OriginalPromise({ r }: { r: ReservationView }) {
  return (
    <div className="promise-card rounded-[var(--r-card-sm)] border border-line p-4 space-y-2">
      <p className="eyebrow">Your original commitment</p>
      <dl className="text-[14px] space-y-1">
        <div className="plan-row flex justify-between gap-3">
          <dt className="text-muted">Departure</dt>
          <dd>{formatLocalTime(r.departMs, r.timeZone)}</dd>
        </div>
        <div className="plan-row flex justify-between gap-3">
          <dt className="text-muted">Finish charging</dt>
          <dd>{fmtTime(finishMs(r.gridStartMs, r.powerW), r)}</dd>
        </div>
        <div className="plan-row flex justify-between gap-3">
          <dt className="text-muted">Planned energy (forecast)</dt>
          <dd>{formatKWh(planWh(r.powerW))}</dd>
        </div>
        <div className="plan-row flex justify-between gap-3">
          <dt className="text-muted">Price</dt>
          <dd>{formatUsd(r.economics.priceCents)}</dd>
        </div>
      </dl>
    </div>
  );
}

function ProposalCard({ r, run, busy, onDecide }: { r: ReservationView; run: RecoveryRunView; busy: boolean; onDecide: (d: "approve" | "reject") => void }) {
  const proposal: RecoveryProposal | null = run.proposal;
  // The server reports a past-expiry proposal as EXPIRED, so the client never reads the clock to decide this.
  const expired = run.status === "EXPIRED";
  const proposedFinish = proposal ? finishMs(r.gridStartMs, proposal.powerW) : null;
  return (
    <div className="proposal-card rounded-[var(--r-card-sm)] border-2 border-dashed border-ink p-4 space-y-2" aria-labelledby={`proposal-${run.runId}`}>
      <p id={`proposal-${run.runId}`} className="eyebrow">
        Proposed change
      </p>
      {!proposal ? (
        <p className="text-[14px]">The proposal details are not available. Refresh to see the current status.</p>
      ) : (
        <dl className="text-[14px] space-y-1">
          <div className="plan-row flex justify-between gap-3">
            <dt className="text-muted">Finish charging</dt>
            <dd>{fmtTime(proposedFinish, r)}</dd>
          </div>
          <div className="plan-row flex justify-between gap-3">
            <dt className="text-muted">Planned energy (forecast)</dt>
            <dd>{formatKWh(planWh(proposal.powerW))}</dd>
          </div>
          <div className="plan-row flex justify-between gap-3">
            <dt className="text-muted">Price</dt>
            <dd>{formatUsd(proposal.priceCents)} (unchanged)</dd>
          </div>
          <div className="plan-row flex justify-between gap-3">
            <dt className="text-muted">Departure</dt>
            <dd>{formatLocalTime(r.departMs, r.timeZone)} (unchanged)</dd>
          </div>
          <div className="plan-row flex justify-between gap-3">
            <dt className="text-muted">Expires</dt>
            <dd>{run.expiresAt ? formatLocalTime(new Date(run.expiresAt).getTime(), r.timeZone) : "n/a"}</dd>
          </div>
        </dl>
      )}
      {proposal && <p className="meta">{FORECAST_NOTE}</p>}
      {expired ? (
        <Alert tone="warn">This proposal has expired, so your original schedule still stands. Ask the operator to request a new recovery if needed.</Alert>
      ) : (
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className="btn btn-primary" disabled={busy || !proposal} onClick={() => onDecide("approve")}>
            {busy ? "Saving…" : "Approve change"}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => onDecide("reject")}>
            Keep original schedule
          </button>
        </div>
      )}
    </div>
  );
}
