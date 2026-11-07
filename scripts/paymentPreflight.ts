/**
 * Pure planning for the two PayPal Sandbox certification scenarios. Builds the real backend quote for a
 * future night and reports what would be authorized, without creating a quote row, an order or any provider call.
 */
import { SYNTHETIC_ECONOMICS } from "../src/domain/economics";
import { generateQuote, type PricedOffer, type QuoteSet } from "../src/domain/quotes";
import { allocationContext, FORECAST_LABEL } from "../src/domain/scenario";
import { DEMO_STATION, type SessionPlan } from "../src/domain/station";
import { approvalDeadlineMs } from "../src/domain/terms";
import { formatLocalTime } from "../src/domain/time";
import { formatKWh, formatUsd } from "../src/domain/units";
import { scenarioFor, toChargeRequest, type QuoteRequestInput } from "../src/server/services/quoteService";

export const QUOTE_TTL_MS = 10 * 60_000;

export interface ScenarioSpec {
  id: "A" | "B";
  title: string;
  input: QuoteRequestInput;
  /** Expected path after buyer approval. */
  path: string[];
}

export interface ScenarioPlan {
  spec: ScenarioSpec;
  quoteSetIdPreview: string;
  chosen: { label: string; offerId: string; priceCents: number; listPriceCents: number; discountCents: number; chargeWindow: string; termsHashPrefix: string };
  allOffers: { label: string; priceCents: number; discountCents: number }[];
  maxAuthorizationCents: number;
  maxAuthorizationUsd: string;
  currency: "USD";
  merchantRef: string;
  quoteValidMinutes: number;
  approvalDeadline: string;
  hoursUntilApprovalDeadline: number;
  existingCommittedPlans: number;
  warnings: string[];
}

export function buildScenarioSpecs(nightA: string, nightB: string): ScenarioSpec[] {
  const base = { plugInLocal: "19:00", departLocal: "07:00", targetBatteryKWh: 30, spendCapCents: 2_000 };
  return [
    {
      id: "A",
      title: "Successful charging: capture after verified synthetic delivery",
      input: { ...base, portId: "port_a", nightOf: nightA },
      path: ["offer shown", "driver ticks consent and approves exact terms", "PayPal order CREATED with intent=AUTHORIZE (funds held, nothing captured yet)", "buyer approves in PayPal Sandbox -> order APPROVED", "authorize -> authorization CREATED, reservation AUTHORIZED", "driver runs the synthetic night -> DELIVERED", "capture once -> capture COMPLETED, reservation CAPTURED", "FlexReceipt shows 'capture confirmed by provider'"],
    },
    {
      id: "B",
      title: "Charging outage: void, no payment collected",
      input: { ...base, portId: "port_b", nightOf: nightB },
      path: ["offer shown", "driver ticks consent and approves exact terms", "PayPal order CREATED", "buyer approves in PayPal Sandbox -> order APPROVED", "authorize -> authorization CREATED, reservation AUTHORIZED", "operator injects an outage -> run FAILED", "void authorization -> authorization VOIDED, reservation VOIDED", "FlexReceipt shows 'authorization voided, no payment collected'"],
    },
  ];
}

export function planScenario(spec: ScenarioSpec, nowMs: number, committed: SessionPlan[]): ScenarioPlan {
  const station = DEMO_STATION;
  const request = toChargeRequest(station, spec.input);
  const quote: QuoteSet = {
    ...generateQuote({
      ctx: allocationContext(station, scenarioFor(station, spec.input.nightOf), committed),
      economics: SYNTHETIC_ECONOMICS,
      request,
      quoteSetId: `qs_preview_${spec.id}`,
      merchantRef: "paypal-sandbox-merchant",
      nowMs,
      ttlMs: QUOTE_TTL_MS,
      forecastLabel: FORECAST_LABEL,
    }),
    requiredMinSavingsCents: null,
  };
  const warnings: string[] = [];
  if (quote.offers.length === 0) throw new Error(`scenario ${spec.id}: the backend produced no offer for this night and port`);
  // The lowest-priced flexible offer is what the agent and the default selection choose.
  const offer: PricedOffer = [...quote.offers].sort((a, b) => a.priceCents - b.priceCents)[0]!;
  if (committed.length > 0) warnings.push(`${committed.length} committed session(s) already occupy this night; the price may differ from this preview.`);
  if (offer.priceCents > spec.input.spendCapCents) warnings.push("offer price exceeds the spend cap");
  if (offer.discountCents <= 0) warnings.push("offer has no driver discount");
  const deadline = approvalDeadlineMs(offer.terms);
  const tz = station.timeZone;
  return {
    spec,
    quoteSetIdPreview: quote.quoteSetId,
    chosen: {
      label: offer.label,
      offerId: offer.offerId,
      priceCents: offer.priceCents,
      listPriceCents: offer.listPriceCents,
      discountCents: offer.discountCents,
      chargeWindow: `${formatLocalTime(offer.chargeStartMs, tz)}-${formatLocalTime(offer.chargeEndMs, tz)} (${formatKWh(request.targetBatteryWh)} to battery)`,
      termsHashPrefix: offer.termsHash.slice(0, 12),
    },
    allOffers: quote.offers.map((o) => ({ label: o.label, priceCents: o.priceCents, discountCents: o.discountCents })),
    maxAuthorizationCents: offer.priceCents,
    maxAuthorizationUsd: formatUsd(offer.priceCents),
    currency: "USD",
    merchantRef: offer.terms.merchantRef,
    quoteValidMinutes: QUOTE_TTL_MS / 60_000,
    approvalDeadline: `${new Date(deadline).toLocaleString("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "short" })} ${tz}`,
    hoursUntilApprovalDeadline: Math.round(((deadline - nowMs) / 3_600_000) * 10) / 10,
    existingCommittedPlans: committed.length,
    warnings,
  };
}
