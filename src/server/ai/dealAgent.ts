/**
 * Flex Deal Agent (server-orchestrated). The backend evaluates and ranks the stored, validated
 * offers deterministically (domain/dealAgent); the model only explains that result in plain words.
 * It holds no tools: it cannot accept offers, change terms or prices, or touch payments, capacity
 * or other drivers' data. Its text must cite only backend facts and must name the backend's own
 * recommendation; anything else degrades to the labeled deterministic explanation.
 */
import { z } from "zod";
import { evaluateDeals, type DealCandidate, type DealEvaluation, type DealGoals, type UnmetGoal } from "@/domain/dealAgent";
import type { QuoteSet } from "@/domain/quotes";
import { formatLocalTime } from "@/domain/time";
import { formatKWh, formatUsd } from "@/domain/units";
import { offerFacts, type FallbackReason } from "./assistant";
import { allowedNumbers, checkGrounding } from "./grounding";
import { ServiceError, type AppDeps } from "../deps";
import { getQuoteSet } from "../services/quoteService";
import type { StructuredLlm } from "./llm";

export type DealFallbackReason = FallbackReason | "QUOTE_EXPIRED";
export type DealSource = { source: "MODEL"; model: string } | { source: "DETERMINISTIC_FALLBACK"; reason: DealFallbackReason };
export type DealAgentResult = { evaluation: DealEvaluation; summary: string; points: string[] } & DealSource;

export const PAYMENT_RULE =
  "Nothing is booked or paid until you review the exact terms and approve them yourself. If you approve, the price is authorized up front and captured only after verified delivery; if charging fails the authorization is voided, which is not a refund, and the bank may take time to remove its hold.";
const MODELED = "Savings are modeled against immediate charging from synthetic tariff assumptions, not measured.";

function unmetGoalText(u: UnmetGoal): string {
  return u.code === "BELOW_MIN_SAVINGS"
    ? `saves ${formatUsd(u.discountCents)}, below your ${formatUsd(u.minSavingsCents)} minimum`
    : `costs ${formatUsd(u.priceCents)}, above your ${formatUsd(u.spendCapCents)} budget`;
}

export function unmetText(c: DealCandidate): string {
  return c.unmet.map(unmetGoalText).join("; ");
}

/** Every figure the model may cite: copied from the evaluation and the stored quote. */
export function dealFacts(quote: QuoteSet, e: DealEvaluation) {
  const tz = quote.grid.timeZone;
  const rec = quote.offers.find((o) => o.offerId === e.recommendedOfferId);
  return {
    status: e.status,
    goals: {
      minimumSaving: e.goals.minSavingsCents === null ? "none" : formatUsd(e.goals.minSavingsCents),
      budget: formatUsd(e.spendCapCents),
      readyBy: formatLocalTime(quote.request.departMs, tz),
      energyToBattery: formatKWh(quote.request.targetBatteryWh),
      preference: e.goals.preference,
    },
    rankingPolicy: e.rankingPolicy,
    recommendedOffer: rec ? offerFacts(quote, rec) : null,
    notQualifying: e.candidates.filter((c) => !c.qualifies).map((c) => ({ offer: c.label, price: formatUsd(c.priceCents), why: unmetText(c) })),
    bestAvailable: e.bestAvailable ? { saving: formatUsd(e.bestAvailable.discountCents), price: formatUsd(e.bestAvailable.priceCents) } : null,
    maxDeliverableToBattery: e.maxDeliverableWh === null ? null : formatKWh(e.maxDeliverableWh),
    immediateCharging: { bookable: false, feasible: e.comparison.feasible, listPrice: formatUsd(e.comparison.listPriceCents) },
    paymentRule: PAYMENT_RULE,
    assumptions: MODELED,
  };
}

const listJoin = (items: (string | false | null)[]) => {
  const parts = items.filter((x): x is string => Boolean(x));
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "");
};

/** Labeled deterministic explanation; also the reference the model's text is checked against. */
export function deterministicDealText(quote: QuoteSet, e: DealEvaluation): { summary: string; points: string[] } {
  const tz = quote.grid.timeZone;
  const readyBy = formatLocalTime(quote.request.departMs, tz);
  const minimum = e.goals.minSavingsCents === null ? null : formatUsd(e.goals.minSavingsCents);
  const rec = e.candidates.find((c) => c.offerId === e.recommendedOfferId);
  const rejected = e.candidates.filter((c) => !c.qualifies).map((c) => `${c.label}: ${unmetText(c)}.`);
  switch (e.status) {
    case "EXPIRED":
      return { summary: "These prices expired, so nothing can be recommended or accepted from them. Request fresh offers.", points: [] };
    case "INFEASIBLE":
      return {
        summary: `This request cannot be met. Most energy deliverable in your parked window: ${formatKWh(e.maxDeliverableWh!)} (server-computed); you asked for ${formatKWh(quote.request.targetBatteryWh)}.`,
        points: ["Leave later, plug in earlier, or ask for less energy.", "No payment has been requested."],
      };
    case "NO_OFFERS":
      return {
        summary: `No flexible offer passed the backend checks for this request${e.comparison.feasible ? "" : ", and immediate charging cannot finish before your departure either"}.`,
        points: ["The reason for each option is listed below.", "No payment has been requested."],
      };
    case "NO_QUALIFYING_OFFER":
      return {
        summary: `No available offer meets your ${listJoin([
          minimum && `${minimum} savings minimum`,
          e.candidates.some((c) => c.unmet.some((u) => u.code === "OVER_BUDGET")) && `${formatUsd(e.spendCapCents)} budget`,
          `${readyBy} deadline`,
        ])}.`,
        points: [
          ...rejected,
          ...(e.bestAvailable ? [`The best available saving is ${formatUsd(e.bestAvailable.discountCents)}, at ${formatUsd(e.bestAvailable.priceCents)}. Your requirements were not relaxed; change them to choose it.`] : []),
          `Immediate charging at ${formatUsd(e.comparison.listPriceCents)} is shown only for comparison and is not bookable here.`,
        ],
      };
    case "RECOMMENDED":
      return {
        summary: `${rec!.label} meets your requirements: ${formatUsd(rec!.priceCents)} instead of ${formatUsd(rec!.listPriceCents)} for immediate charging, a validated saving of ${formatUsd(rec!.discountCents)}.`,
        points: [
          `Charging runs ${formatLocalTime(rec!.chargeStartMs, tz)}-${formatLocalTime(rec!.chargeEndMs, tz)}, ready before ${readyBy}, adding ${formatKWh(quote.request.targetBatteryWh)} to the battery.`,
          `Ranking: ${e.rankingPolicy}`,
          ...rejected,
          PAYMENT_RULE,
          MODELED,
        ],
      };
  }
}

