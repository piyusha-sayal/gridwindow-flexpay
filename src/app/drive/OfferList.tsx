"use client";

import type { DealEvaluation } from "@/domain/dealAgent";
import { meetsRequiredSaving, type PricedOffer, type QuoteSet } from "@/domain/quotes";
import { formatLocalTime } from "@/domain/time";
import { formatKWh, formatUsd, SLOT_MS } from "@/domain/units";
import { AxisTicks, PowerBars, quoteAxis, TariffStrip } from "./NightAxis";

const REJECTION_COPY: Record<string, string> = {
  NO_ENERGY_SAVINGS: "no cheaper window than charging immediately",
  DISCOUNT_BELOW_MINIMUM: "the saving is too small to share with you",
  OPERATOR_NOT_BETTER_OFF: "the operator would not be better off",
  EXCEEDS_SPEND_CAP: "the price would be above your spending cap",
  DUPLICATE_SCHEDULE: "same schedule as another offer",
  INSUFFICIENT_CAPACITY: "not enough port or station capacity before your departure",
  WINDOW_TOO_SHORT: "your parking window is too short for this variant",
  NO_COMPARABLE_FEASIBLE_BASELINE: "immediate charging is not feasible, so no saving can be claimed",
  PORT_OCCUPIED: "another vehicle is parked at this port during your window",
  OUTSIDE_HORIZON: "the window is outside tonight's schedule (18:00–10:00)",
};

export const VARIANT_NAME: Record<string, string> = { flex_lowest_cost: "Lowest-cost window", flex_early_finish: "Ready 1 hour early", flex_gentle: "Gentle half-power" };

export function reasonCopy(reason: string): string {
  const code = reason.split(":")[0]!.trim();
  return REJECTION_COPY[code] ?? reason;
}

/** Every offer sharing the lowest final price (more than one when prices tie). Every listed offer is already backend-validated. */
export function lowestPriceOfferIds(offers: readonly PricedOffer[]): ReadonlySet<string> {
  const min = Math.min(...offers.map((o) => o.priceCents));
  return new Set(offers.filter((o) => o.priceCents === min).map((o) => o.offerId));
}

/** What tells offers apart besides price: active charging time, highest power and when the battery is ready. */
export function offerTraits(offer: Pick<PricedOffer, "powerW" | "chargeEndMs">): { chargingSlots: number; maxPowerW: number; readyByMs: number } {
  return { chargingSlots: offer.powerW.filter((w) => w > 0).length, maxPowerW: Math.max(0, ...offer.powerW), readyByMs: offer.chargeEndMs };
}

export const hoursMinutes = (slots: number) => `${Math.floor(slots / 4)} h ${String((slots % 4) * 15).padStart(2, "0")} min`;

const COUNT_WORD = ["No", "One", "Two", "Three", "Four", "Five"];

/** Result headline stating the outcome; prices come from the quote, ties say "both"/"all". */
export function offersHeadline(offers: readonly Pick<PricedOffer, "priceCents" | "discountCents">[]): string {
  const n = offers.length;
  const count = COUNT_WORD[n] ?? String(n);
  if (n === 1) return `One flexible offer, ${formatUsd(offers[0]!.discountCents)} less than charging now.`;
  const prices = new Set(offers.map((o) => o.priceCents));
  const maxDiscount = Math.max(...offers.map((o) => o.discountCents));
  if (prices.size === 1) return `${count} flexible offers, ${n === 2 ? "both" : "all"} ${formatUsd(maxDiscount)} less than charging now.`;
  return `${count} flexible offers, from ${formatUsd(Math.min(...offers.map((o) => o.priceCents)))}, up to ${formatUsd(maxDiscount)} less than charging now.`;
}

const ROW = "grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 min-[760px]:grid-cols-[200px_1fr_60px_108px] min-[760px]:items-center";
const CELL_RESET = "min-[760px]:col-span-1 min-[760px]:col-start-auto min-[760px]:row-start-auto";

