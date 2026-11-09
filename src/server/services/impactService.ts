/**
 * Impact Lab: runs the same quote engine as the driver flow for a hypothetical scenario.
 * Read-only by construction: it reads committed plans and never inserts quotes or reservations.
 */
import { PREFERENCE_OFFER_KIND, preferenceLabel, type ImpactScenarioInput, type PreferenceId, type TariffId } from "@/app/impact-lab/scenario";
import { formatUsd } from "@/domain/units";
import { generateQuote, type OfferKind, type QuoteSet } from "@/domain/quotes";
import { allocationContext, buildNightScenario, FORECAST_LABEL } from "@/domain/scenario";
import { SYNTHETIC_TARIFF, type TariffModel } from "@/domain/forecast";
import type { EconomicsConfig } from "@/domain/economics";
import { committedPlans } from "../repo";
import type { AppDeps } from "../deps";
import { nightSeed, toChargeRequest } from "./quoteService";

/** Non-binding for the comparison (schema maximum); Impact Lab does not model a driver's spend cap. */
const IMPACT_SPEND_CAP_CENTS = 50_000;
/** Evening band that the "evening doubled" tariff multiplies (16:00 to 21:00 local). */
const EVENING_BAND = { fromHour: 16, toHour: 21 };
const EVENING_MULTIPLIER = 2;

const OFFER_LABEL: Record<OfferKind, string> = {
  flex_lowest_cost: "Lowest-cost window",
  flex_early_finish: "Ready 1 hour early",
  flex_gentle: "Gentle half-power charge",
};

export interface ChargeProfile {
  startMs: number;
  endMs: number;
  peakKw: number;
  durationMinutes: number;
  powerW: number[];
}

export interface OfferView {
  kind: OfferKind;
  label: string;
  priceCents: number;
  /** Driver saving versus Charge Now's list price (modeled). */
  savingCents: number;
  profile: ChargeProfile;
}

export interface RejectedView {
  kind: OfferKind;
  label: string;
  reason: string;
}

export type Recommendation =
  | { status: "chosen"; kind: OfferKind }
  | { status: "tie"; kinds: OfferKind[]; priceCents: number }
  | { status: "none"; message: string };

export interface ImpactComparison {
  grid: { startMs: number; timeZone: string };
  scenario: ImpactScenarioInput;
  baseline: { feasible: boolean; reason: string | null; priceCents: number; profile: ChargeProfile | null };
  offers: OfferView[];
  rejected: RejectedView[];
  recommendation: Recommendation;
  assumptions: { tariff: string; economics: string; forecast: string; provenance: "SYNTHETIC"; baselineDefinition: string };
}

/** Synthetic tariff with the evening band multiplied; a copy, so the shared constant is never changed. */
export function tariffFor(id: TariffId): TariffModel {
  if (id === "standard") return SYNTHETIC_TARIFF;
  return {
    ...SYNTHETIC_TARIFF,
    label: `${SYNTHETIC_TARIFF.label}; evening 16:00 to 21:00 price doubled for this comparison (synthetic)`,
    bands: SYNTHETIC_TARIFF.bands.map((b) =>
      b.fromHour === EVENING_BAND.fromHour && b.toHour === EVENING_BAND.toHour ? { ...b, mcPerKWh: b.mcPerKWh * EVENING_MULTIPLIER } : b,
    ),
  };
}

/** Plain-English text for a reason code (optionally "CODE: detail" or "VALIDATOR_REJECTED: ..."). */
export function explainReason(raw: string, economics: EconomicsConfig): string {
  const code = raw.split(":")[0]!.trim();
  switch (code) {
    case "INVALID_REQUEST":
      return "The request values are out of range.";
    case "UNKNOWN_PORT":
      return "This port is not part of the station.";
    case "PORT_OCCUPIED":
      return "This port is already taken by another vehicle that night.";
    case "OUTSIDE_HORIZON":
      return "No full 15-minute slot falls between plug-in and ready-by.";
    case "INSUFFICIENT_CAPACITY":
      return "Not enough charging time or power at this port to reach the target energy by ready-by.";
    case "WINDOW_TOO_SHORT":
      return "The window is too short for this offer (it needs more than one hour between plug-in and ready-by).";
    case "DUPLICATE_SCHEDULE":
      return "Same charging schedule as another offer, so it is not listed twice.";
    case "NO_ENERGY_SAVINGS":
      return "Charging later would not lower the modeled energy cost.";
    case "DISCOUNT_BELOW_MINIMUM":
      return `The driver discount would be below the ${formatUsd(economics.minDriverDiscountCents)} minimum.`;
    case "OPERATOR_NOT_BETTER_OFF":
      return "The operator would not be better off after fees and operating cost, so no offer is made.";
    case "EXCEEDS_SPEND_CAP":
      return "The price is above the spend cap.";
    case "NO_COMPARABLE_FEASIBLE_BASELINE":
      return "Charge Now is not feasible, so there is nothing to compare an offer against.";
    case "VALIDATOR_REJECTED":
      return "Failed an independent physics or economics check, so it is not offered.";
    default:
      return "Not offered for an unrecognized reason.";
  }
}

