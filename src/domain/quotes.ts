/**
 * Deterministic quote generation: feasible immediate baseline + up to three flexible
 * offers, each independently validated (physics + economics) before it is returned.
 */
import { allocate, type AllocationContext, type AllocationPolicy } from "./allocator";
import { listPriceCents, microcentsToCentsCeil, priceFlexibleOffer, validateOfferEconomics, type Contribution, type EconomicsConfig } from "./economics";
import type { ChargeRequest } from "./station";
import { TERMS_VERSION, termsHash, type OfferTerms } from "./terms";
import { slotStartMs } from "./time";
import { batteryMilliWhFromGridWh, slotGridWh, SLOT_MS } from "./units";
import { validatePlans } from "./validator";

export type OfferKind = "flex_lowest_cost" | "flex_early_finish" | "flex_gentle";

export interface PricedOffer {
  offerId: string;
  kind: OfferKind;
  label: string;
  powerW: number[];
  chargeStartMs: number;
  chargeEndMs: number;
  gridWh: number;
  batteryMilliWh: number;
  energyCostCents: number;
  listPriceCents: number;
  priceCents: number;
  discountCents: number;
  operatorImprovementCents: number;
  baseline: Contribution;
  flexible: Contribution;
  terms: OfferTerms;
  termsHash: string;
}

export interface BaselineSummary {
  feasible: boolean;
  reason?: string;
  powerW?: number[];
  chargeStartMs?: number;
  chargeEndMs?: number;
  gridWh?: number;
  energyCostCents?: number;
  listPriceCents: number;
  withinSpendCap: boolean;
}

export interface QuoteSet {
  quoteSetId: string;
  stationId: string;
  createdAtMs: number;
  expiresAtMs: number;
  request: ChargeRequest;
  grid: { startMs: number; slotCount: number; timeZone: string };
  baseline: BaselineSummary;
  offers: PricedOffer[];
  rejected: { kind: OfferKind; reason: string }[];
  assumptions: { tariff: string; economics: string; forecast: string; provenance: "SYNTHETIC" };
  /** Physical upper bound for this request (port limit only, before site cap and other drivers). */
  capacity: { parkedSlots: number; portMaxPowerW: number; maxBatteryWh: number; requiredBatteryWh: number };
  /**
   * Minimum saving the driver confirmed as mandatory when requesting this quote (cents, versus
   * immediate charging). Stored with the quote, so it cannot change afterwards; accept refuses any
   * offer that saves less. Absent or null: no mandatory minimum (a preference stays advisory).
   */
  requiredMinSavingsCents?: number | null;
}

/** Validated saving of an offer, from its hashed terms (never from client or model input). */
export function termsSavingCents(offer: PricedOffer): number {
  return offer.terms.listPriceCents - offer.terms.amountCents;
}

/** Whether an offer meets the quote's mandatory minimum saving (true when there is none). */
export function meetsRequiredSaving(quote: QuoteSet, offer: PricedOffer): boolean {
  const required = quote.requiredMinSavingsCents ?? null;
  return required === null || termsSavingCents(offer) >= required;
}

export interface QuoteParams {
  ctx: AllocationContext;
  economics: EconomicsConfig;
  request: ChargeRequest;
  quoteSetId: string;
  merchantRef: string;
  nowMs: number;
  ttlMs: number;
  forecastLabel: string;
}

const VARIANTS: { kind: OfferKind; label: string; policy: (req: ChargeRequest, portMaxW: number, step: number) => AllocationPolicy | null }[] = [
  { kind: "flex_lowest_cost", label: "Lowest-cost window", policy: () => ({ kind: "optimized" }) },
  {
    kind: "flex_early_finish",
    label: "Ready 1 hour early",
    policy: (req) => (req.departMs - 3_600_000 > req.plugInMs ? { kind: "optimized", latestEndMs: req.departMs - 3_600_000 } : null),
  },
  {
    kind: "flex_gentle",
    label: "Gentle Charging",
    policy: (_req, portMaxW, step) => ({ kind: "optimized", maxPowerW: Math.floor(portMaxW / 2 / step) * step }),
  },
];

function activeWindow(ctx: AllocationContext, first: number, last: number): { chargeStartMs: number; chargeEndMs: number } {
  return { chargeStartMs: slotStartMs(ctx.grid, first), chargeEndMs: slotStartMs(ctx.grid, last) + SLOT_MS };
}

