"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/components/api";
import { RUN_STATUS_LABEL } from "@/components/recoveryCopy";
import { Alert, Badge, PaymentBadge } from "@/components/ui";
import { formatUsd } from "@/domain/units";
import type { RecoveryRunView } from "@/server/services/recoveryRuns";
import type { ReservationView } from "@/server/services/viewService";
import { buildScenarioSteps, type ScenarioStep } from "./recoveryDemoSteps";

const STEP_STATUS_LABEL: Record<ScenarioStep["status"], string> = { done: "Done", pending: "Waiting", none: "Not applicable" };

/** Scenario C checklist: each step is read from the persisted run, reservation and provider mode. */
function ScenarioChecklist({ steps }: { steps: ScenarioStep[] }) {
  return (
    <section aria-labelledby="scenario-c-title" className="space-y-2">
      <h3 id="scenario-c-title" className="text-[16px] font-semibold">Scenario C: recovery steps</h3>
      <ol className="space-y-2 text-[14px]">
        {steps.map((step, i) => (
          <li key={step.id} className="rounded-[var(--r-card-sm)] border border-line-2 p-2">
            <span className="font-semibold">
              {i + 1}. {step.title}
            </span>{" "}
            <span className="meta">· {STEP_STATUS_LABEL[step.status]}</span>
            <p className="text-muted">{step.detail}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

interface Loaded {
  payment: ReservationView["paymentState"];
  providerMode: string;
  run: RecoveryRunView | null;
}

/** Operator view of one disturbance: its run status, reasoning summary, tool trace, proposal and payment state. */
export function RecoveryRunDetail({ eventId, reservationId }: { eventId: string; reservationId: string }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const { reservation } = await api<{ reservation: ReservationView }>(`/api/reservations/${encodeURIComponent(reservationId)}`);
        const entry = reservation.recovery?.runs.find((r) => r.eventId === eventId);
        const run = entry ? (await api<{ run: RecoveryRunView }>(`/api/recovery/runs/${encodeURIComponent(entry.runId)}`)).run : null;
        if (alive) {
          setData({ payment: reservation.paymentState, providerMode: reservation.providerMode, run });
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? e.message : "Could not load this recovery.");
      }
    }
    void load();
    const timer = setInterval(() => void load(), 3_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [eventId, reservationId]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!data) return <p aria-live="polite" className="text-muted">Loading recovery run…</p>;
  const steps = buildScenarioSteps({ eventId, run: data.run, paymentState: data.payment, providerMode: data.providerMode });
  const checklist = <ScenarioChecklist steps={steps} />;
  if (!data.run) {
    return <div className="space-y-5 border-t border-line pt-5">{checklist}</div>;
  }

  const run = data.run;
  return (
    <div className="space-y-5 border-t border-line pt-5" aria-labelledby={`run-${run.runId}`}>
      {checklist}
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`run-${run.runId}`} className="text-[17px] font-semibold">
          Run {run.runId.slice(-8)}
        </h3>
        <Badge tone={run.status === "NEEDS_APPROVAL" ? "warn" : run.status === "COMMITTED" || run.status === "APPROVED" ? "success" : "info"}>
          {RUN_STATUS_LABEL[run.status]}
        </Badge>
        <Badge tone="neutral">{run.aiUsed ? "AI assisted" : "Deterministic (no AI)"}</Badge>
        <PaymentBadge state={data.payment} />
      </div>

      {run.explanation && (
        <div className="space-y-1">
          <p className="meta">Reasoning summary · {run.explanation.source === "MODEL" ? "model text, checked against backend numbers" : "deterministic text"}</p>
          <p className="text-[15px]">{run.explanation.text}</p>
        </div>
      )}

      {run.outcome && <p className="text-[14px]">{run.outcome.reason}</p>}

      {run.proposal && (
        <dl className="grid gap-2 text-[14px] sm:grid-cols-2">
          <div>
            <dt className="meta">Proposed preference</dt>
            <dd>{run.proposal.preference}</dd>
          </div>
          <div>
            <dt className="meta">Price (unchanged)</dt>
            <dd>{formatUsd(run.proposal.priceCents)}</dd>
          </div>
          <div>
            <dt className="meta">Energy cost</dt>
            <dd>{formatUsd(run.proposal.energyCostCents)}</dd>
          </div>
          <div>
            <dt className="meta">Operator improvement</dt>
            <dd>{formatUsd(run.proposal.operatorImprovementCents)}</dd>
          </div>
          {run.expiresAt && (
            <div>
              <dt className="meta">Proposal expires</dt>
              <dd>{new Date(run.expiresAt).toISOString().replace("T", " ").slice(0, 16)} UTC</dd>
            </div>
          )}
        </dl>
      )}

      {run.outcome && run.outcome.candidates.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-[15px] font-semibold">Candidates considered</h4>
          <ul className="space-y-1 text-[14px]">
            {run.outcome.candidates.map((c, i) => (
              <li key={`${c.preference}-${i}`}>
                {c.preference} · {c.chosen ? "chosen" : c.status === "REJECTED" ? "rejected" : "proposed"}
                {c.reason ? ` · ${c.reason}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="text-[14px]">
        <summary className="cursor-pointer font-semibold">Tool trace ({run.trace.length} entries)</summary>
        <ol className="mt-2 space-y-2">
          {run.trace.map((t) => (
            <li key={t.seq} className="rounded-[var(--r-card-sm)] border border-line-2 p-2">
              <span className="font-mono text-[12px]">
                #{t.seq} {t.tool} · {t.actor} · {t.outcome}
              </span>
              <p className="text-muted">{t.detail}</p>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
