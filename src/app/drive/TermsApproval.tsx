"use client";

import { Alert } from "@/components/ui";
import type { PricedOffer, QuoteSet } from "@/domain/quotes";
import { formatLocalTime } from "@/domain/time";
import { formatKWh, formatUsd } from "@/domain/units";
import type { DriverConfig } from "./driverTypes";
import { ExpiryChip } from "./OffersStep";

interface TermsApprovalProps {
  config: DriverConfig;
  quote: QuoteSet;
  offer: PricedOffer;
  /** Advisory minimum saving the driver did not confirm as required. */
  preferredMinSavingsCents: number | null;
  secondsLeft: number;
  consent: boolean;
  busy: boolean;
  onConsent: (v: boolean) => void;
  onApprove: () => void;
  onBack: () => void;
}

/** The exact, immutable terms the driver approves. Every value comes from the stored server quote. */
export function TermsApproval({ config, quote, offer, preferredMinSavingsCents, secondsLeft, consent, busy, onConsent, onApprove, onBack }: TermsApprovalProps) {
  const tz = config.station.timeZone;
  const port = config.station.ports.find((p) => p.id === offer.terms.portId)?.label;
  const mock = config.providerMode !== "PAYPAL_SANDBOX";
  const providerName = mock ? "the MOCK provider (not PayPal)" : "PayPal Sandbox";
  const expired = secondsLeft === 0;
  const chargeWindow = `${formatLocalTime(offer.chargeStartMs, tz)}–${formatLocalTime(offer.chargeEndMs, tz)}`;
  const terms: [string, string][] = [
    ["Energy to battery", `At least ${formatKWh(quote.request.targetBatteryWh)}`],
    ["Charging schedule", `${chargeWindow}, done before ${formatLocalTime(quote.request.departMs, tz)}`],
    ["Port", `Port ${port} (parked ${formatLocalTime(quote.request.plugInMs, tz)}–${formatLocalTime(quote.request.departMs, tz)})`],
    ["Merchant", config.station.name],
  ];
  const flow: { when: string; what: string; rule: string }[] = [
    { when: "Now", what: "Authorize. The amount is held, not collected.", rule: "border-amber" },
    { when: chargeWindow, what: "Charge. Your car stays plugged in.", rule: "border-amber" },
    { when: "After delivery", what: "Capture if delivered, otherwise void.", rule: "border-teal" },
  ];

  return (
    <section className="space-y-6" aria-labelledby="approve-title">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <h1 id="approve-title" tabIndex={-1} className="font-semibold tracking-[-0.03em] leading-[1.08] text-[clamp(28px,3.6vw,40px)]">
          Approve these exact terms
        </h1>
        <div className="flex flex-wrap gap-2 badge-wrap">
          {mock ? <span className="badge tone-warn">MOCK payment · simulated</span> : <span className="badge tone-info">PayPal Sandbox · test money</span>}
          <ExpiryChip secondsLeft={secondsLeft} label="Expires in" />
        </div>
      </header>

      <div className="card overflow-hidden p-0">
        <div className="flex flex-wrap items-end justify-between gap-6 p-[clamp(20px,3vw,32px)]">
          <div>
            <p className="meta">Amount to authorize</p>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="font-semibold tracking-[-0.04em] leading-none tabular text-[clamp(52px,7vw,72px)]">{formatUsd(offer.priceCents)}</span>
              <span className="font-mono text-[13px] text-muted">USD</span>
            </p>
            <p className="mt-2 text-[14px] text-text-2">Held now. Collected only after the energy is delivered.</p>
          </div>
          <dl className="space-y-1 text-[15px] tabular text-right">
            <div className="flex justify-end gap-3">
              <dt className="text-muted">Standard price</dt>
              <dd>
                <s>{formatUsd(offer.listPriceCents)}</s>
              </dd>
            </div>
            <div className="flex justify-end gap-3 text-teal-ink font-medium">
              <dt>Your discount</dt>
              <dd>−{formatUsd(offer.discountCents)}</dd>
            </div>
          </dl>
        </div>
        <dl className="grid border-t border-line-2 min-[600px]:grid-cols-2">
          {terms.map(([k, v]) => (
            <div key={k} className="border-b border-line-2 px-[clamp(20px,3vw,32px)] py-4 min-[600px]:odd:border-r">
              <dt className="text-[13px] text-muted">{k}</dt>
              <dd className="mt-1 text-[16px] font-medium tabular">
                {v}
                {k === "Merchant" && <span className="mt-0.5 block font-mono text-[12px] font-normal text-muted">REF {offer.terms.merchantRef}</span>}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <section aria-labelledby="how-pay" className="space-y-3">
        <h2 id="how-pay" className="meta">
          How the payment works
        </h2>
        <ol className="grid gap-4 min-[600px]:grid-cols-3">
          {flow.map((f) => (
            <li key={f.when} className={`border-t-2 pt-3 ${f.rule}`}>
              <p className="font-mono text-[12px] text-ink">{f.when}</p>
              <p className="mt-1 text-[14px] text-text-2">{f.what}</p>
            </li>
          ))}
        </ol>
      </section>

      <details className="text-[14px]">
        <summary className="cursor-pointer text-text-2">Terms fingerprint</summary>
        <p className="mt-2 font-mono text-[12px] text-muted break-all">SHA-256 {offer.termsHash}</p>
        <p className="mt-1 text-muted">A fingerprint of these exact terms. The server rejects the approval if anything differs from the stored offer.</p>
      </details>

      {preferredMinSavingsCents !== null && offer.discountCents < preferredMinSavingsCents && (
        <Alert tone="warn" title="Below your preferred saving">
          This offer saves {formatUsd(offer.discountCents)}, less than the {formatUsd(preferredMinSavingsCents)} you preferred. That saving was a preference, not a requirement, so you can still approve it.
        </Alert>
      )}

      <label className={`flex items-start gap-3 rounded-[var(--r-card-sm)] border p-4 transition-colors cursor-pointer ${consent ? "border-ink bg-teal-tint" : "border-line-strong bg-surface"}`}>
        <input id="consent" type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[var(--ink)]" checked={consent} onChange={(e) => onConsent(e.target.checked)} disabled={expired} />
        <span className="text-[15px]">
          I approve <strong>{formatUsd(offer.priceCents)}</strong> for at least {formatKWh(quote.request.targetBatteryWh)} delivered to my battery on port {port} before{" "}
          {formatLocalTime(quote.request.departMs, tz)}. {providerName} will
          <strong> authorize</strong> this amount now; it is <strong>captured only if the energy is delivered</strong>, otherwise the authorization is voided.
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-4">
        <button type="button" className="btn btn-primary btn-lg" onClick={onApprove} disabled={!consent || busy || expired}>
          {busy ? "Starting checkout…" : `Approve ${formatUsd(offer.priceCents)} with ${mock ? "mock provider" : "PayPal Sandbox"}`}
        </button>
        <button type="button" className="btn btn-text" onClick={onBack}>
          Back to offers
        </button>
      </div>
      {expired && <p className="text-[14px] text-red">This offer expired. Prices and capacity can change — request fresh offers.</p>}
    </section>
  );
}
