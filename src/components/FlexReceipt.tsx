import { useEffect, useRef, type ReactNode } from "react";
import { economicOutcome } from "@/domain/paymentState";
import { formatLocalTime } from "@/domain/time";
import { formatKWh, formatUsd } from "@/domain/units";
import type { ReservationView } from "@/server/services/viewService";
import { Badge } from "./ui";

/** Settlement line shown at the top of the receipt; only a provider-confirmed capture reads as paid. */
export function settlement(r: Pick<ReservationView, "paymentState" | "proofs" | "economics">): { tone: "success" | "neutral" | "warn" | "danger"; text: string } {
  const capture = r.proofs.find((p) => p.type === "CAPTURED");
  // A recorded provider capture the local state does not reflect is never shown as "not charged".
  if (capture && r.paymentState !== "CAPTURED")
    return { tone: "warn", text: `Provider recorded a capture of ${formatUsd(capture.amountCents ?? r.economics.priceCents)}; payment status is being reconciled — not final` };
  if (r.paymentState === "CAPTURED" && capture) return { tone: "success", text: `Paid ${formatUsd(capture.amountCents ?? r.economics.priceCents)} — capture confirmed by provider` };
  if (r.paymentState === "VOIDED") return { tone: "neutral", text: "Not charged — authorization voided by provider (bank hold removal may take time)" };
  if (r.paymentState === "CAPTURE_PENDING") return { tone: "warn", text: "Capture pending — not final; the provider has not confirmed the payment" };
  if (r.paymentState === "CAPTURE_DECLINED") return { tone: "danger", text: "Capture declined — no payment collected" };
  return { tone: "warn", text: `Settlement incomplete (${r.paymentState})` };
}

/** Short customer-facing receipt number derived from the reservation id (not a provider reference). */
export function receiptNumber(id: string): string {
  return `FR-${id.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`;
}

/** Latest provider observation, else the latest event: when this receipt's status was established. */
function issuedAt(r: ReservationView): string {
  const times = [...r.proofs.map((p) => p.observedAt), ...r.events.map((e) => e.occurredAt)].map((t) => new Date(t).getTime());
  return times.length ? new Date(Math.max(...times)).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—";
}

/** The money line: only a provider-confirmed capture is shown as an amount paid. */
export function totalLine(r: Pick<ReservationView, "paymentState" | "proofs" | "economics">): { label: string; value: string } {
  const capture = r.proofs.find((p) => p.type === "CAPTURED");
  if (capture && r.paymentState !== "CAPTURED") return { label: "Payment under review", value: `${formatUsd(capture.amountCents ?? r.economics.priceCents)} USD captured by provider · reconciling, not final` };
  if (r.paymentState === "CAPTURED" && capture) return { label: "Total paid", value: `${formatUsd(capture.amountCents ?? r.economics.priceCents)} USD` };
  if (r.paymentState === "CAPTURE_PENDING") return { label: "Capture pending", value: `${formatUsd(r.economics.priceCents)} USD authorized · not final, not yet paid` };
  return { label: "Total paid", value: "$0.00 USD (not collected)" };
}

/** Operator economics line: projected until the provider confirms capture, never shown as realized otherwise. */
export function contributionLine(r: ReservationView): string {
  const amount = `+${formatUsd(r.economics.operatorImprovementCents)}`;
  switch (economicOutcome(r.paymentState)) {
    case "REALIZED":
      return `operator modeled contribution ${amount} (payment captured)`;
    case "NOT_REALIZED":
      return `operator contribution not realized (${r.paymentState}); ${amount} was projected if the offer succeeded`;
    default:
      return `operator contribution projected ${amount}, not realized until the provider confirms capture`;
  }
}

/** Running footer on every printed page (receipt numbers are [A-Z0-9-] only, so safe inside a CSS string). */
export function printPageStyle(receiptNo: string): string {
  return `@media print { @page { margin: 14mm 12mm 16mm; @bottom-left { content: "GridWindow FlexReceipt ${receiptNo}"; font-size: 8pt; color: #555; } @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 8pt; color: #555; } } }`;
}