interface OfferListProps {
  quote: QuoteSet;
  tz: string;
  selected: string | null;
  recommendedKind: PricedOffer["kind"];
  /** Flex Deal Agent evaluation, when available: marks the recommendation and offers that miss the goals. */
  deal?: DealEvaluation | null;
  /** Advisory minimum saving (not confirmed as required): offers below it stay selectable, flagged. */
  preferredMinSavingsCents?: number | null;
  expired: boolean;
  onSelect: (id: string) => void;
}

/** Baseline and every offer on one shared night axis: a table at ≥760px, stacked cards below. */
export function OfferList({ quote, tz, selected, recommendedKind, deal = null, preferredMinSavingsCents = null, expired, onSelect }: OfferListProps) {
  const axis = quoteAxis(quote.grid, tz);
  const slotOf = (ms: number) => Math.round((ms - quote.grid.startMs) / SLOT_MS);
  const parked = { from: slotOf(quote.request.plugInMs), to: slotOf(quote.request.departMs) };
  const maxW = quote.capacity.portMaxPowerW;
  const b = quote.baseline;
  const lowest = quote.offers.length > 1 ? lowestPriceOfferIds(quote.offers) : new Set<string>();

  return (
    <div className={`space-y-3 min-[760px]:space-y-0 min-[760px]:rounded-[var(--r-panel)] min-[760px]:border min-[760px]:border-line min-[760px]:bg-surface min-[760px]:overflow-hidden transition-opacity ${expired ? "opacity-45" : ""}`}>
      <div className={`${ROW} px-1 min-[760px]:px-5 min-[760px]:py-3`}>
        <span className="hidden min-[760px]:block meta">Option</span>
        <div className="col-span-2 min-[760px]:col-span-1 space-y-1.5">
          <TariffStrip axis={axis} className="h-5" />
          <AxisTicks axis={axis} />
        </div>
        <span className="hidden min-[760px]:block meta">Ready</span>
        <span className="hidden min-[760px]:block meta text-right">Price</span>
      </div>

      <div className={`${ROW} rounded-[var(--r-card-sm)] border border-line bg-surface px-4 py-4 min-[760px]:rounded-none min-[760px]:border-0 min-[760px]:border-t min-[760px]:bg-paper/50 min-[760px]:px-5`}>
        <div className="min-w-0">
          <p className="text-[16px] font-semibold">Charge now</p>
          <p className="meta">Comparison only · not bookable</p>
        </div>
        {b.feasible ? (
          <>
            <PowerBars powerW={b.powerW ?? []} maxW={maxW} color="var(--chart-baseline)" parked={parked} className={`h-9 col-span-2 ${CELL_RESET}`} />
            <span className={`col-span-2 font-mono text-[13px] text-muted ${CELL_RESET}`}>
              <span className="min-[760px]:hidden">Ready </span>
              {formatLocalTime(b.chargeEndMs!, tz)}
            </span>
            <span className={`col-start-2 row-start-1 text-right tabular ${CELL_RESET}`}>
              <span className="block text-[22px] font-semibold text-muted">{formatUsd(b.listPriceCents)}</span>
              <span className="block text-[13px] text-muted">list price{!b.withinSpendCap && " · above your cap"}</span>
            </span>
          </>
        ) : (
          <p className="col-span-2 min-[760px]:col-span-3 text-[14px] text-warn">Not feasible: {reasonCopy(b.reason ?? "")}.</p>
        )}
      </div>

      {quote.offers.length > 0 && (
        <fieldset className="min-w-0 space-y-3 min-[760px]:space-y-0" disabled={expired}>
          <legend className="sr-only">Choose a flexible offer</legend>
          {quote.offers.map((o) => {
            const on = selected === o.offerId;
            // Below a required minimum (stored with the quote, enforced at accept): cannot be chosen, agent or not.
            const blocked = !meetsRequiredSaving(quote, o);
            // Below a preference only: stays choosable, with the shortfall visible.
            const belowPreference = !blocked && preferredMinSavingsCents !== null && o.discountCents < preferredMinSavingsCents;
            const pct = Math.round((o.discountCents / o.listPriceCents) * 100);
            const t = offerTraits(o);
            return (
              <label
                key={o.offerId}
                className={`${ROW} cursor-pointer rounded-[var(--r-card-sm)] border bg-surface px-4 py-4 transition-[background,box-shadow] min-[760px]:rounded-none min-[760px]:border-0 min-[760px]:border-t min-[760px]:border-line min-[760px]:px-5 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-teal-ink ${on ? "border-ink shadow-[inset_0_0_0_1px_var(--ink)] min-[760px]:bg-teal-tint min-[760px]:shadow-[inset_0_0_0_1.5px_var(--ink)]" : "border-line hover:bg-paper/60"}`}
              >
                <span className="flex min-w-0 items-start gap-3">
                  <input id={`offer-${o.kind}`} type="radio" name="offer" className="mt-1 h-4 w-4 shrink-0 accent-[var(--ink)]" checked={on} disabled={blocked} onChange={() => onSelect(o.offerId)} />
                  <span className="min-w-0 space-y-1.5">
                    <span className="block text-[16px] font-semibold">{o.label}</span>
                    <span className="flex flex-wrap gap-1.5 badge-wrap">
                      {lowest.size === 1 && lowest.has(o.offerId) && <span className="badge no-dot tone-success">Lowest price of {quote.offers.length} offers</span>}
                      {lowest.size > 1 && lowest.has(o.offerId) && (
                        <span className="badge no-dot tone-success">
                          Tied lowest price ({lowest.size} of {quote.offers.length} offers)
                        </span>
                      )}
                      {deal?.recommendedOfferId === o.offerId && <span className="badge no-dot tone-success">Agent recommends</span>}
                      {blocked && <span className="badge no-dot tone-warn">Below your required {formatUsd(quote.requiredMinSavingsCents!)} saving · change requirements to choose</span>}
                      {belowPreference && <span className="badge no-dot tone-warn">Below your preferred {formatUsd(preferredMinSavingsCents!)} saving</span>}
                      {o.kind === recommendedKind && <span className="badge no-dot tone-info">Your preference</span>}
                      {o.kind === "flex_gentle" && <span className="badge no-dot tone-neutral">{t.maxPowerW / 1000} kW · easier on the site</span>}
                    </span>
                  </span>
                </span>
                <PowerBars powerW={o.powerW} maxW={maxW} color="var(--teal)" parked={parked} className={`h-9 col-span-2 ${CELL_RESET}`} />
                <span className={`col-span-2 font-mono text-[13px] ${CELL_RESET}`}>
                  <span className="min-[760px]:hidden text-muted">Charges {formatLocalTime(o.chargeStartMs, tz)}–{formatLocalTime(o.chargeEndMs, tz)} · ready </span>
                  {formatLocalTime(t.readyByMs, tz)}
                </span>
                <span className={`col-start-2 row-start-1 text-right tabular ${CELL_RESET}`}>
                  <span className="block text-[26px] font-semibold leading-tight tracking-[-0.02em]">{formatUsd(o.priceCents)}</span>
                  <span className="block text-[13px] font-medium text-teal-ink">
                    save {formatUsd(o.discountCents)} · {pct}%
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
      )}

      {quote.rejected.length > 0 && (
        <div className="rounded-[var(--r-card-sm)] border border-line bg-surface px-4 py-4 min-[760px]:rounded-none min-[760px]:border-0 min-[760px]:border-t min-[760px]:px-5">
          <h2 className="meta mb-2">Not offered ({quote.rejected.length})</h2>
          <ul className="space-y-1 text-[14px] text-muted">
            {quote.rejected.map((r) => (
              <li key={r.kind}>
                <span className="text-text-2">{VARIANT_NAME[r.kind] ?? r.kind}</span>: {reasonCopy(r.reason)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="flex flex-wrap gap-x-5 gap-y-1 px-1 py-3 meta min-[760px]:border-t min-[760px]:border-line min-[760px]:px-5">
        <span>▒ Plugged in</span>
        <span>┆ You leave</span>
        <span>▮ Charging · bar height = power</span>
        <span>{formatKWh(quote.request.targetBatteryWh)} to battery</span>
      </p>
    </div>
  );
}