export function generateQuote(p: QuoteParams): QuoteSet {
  const { ctx, economics, request } = p;
  const list = listPriceCents(economics, request.targetBatteryWh);
  const expiresAtMs = p.nowMs + p.ttlMs;
  const portMaxPowerW = ctx.station.ports.find((x) => x.id === request.portId)?.maxPowerW ?? 0;
  const parkedSlots = Math.max(0, Math.floor((request.departMs - request.plugInMs) / SLOT_MS));
  const base: QuoteSet = {
    quoteSetId: p.quoteSetId,
    stationId: ctx.station.id,
    createdAtMs: p.nowMs,
    expiresAtMs,
    request,
    grid: { startMs: ctx.grid.startMs, slotCount: ctx.grid.slotCount, timeZone: ctx.grid.timeZone },
    baseline: { feasible: false, listPriceCents: list, withinSpendCap: list <= request.spendCapCents },
    offers: [],
    rejected: [],
    assumptions: { tariff: ctx.tariff.label, economics: economics.label, forecast: p.forecastLabel, provenance: "SYNTHETIC" },
    capacity: {
      parkedSlots,
      portMaxPowerW,
      maxBatteryWh: Math.floor(batteryMilliWhFromGridWh(parkedSlots * slotGridWh(portMaxPowerW), request.efficiencyBp) / 1000),
      requiredBatteryWh: request.targetBatteryWh,
    },
  };

  const immediate = allocate(ctx, request, { kind: "immediate" });
  if (!immediate.ok) {
    return {
      ...base,
      baseline: { ...base.baseline, reason: `${immediate.reason}: ${immediate.detail}` },
      rejected: VARIANTS.map((v) => ({ kind: v.kind, reason: "NO_COMPARABLE_FEASIBLE_BASELINE" })),
    };
  }
  const baselineCost = microcentsToCentsCeil(immediate.costMicrocents);
  const baseline: BaselineSummary = {
    ...base.baseline,
    feasible: true,
    powerW: immediate.powerW,
    ...activeWindow(ctx, immediate.firstActiveSlot, immediate.lastActiveSlot),
    gridWh: immediate.gridWh,
    energyCostCents: baselineCost,
  };

  const port = ctx.station.ports.find((x) => x.id === request.portId)!;
  const offers: PricedOffer[] = [];
  const rejected: QuoteSet["rejected"] = [];
  for (const variant of VARIANTS) {
    const policy = variant.policy(request, port.maxPowerW, ctx.station.powerStepW);
    if (!policy) {
      rejected.push({ kind: variant.kind, reason: "WINDOW_TOO_SHORT" });
      continue;
    }
    const alloc = allocate(ctx, request, policy);
    if (!alloc.ok) {
      rejected.push({ kind: variant.kind, reason: alloc.reason });
      continue;
    }
    if (offers.some((o) => o.powerW.every((w, i) => w === alloc.powerW[i]))) {
      rejected.push({ kind: variant.kind, reason: "DUPLICATE_SCHEDULE" });
      continue;
    }
    const energyCostCents = microcentsToCentsCeil(alloc.costMicrocents);
    const pricing = priceFlexibleOffer(economics, request.targetBatteryWh, baselineCost, energyCostCents, request.spendCapCents);
    if (!pricing.ok) {
      rejected.push({ kind: variant.kind, reason: pricing.reason });
      continue;
    }
    const offerId = `${p.quoteSetId}_${variant.kind}`;
    const plan = { sessionId: offerId, portId: request.portId, plugInMs: request.plugInMs, departMs: request.departMs, powerW: alloc.powerW };
    const physics = validatePlans(ctx.station, ctx.grid, ctx.baseLoadW, [...ctx.committed, plan], [
      { sessionId: offerId, targetBatteryWh: request.targetBatteryWh, efficiencyBp: request.efficiencyBp },
    ]);
    const money = validateOfferEconomics(economics, {
      priceCents: pricing.flexible.priceCents,
      listPriceCents: list,
      energyCostCents,
      baselineEnergyCostCents: baselineCost,
    });
    if (physics.length > 0 || money.length > 0) {
      rejected.push({ kind: variant.kind, reason: `VALIDATOR_REJECTED: ${[...physics.map((v) => v.code), ...money].join(", ")}` });
      continue;
    }
    const terms: OfferTerms = {
      version: TERMS_VERSION,
      quoteSetId: p.quoteSetId,
      offerId,
      stationId: ctx.station.id,
      merchantRef: p.merchantRef,
      portId: request.portId,
      currency: "USD",
      amountCents: pricing.flexible.priceCents,
      listPriceCents: list,
      targetBatteryWh: request.targetBatteryWh,
      efficiencyBp: request.efficiencyBp,
      plugInMs: request.plugInMs,
      departMs: request.departMs,
      gridStartMs: ctx.grid.startMs,
      powerW: alloc.powerW,
      expiresAtMs,
    };
    offers.push({
      offerId,
      kind: variant.kind,
      label: variant.label,
      powerW: alloc.powerW,
      ...activeWindow(ctx, alloc.firstActiveSlot, alloc.lastActiveSlot),
      gridWh: alloc.gridWh,
      batteryMilliWh: alloc.batteryMilliWh,
      energyCostCents,
      listPriceCents: list,
      priceCents: pricing.flexible.priceCents,
      discountCents: pricing.driverDiscountCents,
      operatorImprovementCents: pricing.operatorImprovementCents,
      baseline: pricing.baseline,
      flexible: pricing.flexible,
      terms,
      termsHash: termsHash(terms),
    });
  }
  return { ...base, baseline, offers, rejected };
}