function profileOf(powerW: readonly number[], startMs: number, endMs: number): ChargeProfile {
  return {
    startMs,
    endMs,
    peakKw: Math.max(0, ...powerW) / 1000,
    durationMinutes: Math.round((endMs - startMs) / 60_000),
    powerW: [...powerW],
  };
}

/** Maps the engine's quote to the view the page and endpoint return. Pure. */
export function toComparison(quote: QuoteSet, scenario: ImpactScenarioInput, economics: EconomicsConfig): ImpactComparison {
  const b = quote.baseline;
  const baselineProfile =
    b.feasible && b.powerW && b.chargeStartMs !== undefined && b.chargeEndMs !== undefined ? profileOf(b.powerW, b.chargeStartMs, b.chargeEndMs) : null;
  const offers: OfferView[] = quote.offers.map((o) => ({
    kind: o.kind,
    label: o.label,
    priceCents: o.priceCents,
    savingCents: o.discountCents,
    profile: profileOf(o.powerW, o.chargeStartMs, o.chargeEndMs),
  }));
  const rejected: RejectedView[] = quote.rejected.map((r) => ({
    kind: r.kind,
    label: OFFER_LABEL[r.kind],
    reason: explainReason(r.reason, economics),
  }));
  return {
    grid: { startMs: quote.grid.startMs, timeZone: quote.grid.timeZone },
    scenario,
    baseline: {
      feasible: b.feasible,
      reason: b.feasible ? null : explainReason(b.reason ?? "", economics),
      priceCents: b.listPriceCents,
      profile: baselineProfile,
    },
    offers,
    rejected,
    recommendation: recommend(offers, rejected, scenario.preference),
    assumptions: {
      tariff: quote.assumptions.tariff,
      economics: quote.assumptions.economics,
      forecast: quote.assumptions.forecast,
      provenance: "SYNTHETIC",
      baselineDefinition: "Charge Now starts at plug-in and charges at the port's power until the target energy is reached.",
    },
  };
}

/**
 * Deterministic recommendation for a preference. Lowest price looks at every offer; the other
 * preferences look at one offer kind. Equal lowest prices are reported as a tie, never as one winner.
 */
export function recommend(offers: readonly OfferView[], rejected: readonly RejectedView[], preference: PreferenceId): Recommendation {
  const candidates = preference === "lowest_price" ? offers : offers.filter((o) => o.kind === PREFERENCE_OFFER_KIND[preference]);
  if (candidates.length === 0) {
    const kind = preference === "lowest_price" ? null : PREFERENCE_OFFER_KIND[preference];
    const why = rejected.find((r) => r.kind === kind)?.reason;
    const message = preference === "lowest_price" ? "No offer is available for this scenario, so there is nothing to recommend." : `${preferenceLabel(preference)} is not available. ${why ?? ""}`.trim();
    return { status: "none", message };
  }
  const min = Math.min(...candidates.map((o) => o.priceCents));
  const best = candidates.filter((o) => o.priceCents === min);
  if (best.length > 1) return { status: "tie", kinds: best.map((o) => o.kind), priceCents: min };
  return { status: "chosen", kind: best[0]!.kind };
}

/** Runs the driver-flow engine for a hypothetical night. Never persists anything. */
export async function compareScenario(deps: AppDeps, input: ImpactScenarioInput): Promise<ImpactComparison> {
  const request = toChargeRequest(deps.station, {
    portId: input.portId,
    nightOf: input.nightOf,
    plugInLocal: input.plugInLocal,
    departLocal: input.readyByLocal,
    targetBatteryKWh: input.kWh,
    spendCapCents: IMPACT_SPEND_CAP_CENTS,
  });
  const scenario = buildNightScenario(deps.station, input.nightOf, nightSeed(deps.station.id, input.nightOf), tariffFor(input.tariff));
  const committed = await committedPlans(deps.db, deps.station.id, input.nightOf);
  const quote = generateQuote({
    ctx: allocationContext(deps.station, scenario, committed),
    economics: deps.economics,
    request,
    quoteSetId: "impact_preview",
    merchantRef: deps.merchantRef,
    nowMs: deps.now(),
    ttlMs: deps.quoteTtlMs,
    forecastLabel: FORECAST_LABEL,
  });
  return toComparison(quote, input, deps.economics);
}
