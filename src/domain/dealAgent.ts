/**
 * Flex Deal Agent — deterministic qualification and ranking of backend-priced offers against a
 * driver's goals. Pure: it reads a stored QuoteSet and never computes, adjusts or rounds a price;
 * every amount it returns is copied from the quote. It recommends; only the driver can accept.
 */
import type { ChargePreference } from "./nlRequest";
import type { OfferKind, QuoteSet } from "./quotes";

export interface DealGoals {
  /** Smallest validated discount (vs immediate list price) the driver accepts; null = any saving. */
  minSavingsCents: number | null;
  preference: ChargePreference;
}

export type UnmetGoal =
  | { code: "BELOW_MIN_SAVINGS"; discountCents: number; minSavingsCents: number }
  | { code: "OVER_BUDGET"; priceCents: number; spendCapCents: number };

export interface DealCandidate {
  offerId: string;
  kind: OfferKind;
  label: string;
  priceCents: number;
  listPriceCents: number;
  discountCents: number;
  chargeStartMs: number;
  chargeEndMs: number;
  peakPowerW: number;
  qualifies: boolean;
  unmet: UnmetGoal[];
}

export type DealStatus = "RECOMMENDED" | "NO_QUALIFYING_OFFER" | "NO_OFFERS" | "INFEASIBLE" | "EXPIRED";

export interface DealEvaluation {
  status: DealStatus;
  recommendedOfferId: string | null;
  /** Ranked best-first; qualifying offers precede non-qualifying ones. */
  candidates: DealCandidate[];
  /** Offers the backend validator refused to price, with its reason codes. */
  backendRejected: { kind: OfferKind; reason: string }[];
  /** Best validated figures among bookable offers when none meets the goals (never a relaxed goal). */
  bestAvailable: { discountCents: number; priceCents: number } | null;
  /** Server-computed maximum battery energy deliverable in the parked window, when the target exceeds it. */
  maxDeliverableWh: number | null;
  /** Immediate charging is the comparison baseline, never a bookable offer. */
  comparison: { bookable: false; feasible: boolean; listPriceCents: number; reason?: string };
  rankingPolicy: string;
  goals: DealGoals;
  /** True when the minimum saving was confirmed as mandatory with the quote (accept enforces it). */
  savingMandatory: boolean;
  spendCapCents: number;
  expiresAtMs: number;
}

const KIND_ORDER: OfferKind[] = ["flex_lowest_cost", "flex_early_finish", "flex_gentle"];

export const RANKING_POLICY: Record<ChargePreference, string> = {
  lowest_cost: "Lowest validated price first; ties broken by earlier finish, then offer type.",
  early_finish: "Earliest charging finish first; ties broken by lower validated price, then offer type.",
  gentle: "Lowest peak charging power first; ties broken by lower validated price, then offer type.",
};

type Compare = (a: DealCandidate, b: DealCandidate) => number;
const byKind: Compare = (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
const COMPARATORS: Record<ChargePreference, Compare> = {
  lowest_cost: (a, b) => a.priceCents - b.priceCents || a.chargeEndMs - b.chargeEndMs || byKind(a, b),
  early_finish: (a, b) => a.chargeEndMs - b.chargeEndMs || a.priceCents - b.priceCents || byKind(a, b),
  gentle: (a, b) => a.peakPowerW - b.peakPowerW || a.priceCents - b.priceCents || byKind(a, b),
};

function unmetGoals(priceCents: number, discountCents: number, goals: DealGoals, spendCapCents: number): UnmetGoal[] {
  const unmet: UnmetGoal[] = [];
  if (goals.minSavingsCents !== null && discountCents < goals.minSavingsCents) unmet.push({ code: "BELOW_MIN_SAVINGS", discountCents, minSavingsCents: goals.minSavingsCents });
  if (priceCents > spendCapCents) unmet.push({ code: "OVER_BUDGET", priceCents, spendCapCents });
  return unmet;
}

function bestAvailable(candidates: DealCandidate[]): DealEvaluation["bestAvailable"] {
  if (candidates.length === 0) return null;
  const discountCents = Math.max(...candidates.map((c) => c.discountCents));
  const priceCents = Math.min(...candidates.filter((c) => c.discountCents === discountCents).map((c) => c.priceCents));
  return { discountCents, priceCents };
}

function statusOf(quote: QuoteSet, nowMs: number, infeasible: boolean, candidates: DealCandidate[]): DealStatus {
  if (nowMs >= quote.expiresAtMs) return "EXPIRED";
  if (infeasible) return "INFEASIBLE";
  if (candidates.length === 0) return "NO_OFFERS";
  return candidates.some((c) => c.qualifies) ? "RECOMMENDED" : "NO_QUALIFYING_OFFER";
}

export function evaluateDeals(quote: QuoteSet, requested: DealGoals, nowMs: number): DealEvaluation {
  const spendCapCents = quote.request.spendCapCents;
  // A mandatory minimum stored with the quote always wins over whatever the caller sent.
  const required = quote.requiredMinSavingsCents ?? null;
  const goals: DealGoals = required === null ? requested : { ...requested, minSavingsCents: required };
  const candidates = quote.offers
    .map((o): DealCandidate => {
      const unmet = unmetGoals(o.priceCents, o.discountCents, goals, spendCapCents);
      return {
        offerId: o.offerId,
        kind: o.kind,
        label: o.label,
        priceCents: o.priceCents,
        listPriceCents: o.listPriceCents,
        discountCents: o.discountCents,
        chargeStartMs: o.chargeStartMs,
        chargeEndMs: o.chargeEndMs,
        peakPowerW: Math.max(0, ...o.powerW),
        qualifies: unmet.length === 0,
        unmet,
      };
    })
    .sort((a, b) => Number(b.qualifies) - Number(a.qualifies) || COMPARATORS[goals.preference](a, b));

  const infeasible = quote.capacity.maxBatteryWh < quote.capacity.requiredBatteryWh;
  const status = statusOf(quote, nowMs, infeasible, candidates);
  const b = quote.baseline;
  return {
    status,
    recommendedOfferId: status === "RECOMMENDED" ? candidates[0]!.offerId : null,
    candidates,
    backendRejected: quote.rejected.map((r) => ({ kind: r.kind, reason: r.reason })),
    bestAvailable: status === "NO_QUALIFYING_OFFER" ? bestAvailable(candidates) : null,
    maxDeliverableWh: infeasible ? Math.floor(quote.capacity.maxBatteryWh) : null,
    comparison: { bookable: false, feasible: b.feasible, listPriceCents: b.listPriceCents, ...(b.reason ? { reason: b.reason } : {}) },
    rankingPolicy: RANKING_POLICY[goals.preference],
    goals,
    savingMandatory: required !== null,
    spendCapCents,
    expiresAtMs: quote.expiresAtMs,
  };
}
