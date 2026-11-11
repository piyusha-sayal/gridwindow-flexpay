"use client";

import { AiSourceBadge } from "@/components/ui";
import type { DealEvaluation } from "@/domain/dealAgent";
import { formatLocalTime } from "@/domain/time";
import { formatUsd } from "@/domain/units";
import type { DealState } from "./driverTypes";

const HEADLINE: Record<DealEvaluation["status"], string> = {
  RECOMMENDED: "Recommended for your goals",
  NO_QUALIFYING_OFFER: "No offer meets your goals",
  NO_OFFERS: "No flexible offer available",
  INFEASIBLE: "Not deliverable in this window",
  EXPIRED: "Quote expired",
};

interface DealAgentPanelProps {
  deal: DealState;
  tz: string;
  expired: boolean;
  onRun: () => void;
  onEdit: () => void;
}

/**
 * Flex Deal Agent summary on the offers step. Every figure comes from the backend evaluation; the
 * panel never accepts, approves or pays — choosing and approving stay with the driver.
 */
export function DealAgentPanel({ deal, tz, expired, onRun, onEdit }: DealAgentPanelProps) {
  return (
    <section aria-labelledby="deal-agent-title" className="card agent-panel space-y-3 p-5" aria-busy={deal.status === "loading"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="deal-agent-title" className="meta agent-title">
          <span aria-hidden="true" className="ico ico-spark" />
          Flex Deal Agent
        </h2>
        {deal.status === "done" && (
          <div className="badge-wrap">
            <AiSourceBadge src={deal.data} />
          </div>
        )}
      </div>
      <div aria-live="polite" className="space-y-3">
        {deal.status === "idle" && (
          <button type="button" className="btn btn-sm" onClick={onRun} disabled={expired}>
            Check offers against my goals
          </button>
        )}
        {deal.status === "loading" && <p className="working text-muted">Checking every validated offer against your goals…</p>}
        {deal.status === "error" && (
          <p role="alert" className="text-red">
            {deal.message}{" "}
            <button type="button" className="underline" onClick={onRun}>
              Retry
            </button>
          </p>
        )}
        {deal.status === "done" && <DealResultView evaluation={deal.data.evaluation} summary={deal.data.summary} points={deal.data.points} tz={tz} expired={expired} onEdit={onEdit} />}
      </div>
    </section>
  );
}

function DealResultView({ evaluation: e, summary, points, tz, expired, onEdit }: { evaluation: DealEvaluation; summary: string; points: string[]; tz: string; expired: boolean; onEdit: () => void }) {
  const status = expired ? "EXPIRED" : e.status;
  const rec = e.candidates.find((c) => c.offerId === e.recommendedOfferId);
  return (
    <>
      <p className="agent-headline text-[17px] font-semibold">{HEADLINE[status]}</p>
      {rec && !expired && (
        <dl className="agent-rec grid grid-cols-[repeat(auto-fit,minmax(min(130px,100%),1fr))] gap-3 p-3 text-[14px] tabular">
          {[
            ["Offer", rec.label],
            ["Price", formatUsd(rec.priceCents)],
            ["Validated saving", formatUsd(rec.discountCents)],
            ["Charges", `${formatLocalTime(rec.chargeStartMs, tz)}–${formatLocalTime(rec.chargeEndMs, tz)}`],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="meta">{k}</dt>
              <dd className="font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <p>{expired && e.status !== "EXPIRED" ? "These prices expired, so this recommendation no longer applies. Refresh offers to check again." : summary}</p>
      {!expired && points.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-[14px] text-text-2">
          {points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <p className="meta">
        Goals: {e.goals.minSavingsCents === null ? "any saving" : `save at least ${formatUsd(e.goals.minSavingsCents)}${e.savingMandatory ? " (required)" : " (preferred)"}`} · budget {formatUsd(e.spendCapCents)} · {e.rankingPolicy}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-sm" onClick={onEdit}>
          Change requirements
        </button>
        <span className="meta">The agent only recommends. Nothing is booked or paid until you review and approve.</span>
      </div>
    </>
  );
}
