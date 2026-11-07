"use client";

import Link from "next/link";
import type { PricedOffer, QuoteSet } from "@/domain/quotes";
import { formatLocalTime } from "@/domain/time";
import { formatKWh } from "@/domain/units";
import { AiExplain } from "./AiExplain";
import { DealAgentPanel } from "./DealAgentPanel";
import type { DealState } from "./driverTypes";
import { hoursMinutes, OfferList, offersHeadline, offerTraits } from "./OfferList";

/** Countdown from quote.expiresAtMs: amber under two minutes, red once expired. */
export function ExpiryChip({ secondsLeft, label = "Prices held" }: { secondsLeft: number; label?: string }) {
  const expired = secondsLeft === 0;
  const tone = expired ? "tone-danger" : secondsLeft < 120 ? "tone-warn" : "tone-neutral";
  return (
    <span className={`badge ${tone}`}>
      <span aria-live="off">{expired ? "Offer expired" : `${label} ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`}</span>
    </span>
  );
}

interface OffersStepProps {
  quote: QuoteSet;
  tz: string;
  selected: string | null;
  offer: PricedOffer | null;
  recommendedKind: PricedOffer["kind"];
  deal: DealState;
  preferredMinSavingsCents: number | null;
  onRunDeal: () => void;
  secondsLeft: number;
  refreshing: boolean;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onEdit: () => void;
}

/** Step 2: the result headline, the shared-axis comparison and why the selected offer is cheaper. */
export function OffersStep({ quote, tz, selected, offer, recommendedKind, deal, preferredMinSavingsCents, onRunDeal, secondsLeft, refreshing, onSelect, onRefresh, onEdit }: OffersStepProps) {
  const expired = secondsLeft === 0;
  const none = quote.offers.length === 0;
  const traits = offer ? offerTraits(offer) : null;

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <p className="meta">
          {formatKWh(quote.request.targetBatteryWh)} to battery · parked {formatLocalTime(quote.request.plugInMs, tz)}–{formatLocalTime(quote.request.departMs, tz)}
        </p>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 id="offers-title" tabIndex={-1} className="max-w-[22ch] font-semibold tracking-[-0.03em] leading-[1.08] text-[clamp(28px,3.6vw,40px)]">
            {none ? (quote.baseline.feasible ? "No flexible offer is available for this request." : "This request cannot be met before your departure.") : offersHeadline(quote.offers)}
          </h1>
          {!none && (
            <div className="flex flex-wrap gap-2 badge-wrap">
              <span className="badge tone-success">Feasible · validated</span>
              <ExpiryChip secondsLeft={secondsLeft} />
            </div>
          )}
        </div>
      </header>

      {expired && !none && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--r-card-sm)] border border-[var(--red-line)] bg-danger-soft px-4 py-3 text-[var(--red-ink)]">
          <p className="text-[14px]">These prices expired. Prices and capacity can change, so request fresh offers.</p>
          <button type="button" className="btn btn-sm" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh offers"}
          </button>
        </div>
      )}

      {none && <NoOffers quote={quote} onEdit={onEdit} />}

      <DealAgentPanel deal={deal} tz={tz} expired={expired} onRun={onRunDeal} onEdit={onEdit} />

      <OfferList quote={quote} tz={tz} selected={selected} recommendedKind={recommendedKind} deal={deal.status === "done" && !expired ? deal.data.evaluation : null} preferredMinSavingsCents={preferredMinSavingsCents} expired={expired} onSelect={onSelect} />

      {offer && traits && (
        <section aria-label={`${offer.label} at a glance`} className="space-y-4">
          <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-[var(--r-card-sm)] border border-line bg-line text-[15px] tabular">
            {[
              ["Charging time", hoursMinutes(traits.chargingSlots)],
              ["Max power", `${(traits.maxPowerW / 1000).toFixed(1)} kW`],
              ["To your battery", formatKWh(Math.floor(offer.batteryMilliWh / 1000))],
            ].map(([k, v]) => (
              <div key={k} className="min-w-0 bg-surface px-3 py-3 sm:px-4">
                <dt className="meta">{k}</dt>
                <dd className="mt-1 font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <AiExplain key={offer.offerId} quoteSetId={quote.quoteSetId} offerId={offer.offerId} />
        </section>
      )}

      <p className="text-[13px] text-muted">
        All prices, tariffs and costs are synthetic modeled assumptions, not real fees or measured savings. Assumptions: {quote.assumptions.tariff}; {quote.assumptions.economics}; {quote.assumptions.forecast}. Provenance:{" "}
        {quote.assumptions.provenance}. Port limit: {quote.capacity.portMaxPowerW / 1000} kW; efficiency 92 % assumed.
      </p>
    </div>
  );
}

function NoOffers({ quote, onEdit }: { quote: QuoteSet; onEdit: () => void }) {
  const cap = quote.capacity;
  const physicallyImpossible = cap.maxBatteryWh < cap.requiredBatteryWh;
  return (
    <div className="space-y-4" role="status">
      {physicallyImpossible ? (
        <p className="text-text-2">
          You asked for {formatKWh(cap.requiredBatteryWh)}, but parked for {hoursMinutes(cap.parkedSlots)} on a {cap.portMaxPowerW / 1000} kW port at most {formatKWh(cap.maxBatteryWh)} can reach the
          battery, even before sharing the site&apos;s capacity with other drivers. Leave later, plug in earlier, or ask for less energy.
        </p>
      ) : !quote.baseline.feasible ? (
        <p className="text-text-2">The port and site capacity left after other drivers&apos; commitments cannot deliver this energy in time.</p>
      ) : (
        <p className="text-text-2">We only offer flexibility when it is physically feasible and both you and the operator are better off. The reason for each option is listed below.</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" onClick={onEdit}>
          Change ready-by time
        </button>
        <Link href="/" className="btn">
          Back to home
        </Link>
        <span className="meta">No payment has been requested.</span>
      </div>
    </div>
  );
}
