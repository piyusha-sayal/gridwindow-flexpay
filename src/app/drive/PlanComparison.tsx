import type { PricedOffer, QuoteSet } from "@/domain/quotes";
import { formatLocalTime } from "@/domain/time";
import { formatUsd } from "@/domain/units";
import { hoursMinutes, offerTraits } from "./OfferList";

interface PlanRow {
  key: string;
  name: string;
  price: string;
  saving: string;
  power: string;
  duration: string;
  completion: string;
  deadline: string;
  window: string;
}

function rows(quote: QuoteSet, tz: string): PlanRow[] {
  const b = quote.baseline;
  const baseW = b.powerW ?? [];
  const nowRow: PlanRow = {
    key: "now",
    name: "Charge now",
    price: formatUsd(b.listPriceCents),
    saving: "None (baseline)",
    power: b.feasible ? `${(Math.max(0, ...baseW) / 1000).toFixed(1)} kW` : "n/a",
    duration: b.feasible ? hoursMinutes(baseW.filter((w) => w > 0).length) : "n/a",
    completion: b.feasible ? formatLocalTime(b.chargeEndMs!, tz) : "n/a",
    deadline: b.feasible ? "Ready before you leave" : "Not feasible",
    window: b.feasible ? `${formatLocalTime(b.chargeStartMs!, tz)} to ${formatLocalTime(b.chargeEndMs!, tz)}` : "n/a",
  };
  const flex = quote.offers.map((o: PricedOffer): PlanRow => {
    const t = offerTraits(o);
    return {
      key: o.offerId,
      name: `Smart Flex: ${o.label}`,
      price: formatUsd(o.priceCents),
      saving: `${formatUsd(o.discountCents)} modeled`,
      power: `${(t.maxPowerW / 1000).toFixed(1)} kW`,
      duration: hoursMinutes(t.chargingSlots),
      completion: formatLocalTime(t.readyByMs, tz),
      deadline: "Ready before you leave",
      window: `${formatLocalTime(o.chargeStartMs, tz)} to ${formatLocalTime(o.chargeEndMs, tz)}`,
    };
  });
  return [nowRow, ...flex];
}

const FIELDS: [keyof PlanRow, string][] = [
  ["price", "Modeled price"],
  ["saving", "Modeled saving"],
  ["power", "Charging power (peak)"],
  ["duration", "Charging time"],
  ["window", "Charging window"],
  ["completion", "Expected completion"],
  ["deadline", "Departure readiness"],
];

/** Charge now beside each Smart Flex plan as cards, so nothing scrolls sideways at any width. */
export function PlanComparison({ quote, tz }: { quote: QuoteSet; tz: string }) {
  const plans = rows(quote, tz);
  return (
    <section aria-labelledby="compare-plans" className="space-y-3">
      <h2 id="compare-plans" className="meta">
        Plan comparison
      </h2>
      <ul className="stagger grid gap-3 grid-cols-[repeat(auto-fit,minmax(min(230px,100%),1fr))]">
        {plans.map((p) => (
          <li key={p.key} className="card card-lift plan-card px-4 py-4 space-y-3">
            <p className="font-semibold text-[15px]">{p.name}</p>
            <dl className="space-y-1.5 text-[13px]">
              {FIELDS.map(([k, label]) => (
                <div key={k} className="plan-row flex justify-between gap-3">
                  <dt className="text-muted">{label}</dt>
                  <dd className="text-right font-medium tabular">{p[k]}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}