/** Opens every collapsed section while printing so the paper receipt is complete, then restores them. */
function usePrintExpanded() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    let closed: HTMLDetailsElement[] = [];
    // Accumulate: a second beforeprint (e.g. nested print requests) must not forget sections opened by the first.
    const before = () => {
      const now = [...(ref.current?.querySelectorAll<HTMLDetailsElement>("details:not([open])") ?? [])];
      now.forEach((d) => (d.open = true));
      closed = [...closed, ...now];
    };
    const after = () => {
      closed.forEach((d) => (d.open = false));
      closed = [];
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
  return ref;
}

function deliveredLine(r: ReservationView): string {
  const sim = r.simulation;
  if (!sim) return "Not delivered (no charging run)";
  const kwh = formatKWh(Math.floor(sim.deliveredBatteryMilliWh / 1000));
  return sim.outcome === "DELIVERED" ? `${kwh} (simulated)` : `${kwh}, charging failed (simulated)`;
}

const SETTLEMENT_TONE = { success: "text-teal-ink", neutral: "text-ink", warn: "text-[var(--amber-ink)]", danger: "text-red" } as const;

/** Joins approved terms, synthetic delivery evidence and provider-confirmed payment state. */
export function FlexReceipt({ r }: { r: ReservationView }) {
  const sim = r.simulation;
  const verifiedLabel = r.providerMode === "PAYPAL_SANDBOX" ? "PayPal Sandbox API" : "MOCK provider (not PayPal)";
  const status = settlement(r);
  const total = totalLine(r);
  const ref = usePrintExpanded();
  return (
    <section
      ref={ref}
      className="print-receipt mx-auto w-full max-w-[780px] overflow-hidden rounded-[4px] border border-line bg-surface shadow-[var(--shadow-receipt)]"
      aria-labelledby="receipt-title"
    >
      <style>{printPageStyle(receiptNumber(r.id))}</style>
      <div className="h-1.5 bg-ink" aria-hidden="true" />
      <div className="space-y-7 p-5 sm:p-9">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="space-y-2">
            <p className="flex items-center gap-2.5 font-mono text-[11px] tracking-[0.12em] text-muted">
              <span aria-hidden="true" className="logo-grid">
                <span />
                <span />
                <span />
                <span />
              </span>
              GRIDWINDOW FLEXPAY
            </p>
            <h2 id="receipt-title" className="text-[32px] font-semibold tracking-[-0.02em] leading-tight">
              FlexReceipt
            </h2>
            <div className="flex flex-wrap gap-2 badge-wrap">
              {r.providerMode === "MOCK" ? <Badge tone="warn">MOCK — simulated payment, not PayPal</Badge> : <Badge tone="info">PayPal Sandbox — test money</Badge>}
              <Badge tone="neutral">SYNTHETIC charging</Badge>
            </div>
          </div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <button type="button" className="btn btn-sm no-print" onClick={() => window.print()}>
              Print receipt
            </button>
            <dl className="font-mono text-[11px] tracking-[0.06em] tabular space-y-0.5 sm:text-right">
              <div className="flex gap-2 sm:justify-end">
                <dt className="text-muted">RECEIPT NO.</dt>
                <dd>{receiptNumber(r.id)}</dd>
              </div>
              <div className="flex gap-2 sm:justify-end">
                <dt className="text-muted">ISSUED</dt>
                <dd>{issuedAt(r)}</dd>
              </div>
            </dl>
          </div>
        </div>

        <p className={`text-[15px] font-semibold ${SETTLEMENT_TONE[status.tone]}`}>{status.text}</p>

        <dl className="tabular" aria-label="Receipt summary">
          <div className="receipt-total flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-3">
            <dt className="text-[15px] font-semibold">{total.label}</dt>
            <dd className="text-right text-[clamp(28px,4.4vw,48px)] font-semibold leading-tight tracking-[-0.02em] [overflow-wrap:anywhere]">{total.value}</dd>
          </div>
          <Row k="Energy delivered" v={deliveredLine(r)} />
          <Row k="Charging schedule" v={`Port ${r.portLabel} · ${formatLocalTime(r.plugInMs, r.timeZone)}–${formatLocalTime(r.departMs, r.timeZone)}`} />
          <Row k="Merchant" v={r.merchantName} />
          <Row k="Payment provider" v={verifiedLabel} />
          <Row k="Reservation ref" v={r.id} />
        </dl>

        <div className="border-t border-line">
          <Section title="Amount and approved terms">
            <dl className="tabular">
              <Row k="Standard price (immediate charging)" v={formatUsd(r.economics.listPriceCents)} />
              <Row k="Flexible-charging discount" v={`−${formatUsd(r.economics.discountCents)}`} />
              <Row k="Approved amount" v={`${formatUsd(r.economics.priceCents)} USD`} />
              <Row k="Energy target" v={`${formatKWh(r.targetBatteryWh)} to battery`} />
              <Row k="Assumed efficiency" v={`${r.efficiencyBp / 100}%`} />
              <Row k="Terms SHA-256" v={r.termsHash} mono />
            </dl>
          </Section>
          <Section title="Delivery details (SYNTHETIC simulation)">
            {sim ? (
              <dl className="tabular">
                <Row k="Outcome" v={sim.outcome} />
                <Row k="Delivered to battery" v={formatKWh(Math.floor(sim.deliveredBatteryMilliWh / 1000))} />
                <Row k="Target" v={formatKWh(Math.floor(sim.targetBatteryMilliWh / 1000))} />
                <Row k="Energy records" v={`${sim.records.length} × 15 min, source SYNTHETIC`} />
                <Row k="Triggered by" v={sim.triggeredBy} />
              </dl>
            ) : (
              <p className="text-[14px] text-muted">No delivery run (authorization voided before charging).</p>
            )}
          </Section>
          <Section title="Payment evidence">
            <ul className="space-y-3 text-[14px]">
              {r.proofs.map((p) => (
                <li key={p.type} className="tabular [overflow-wrap:anywhere]">
                  <span className="font-semibold">{p.type}</span> · status {p.providerStatus}
                  {p.amountCents !== null && ` · ${formatUsd(p.amountCents)}`}
                  <br />
                  <span className="font-mono text-[11px] text-muted">
                    ref {p.ref} · {p.evidenceSource === "PAYPAL_SANDBOX_API" ? "PayPal Sandbox API" : "MOCK provider"} · {new Date(p.observedAt).toISOString()}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[13px] text-muted">Statuses above were read back from the {verifiedLabel}, not inferred by this app.</p>
          </Section>
          <Section title="Discount math (modeled)">
            <ul className="list-disc space-y-1 pl-5 text-[14px] tabular">
              <li>
                Modeled energy cost: immediate {r.economics.baselineEnergyCostCents !== null ? formatUsd(r.economics.baselineEnergyCostCents) : "n/a"} → flexible{" "}
                {formatUsd(r.economics.energyCostCents)}
              </li>
              <li>
                Driver discount {formatUsd(r.economics.discountCents)}; {contributionLine(r)}
              </li>
              <li className="text-muted">
                {r.economics.tariffLabel}; {r.economics.economicsLabel}; {r.economics.forecastLabel}
              </li>
            </ul>
          </Section>
          <Section title={`Event trail (${r.events.length})`}>
            <ol className="space-y-0.5 font-mono text-[11px] text-muted tabular [overflow-wrap:anywhere]">
              {r.events.map((e, i) => (
                <li key={i}>
                  {new Date(e.occurredAt).toISOString()} · {e.source} · {e.type}
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <div className="space-y-1 text-[13px] text-muted">
          <p className="font-semibold text-text-2">Limitations</p>
          <p>
            Charging and building load are a synthetic simulation; no vehicle or charger was involved. Tariffs, fees and costs are assumptions, so savings are modeled, not
            measured. {r.providerMode === "PAYPAL_SANDBOX" ? "PayPal Sandbox uses test money only." : "MOCK mode made no PayPal calls; these references are not PayPal transactions."}
          </p>
        </div>
      </div>
    </section>
  );
}

function Row({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 border-b border-line-2 py-2.5 text-[14px] last:border-b-0">
      <dt className="text-muted">{k}</dt>
      <dd className={`min-w-0 text-right [overflow-wrap:anywhere] ${mono ? "font-mono text-[12px]" : ""}`}>{v}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="receipt-section group border-b border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3.5 text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <span aria-hidden="true" className="font-mono text-[18px] font-normal text-muted group-open:hidden">
          +
        </span>
        <span aria-hidden="true" className="hidden font-mono text-[18px] font-normal text-muted group-open:inline">
          −
        </span>
      </summary>
      <div className="pb-4">{children}</div>
    </details>
  );
}
