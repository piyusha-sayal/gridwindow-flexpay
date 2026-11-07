/** Prints the documented worked example from the real quote engine (no hand-made numbers). */
import { SYNTHETIC_ECONOMICS } from "../src/domain/economics";
import { generateQuote } from "../src/domain/quotes";
import { allocationContext, buildNightScenario, FORECAST_LABEL } from "../src/domain/scenario";
import { DEMO_STATION } from "../src/domain/station";
import { formatLocalTime, slotStartMs } from "../src/domain/time";

const scenario = buildNightScenario(DEMO_STATION, "2026-10-20", 42);
const quote = generateQuote({
  ctx: allocationContext(DEMO_STATION, scenario, []),
  economics: SYNTHETIC_ECONOMICS,
  request: { portId: "port_a", plugInMs: slotStartMs(scenario.grid, 4), departMs: slotStartMs(scenario.grid, 52), targetBatteryWh: 30_000, efficiencyBp: 9_200, spendCapCents: 2000 },
  quoteSetId: "q_doc",
  merchantRef: "sandbox-merchant",
  nowMs: 0,
  ttlMs: 600_000,
  forecastLabel: FORECAST_LABEL,
});
const tz = scenario.grid.timeZone;
const b = quote.baseline;
process.stdout.write(JSON.stringify({
  baseline: { window: `${formatLocalTime(b.chargeStartMs!, tz)}-${formatLocalTime(b.chargeEndMs!, tz)}`, gridWh: b.gridWh, energyCostCents: b.energyCostCents, listPriceCents: b.listPriceCents },
  offers: quote.offers.map((o) => ({ kind: o.kind, window: `${formatLocalTime(o.chargeStartMs, tz)}-${formatLocalTime(o.chargeEndMs, tz)}`, gridWh: o.gridWh, batteryMilliWh: o.batteryMilliWh, energyCostCents: o.energyCostCents, priceCents: o.priceCents, discountCents: o.discountCents, baseline: o.baseline, flexible: o.flexible, operatorImprovementCents: o.operatorImprovementCents })),
  rejected: quote.rejected,
}, null, 1) + "\n");
