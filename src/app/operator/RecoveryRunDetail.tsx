"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/components/api";
import { attributionStatusText, RUN_STATUS_LABEL } from "@/components/recoveryCopy";
import { Alert, Badge, PaymentBadge } from "@/components/ui";
import type { FaultAttribution } from "@/domain/faultAttribution";
import { formatUsd } from "@/domain/units";
import { runProvenance } from "@/server/services/recoveryProvenance";
import type { RecoveryReceiptRun } from "@/server/services/recoveryReceipt";
import type { RecoveryRunView } from "@/server/services/recoveryRuns";
import type { ReservationView } from "@/server/services/viewService";
import { buildScenarioSteps, type ScenarioStep } from "./recoveryDemoSteps";

const STEP_STATUS_LABEL: Record<ScenarioStep["status"], string> = { done: "Done", pending: "Waiting", stopped: "Stopped", none: "Not applicable" };

/** Scenario C checklist: each step is read from the persisted run, reservation and provider mode. */
function ScenarioChecklist({ steps }: { steps: ScenarioStep[] }) {
  return (
    <section aria-labelledby="scenario-c-title" className="space-y-2">
      <h3 id="scenario-c-title" className="text-[16px] font-semibold">Scenario C: recovery steps</h3>
      <ol className="space-y-2 text-[14px]">
        {steps.map((step, i) => (
          <li key={step.id} className={`step-row is-${step.status} rounded-[var(--r-card-sm)] border border-line-2 p-2`}>
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
  proofTypes: string[];
  providerMode: string;
  eventProvenance: string | null;
  run: RecoveryRunView | null;
  consent: RecoveryReceiptRun["consent"];
}

/** Operator view of one disturbance: its run status, reasoning summary, tool trace, proposal and payment state. */
export function RecoveryRunDetail({ eventId, reservationId, attribution }: { eventId: string; reservationId: string; attribution: FaultAttribution }) {
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
          const eventProvenance = reservation.recovery?.disturbances.find((d) => d.eventId === eventId)?.provenance ?? null;
          setData({
            payment: reservation.paymentState,
            proofTypes: reservation.proofs.map((p) => p.type),
            providerMode: reservation.providerMode,
            eventProvenance,
            run,
            consent: entry?.consent ?? null,
          });
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
  if (!data) return <p aria-live="polite" className="working text-muted">Loading recovery run…</p>;
  const steps = buildScenarioSteps({
    eventId,
    eventProvenance: data.eventProvenance,
    run: data.run,
    consent: data.consent,
    paymentState: data.payment,
    proofTypes: data.proofTypes,
    providerMode: data.providerMode,
  });
  const checklist = <ScenarioChecklist steps={steps} />;
  const attributionLine = <p className="text-[14px] font-semibold">{attributionStatusText(attribution)}</p>;
  if (!data.run) {
    return (
      <div className="run-detail space-y-5 border-t border-line pt-5">
        {attributionLine}
        {checklist}
      </div>
    );
  }

  const run = data.run;
  const provenance = runProvenance(run);
  return (
    <div className="run-detail space-y-5 border-t border-line pt-5" aria-labelledby={`run-${run.runId}`}>
      {attributionLine}
      {checklist}
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`run-${run.runId}`} className="text-[17px] font-semibold">
          Run {run.runId.slice(-8)}
        </h3>
        <Badge tone={run.status === "NEEDS_APPROVAL" ? "warn" : run.status === "COMMITTED" || run.status === "APPROVED" ? "success" : "info"}>
          {RUN_STATUS_LABEL[run.status]}
        </Badge>
        <Badge tone="neutral">{provenance.decisionLabel}</Badge>
        <PaymentBadge state={data.payment} />
      </div>
      <p className="text-[14px]">{provenance.reason}</p>

      {run.explanation && (
        <div className="ai-answer space-y-1">
          <p className="meta">Reasoning summary · {run.explanation.source === "MODEL" ? "model text, checked against backend numbers" : "deterministic text"}</p>
          <p className="text-[15px]">{run.explanation.text}</p>
        </div>
      )}

      {run.outcome && <p className="text-[14px]">{run.outcome.reason}</p>}

      {run.proposal && (
        <dl className="proposal-card grid gap-2 rounded-[var(--r-card-sm)] border border-dashed p-3 text-[14px] sm:grid-cols-2">
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

      <details className="disclosure text-[14px]">
        <summary className="cursor-pointer font-semibold">Tool trace ({run.trace.length} entries)</summary>
        <ol className="mt-2 space-y-2">
          {run.trace.map((t) => (
            <li key={t.seq} className="step-row trace-row rounded-[var(--r-card-sm)] border border-line-2 p-2">
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