const dealSchema = z.object({
  recommendedOffer: z.string().nullable().describe("Exactly facts.recommendedOffer.offer, or null when it is null"),
  summary: z.string().describe("One or two plain-language sentences"),
  points: z.array(z.string()).describe("Two to four short supporting points"),
});

const DEAL_SYSTEM = [
  "You explain to an EV driver the result of a deterministic check of overnight charging offers against their goals.",
  "The backend already decided which offer (if any) is recommended; never recommend a different one, never relax a goal, and never suggest the driver has agreed to anything.",
  "Use ONLY the figures in the provided facts, copied exactly as written. Do not compute new numbers, percentages or totals.",
  "If status is NO_QUALIFYING_OFFER, say plainly that no offer meets the goals and mention the best available figures. Immediate charging is a comparison only, never a bookable option.",
  "State what would be authorized and what happens if charging fails, using facts.paymentRule. Say savings are modeled. Never claim a payment, capture, refund or released hold happened.",
].join("\n");

function logDecision(e: DealEvaluation, source: string, rejected: string[]): void {
  // Aggregate codes only: no driver text, session, quote or offer identifiers.
  console.warn(`[gridwindow] deal-agent status=${e.status} source=${source} qualifying=${e.candidates.filter((c) => c.qualifies).length}/${e.candidates.length}${rejected.length ? ` rejected=${rejected.join(",")}` : ""}`);
}

export async function recommendDeal(llm: StructuredLlm | null, quote: QuoteSet, goals: DealGoals, nowMs: number): Promise<DealAgentResult> {
  const evaluation = evaluateDeals(quote, goals, nowMs);
  const fallback = (reason: DealFallbackReason, rejected: string[] = []): DealAgentResult => {
    logDecision(evaluation, `FALLBACK:${reason}`, rejected);
    return { evaluation, ...deterministicDealText(quote, evaluation), source: "DETERMINISTIC_FALLBACK", reason };
  };
  if (evaluation.status === "EXPIRED") return fallback("QUOTE_EXPIRED");
  if (!llm) return fallback("NOT_CONFIGURED");
  const facts = dealFacts(quote, evaluation);
  const res = await llm.generate({ system: DEAL_SYSTEM, user: `<facts>${JSON.stringify(facts)}</facts>`, schema: dealSchema, maxTokens: 2_048 });
  if (!res.ok) return fallback(res.reason);
  const points = res.value.points.slice(0, 4);
  if (res.value.recommendedOffer !== (facts.recommendedOffer?.offer ?? null)) return fallback("UNGROUNDED_OUTPUT", ["RECOMMENDATION_MISMATCH"]);
  const issues = checkGrounding([res.value.summary, ...points].join("\n"), allowedNumbers(facts));
  if (issues.length > 0) return fallback("UNGROUNDED_OUTPUT", [...new Set(issues.map((i) => i.kind))]);
  logDecision(evaluation, "MODEL", []);
  return { evaluation, summary: res.value.summary.slice(0, 600), points: points.map((p) => p.slice(0, 300)), source: "MODEL", model: res.model };
}

/** Driver input: a quote reference and goals only. Prices, offers and terms are never accepted from the client. */
export const dealRequestSchema = z
  .object({
    quoteSetId: z.string().min(1).max(64),
    minSavingsCents: z.number().int().min(1).max(50_000).nullable(),
    preference: z.enum(["lowest_cost", "early_finish", "gentle"]),
  })
  .strict();

/** The caller's own stored quote only (foreign or missing quotes are the same 404); reads, never writes. */
export async function recommendDealForDriver(deps: AppDeps, llm: StructuredLlm | null, driverSession: string, input: { quoteSetId: string } & DealGoals): Promise<DealAgentResult> {
  const { quote } = await getQuoteSet(deps, driverSession, input.quoteSetId);
  const required = quote.requiredMinSavingsCents ?? null;
  if (required !== null && input.minSavingsCents !== required) {
    throw new ServiceError("GOAL_MISMATCH", "These offers were requested with a different required minimum saving. Request new offers to change it.", 409);
  }
  return recommendDeal(llm, quote, { minSavingsCents: input.minSavingsCents, preference: input.preference }, deps.now());
}
