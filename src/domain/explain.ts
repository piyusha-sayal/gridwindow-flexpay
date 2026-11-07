/** Grounded explanation: every number comes from a validated offer, never generated text. */
import type { PricedOffer, QuoteSet } from "./quotes";
import { formatLocalTime } from "./time";
import { formatKWh, formatUsd } from "./units";

export function explainOffer(quote: QuoteSet, offer: PricedOffer): string[] {
  const tz = quote.grid.timeZone;
  const b = quote.baseline;
  const lines = [
    `Charges ${formatKWh(Math.floor(offer.batteryMilliWh / 1000))} into the battery between ${formatLocalTime(offer.chargeStartMs, tz)} and ${formatLocalTime(offer.chargeEndMs, tz)}, before your ${formatLocalTime(quote.request.departMs, tz)} departure.`,
    `Your car stays parked at the same port the whole time; only the electrical draw moves.`,
    `Price ${formatUsd(offer.priceCents)} vs ${formatUsd(offer.listPriceCents)} for charging immediately: you save ${formatUsd(offer.discountCents)}.`,
    `Modeled grid energy cost falls from ${formatUsd(b.energyCostCents ?? 0)} to ${formatUsd(offer.energyCostCents)} (synthetic tariff); your discount is a fixed share of that modeled saving.`,
    `After the assumed payment fee and operating cost, the operator's modeled contribution improves by ${formatUsd(offer.operatorImprovementCents)}.`,
  ];
  return lines;
}
