/** Shared deterministic fixture for recovery tests: the demo station, one seeded night, one real generated quote. */
import { SYNTHETIC_ECONOMICS } from "@/domain/economics";
import { buildEnvelope, chargeEndMs, type DisturbanceRecord } from "@/domain/disturbance";
import { generateQuote, type PricedOffer, type QuoteSet } from "@/domain/quotes";
import { allocationContext, buildNightScenario, FORECAST_LABEL, type NightScenario } from "@/domain/scenario";
import { DEMO_STATION, type SessionPlan } from "@/domain/station";
import type { AgreedSession, PlanningContext } from "@/domain/recovery";
import { zonedTimeToUtc } from "@/domain/time";

export const FIXTURE_NIGHT = "2026-11-05";
const SEED = 20261105;
export const RESERVATION = "res_fixture";

export interface Fixture {
  scenario: NightScenario;
  quote: QuoteSet;
  offer: PricedOffer;
  session: AgreedSession;
}

export function fixtureScenario(): NightScenario {
  return buildNightScenario(DEMO_STATION, FIXTURE_NIGHT, SEED);
}

/** Port C, plug in 19:00, depart 07:00 next morning, 30 kWh battery target. */
export function fixtureQuote(others: readonly SessionPlan[] = []): { quote: QuoteSet; scenario: NightScenario } {
  const scenario = fixtureScenario();
  const day = { year: 2026, month: 11, day: 5 };
  const plugInMs = zonedTimeToUtc({ ...day, hour: 19, minute: 0 }, DEMO_STATION.timeZone);
  const departMs = zonedTimeToUtc({ year: 2026, month: 11, day: 6, hour: 7, minute: 0 }, DEMO_STATION.timeZone);
  const quote = generateQuote({
    ctx: allocationContext(DEMO_STATION, scenario, others),
    economics: SYNTHETIC_ECONOMICS,
    request: { portId: "port_c", plugInMs, departMs, targetBatteryWh: 30_000, efficiencyBp: 9_200, spendCapCents: 2_500 },
    quoteSetId: "qs_fixture",
    merchantRef: "merchant_fixture",
    nowMs: plugInMs - 3_600_000,
    ttlMs: 600_000,
    forecastLabel: FORECAST_LABEL,
  });
  return { quote, scenario };
}

/** The accepted lowest-cost offer, with its immutable terms as the agreed baseline. */
export function fixture(): Fixture {
  const { quote, scenario } = fixtureQuote();
  const offer = quote.offers.find((o) => o.kind === "flex_lowest_cost");
  if (!offer) throw new Error("fixture requires a feasible lowest-cost offer");
  const session: AgreedSession = {
    reservationId: RESERVATION,
    portId: quote.request.portId,
    plugInMs: quote.request.plugInMs,
    agreedDepartMs: quote.request.departMs,
    targetBatteryWh: quote.request.targetBatteryWh,
    efficiencyBp: quote.request.efficiencyBp,
    amountCents: offer.priceCents,
    listPriceCents: offer.listPriceCents,
    baselineEnergyCostCents: quote.baseline.energyCostCents ?? 0,
    agreedPowerW: offer.powerW,
    currentPowerW: offer.powerW,
  };
  return { scenario, quote, offer, session };
}

export function planningContext(scenario: NightScenario, records: readonly DisturbanceRecord[] = [], others: readonly SessionPlan[] = []): PlanningContext {
  return {
    station: DEMO_STATION,
    grid: scenario.grid,
    tariff: scenario.tariff,
    touMc: scenario.touMc,
    forecastBaseLoadW: scenario.forecastBaseLoadW,
    actualBaseLoadW: scenario.actualBaseLoadW,
    economics: SYNTHETIC_ECONOMICS,
    envelope: buildEnvelope(DEMO_STATION, scenario.grid, records),
    others,
  };
}

export function readyBy(f: Fixture): number {
  return chargeEndMs(f.scenario.grid, f.session.agreedPowerW) ?? f.session.agreedDepartMs;
}
