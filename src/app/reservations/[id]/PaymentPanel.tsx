"use client";

import { PaymentBadge } from "@/components/ui";
import type { ReservationView } from "@/server/services/viewService";
import { amountLine, hasUnreconciledCapture, paymentCopyForView, settlementStep, type StepStatus } from "./paymentCopy";

const STEPS: { key: string; label: string; done: (r: ReservationView) => boolean }[] = [
  { key: "accepted", label: "Terms approved by you", done: () => true },
  { key: "order", label: "Payment order created", done: (r) => r.proofs.some((p) => p.type === "ORDER_CREATED") },
  { key: "buyer", label: "Buyer approval confirmed by provider", done: (r) => r.proofs.some((p) => p.type === "BUYER_APPROVED") },
  { key: "auth", label: "Amount authorized, not captured", done: (r) => r.proofs.some((p) => p.type === "AUTHORIZED") },
  { key: "service", label: "Synthetic overnight charging", done: (r) => r.simulation !== null },
];

const MARK: Record<StepStatus, { className: string; glyph: string; sr: string }> = {
  done: { className: "bg-teal text-white border-teal", glyph: "✓", sr: "done" },
  "in-progress": { className: "border-amber bg-surface", glyph: "", sr: "in progress, not final" },
  failed: { className: "bg-red text-white border-red", glyph: "!", sr: "failed" },
  "not-started": { className: "border-line-strong bg-surface", glyph: "", sr: "pending" },
};

const AMOUNT_TONE = { success: "text-teal-ink", info: "text-ink", warn: "text-[var(--amber-ink)]", danger: "text-red", neutral: "text-ink" } as const;

/** Payment is reported on its own: provider-confirmed state, verbatim customer copy and the six-step trail. */
export function PaymentPanel({ r }: { r: ReservationView }) {
  const copy = paymentCopyForView(r);
  const amount = amountLine(r);
  const steps = [...STEPS.map((s) => ({ key: s.key, label: s.label, status: (s.done(r) ? "done" : "not-started") as StepStatus })), { key: "settle", ...settlementStep(r) }];

  return (
    <section className="card p-5 sm:p-6 space-y-5 min-w-0" aria-labelledby="status-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="status-title" className="eyebrow text-ink">
          Payment
        </h2>
        <div className="badge-wrap">
          {/* A capture the local state does not reflect must not read as "not collected". */}
          <PaymentBadge state={hasUnreconciledCapture(r) ? "NEEDS_RECONCILIATION" : r.paymentState} capacityConfirmed={r.slotsCommitted} />
        </div>
      </div>

      <p className="flex flex-wrap items-baseline gap-x-2 tabular">
        <span className={`text-[clamp(44px,6vw,64px)] font-semibold leading-none tracking-[-0.03em] ${AMOUNT_TONE[amount.tone]}`}>{amount.amount}</span>
        <span className="text-[17px] text-muted">{amount.note}</span>
      </p>

      <div className={`rounded-[var(--r-card-sm)] p-4 tone-${copy.tone}`} aria-live="polite">
        <p className="font-semibold">{copy.title}</p>
        <p className="mt-1 text-[14px]">{r.serviceState === "FAILED" && r.paymentState === "VOIDED" && !hasUnreconciledCapture(r)
  ? r.simulation && !r.simulation.outageInjected && r.simulation.shortfallBatteryMilliWh > 0
    ? "Charging delivered less than the agreed energy (synthetic ledger), so the authorization was voided."
    : "Charging failed (synthetic charger outage), so the authorization was voided."
  : copy.body}</p>
      </div>

      <ol className="space-y-0" aria-label="Payment steps">
        {steps.map((s, i) => (
          <li key={s.key} className="relative flex gap-3 pb-4 last:pb-0">
            {i < steps.length - 1 && <span className="absolute left-[11px] top-6 bottom-0 w-px bg-line" aria-hidden="true" />}
            <span className={`relative z-[1] flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 text-[12px] font-bold ${MARK[s.status].className}`} aria-hidden="true">
              {s.status === "in-progress" ? <span className="h-2 w-2 rounded-full bg-amber" /> : MARK[s.status].glyph}
            </span>
            <span className={`pt-0.5 text-[14px] ${s.status === "not-started" ? "text-muted" : "text-ink"}`}>
              <span className="meta mr-2">{String(i + 1).padStart(2, "0")}</span>
              {s.label}
              <span className="sr-only"> ({MARK[s.status].sr})</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
