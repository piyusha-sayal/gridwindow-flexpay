import { describe, expect, it } from "vitest";
import { contribution, listPriceCents, paymentFeeCents, priceFlexibleOffer, SYNTHETIC_ECONOMICS as E, validateOfferEconomics } from "@/domain/economics";
import { generateQuote } from "@/domain/quotes";
import { allocationContext, buildNightScenario, FORECAST_LABEL } from "@/domain/scenario";
import { DEMO_STATION, type ChargeRequest } from "@/domain/station";
import { slotStartMs } from "@/domain/time";
import { termsHash } from "@/domain/terms";
import { validatePlans } from "@/domain/validator";

describe("pricing primitives", () => {
  it("computes list price, assumed fee and contribution in integer cents", () => {
    expect(listPriceCents(E, 30_000)).toBe(1680); // 30 kWh * 56 c
    expect(paymentFeeCents(E, 1440)).toBe(Math.ceil((1440 * 349) / 10_000) + 49); // 51 + 49
    expect(contribution(E, 1440, 500).contributionCents).toBe(1440 - 100 - 500 - 120);
  });

  it("rejects offers with no energy saving", () => {
    expect(priceFlexibleOffer(E, 30_000, 500, 500, 10_000)).toMatchObject({ ok: false, reason: "NO_ENERGY_SAVINGS" });
    expect(priceFlexibleOffer(E, 30_000, 500, 520, 10_000)).toMatchObject({ ok: false, reason: "NO_ENERGY_SAVINGS" });
  });

  it("rejects discounts below the minimum", () => {
    expect(priceFlexibleOffer(E, 30_000, 500, 460, 10_000)).toMatchObject({ ok: false, reason: "DISCOUNT_BELOW_MINIMUM" });
  });

  it("rejects offers above the spend cap", () => {
    expect(priceFlexibleOffer(E, 30_000, 900, 400, 1000)).toMatchObject({ ok: false, reason: "EXCEEDS_SPEND_CAP" });
  });

  it("win-win: driver discount > 0 and operator contribution improves", () => {
    const r = priceFlexibleOffer(E, 30_000, 900, 400, 10_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.driverDiscountCents).toBe(250);
    expect(r.flexible.priceCents).toBe(1430);
    expect(r.operatorImprovementCents).toBeGreaterThan(0);
    expect(r.flexible.contributionCents - r.baseline.contributionCents).toBe(r.operatorImprovementCents);
  });

  it("independent economics validator catches a tampered price", () => {
    expect(validateOfferEconomics(E, { priceCents: 1190, listPriceCents: 1440, energyCostCents: 400, baselineEnergyCostCents: 900 })).toEqual([]);
    expect(validateOfferEconomics(E, { priceCents: 600, listPriceCents: 1440, energyCostCents: 400, baselineEnergyCostCents: 900 }).length).toBeGreaterThan(0);
    expect(validateOfferEconomics(E, { priceCents: 1440, listPriceCents: 1440, energyCostCents: 400, baselineEnergyCostCents: 900 })).toContain("driver discount must be > 0");
  });
});

describe("quote generation", () => {
  const scenario = buildNightScenario(DEMO_STATION, "2026-10-20", 42);
  const ctx = allocationContext(DEMO_STATION, scenario, []);
  const request: ChargeRequest = {
    portId: "port_a",
    plugInMs: slotStartMs(scenario.grid, 4), // 19:00
    departMs: slotStartMs(scenario.grid, 52), // 07:00
    targetBatteryWh: 30_000,
    efficiencyBp: 9_200,
    spendCapCents: 20_00,
  };
  const quote = generateQuote({ ctx, economics: E, request, quoteSetId: "q_test", merchantRef: "sandbox-merchant", nowMs: 1_000, ttlMs: 600_000, forecastLabel: FORECAST_LABEL });

  it("returns at least two validated win-win offers for an evening plug-in", () => {
    expect(quote.baseline.feasible).toBe(true);
    expect(quote.offers.length).toBeGreaterThanOrEqual(2);
    for (const o of quote.offers) {
      expect(o.discountCents).toBeGreaterThan(0);
      expect(o.operatorImprovementCents).toBeGreaterThan(0);
      expect(o.priceCents).toBe(o.listPriceCents - o.discountCents);
      expect(o.priceCents).toBeLessThanOrEqual(request.spendCapCents);
      expect(validatePlans(DEMO_STATION, scenario.grid, scenario.forecastBaseLoadW, [{ sessionId: o.offerId, portId: "port_a", plugInMs: request.plugInMs, departMs: request.departMs, powerW: o.powerW }], [{ sessionId: o.offerId, targetBatteryWh: 30_000, efficiencyBp: 9_200 }])).toEqual([]);
    }
  });

  it("is deterministic and hash-bound", () => {
    const again = generateQuote({ ctx, economics: E, request, quoteSetId: "q_test", merchantRef: "sandbox-merchant", nowMs: 1_000, ttlMs: 600_000, forecastLabel: FORECAST_LABEL });
    expect(again.offers.map((o) => o.termsHash)).toEqual(quote.offers.map((o) => o.termsHash));
    const first = quote.offers[0]!;
    expect(termsHash(first.terms)).toBe(first.termsHash);
    expect(termsHash({ ...first.terms, amountCents: first.terms.amountCents - 1 })).not.toBe(first.termsHash);
  });

  it("returns zero offers truthfully when the deadline is physically impossible", () => {
    const tight = generateQuote({ ctx, economics: E, request: { ...request, departMs: slotStartMs(scenario.grid, 8) }, quoteSetId: "q2", merchantRef: "m", nowMs: 0, ttlMs: 1, forecastLabel: FORECAST_LABEL });
    expect(tight.baseline.feasible).toBe(false);
    expect(tight.offers).toEqual([]);
  });

  it("returns zero offers when the whole window is already cheap (no saving to share)", () => {
    const overnight = generateQuote({
      ctx,
      economics: E,
      request: { ...request, plugInMs: slotStartMs(scenario.grid, 28), departMs: slotStartMs(scenario.grid, 40) },
      quoteSetId: "q3",
      merchantRef: "m",
      nowMs: 0,
      ttlMs: 1,
      forecastLabel: FORECAST_LABEL,
    });
    expect(overnight.baseline.feasible).toBe(true);
    expect(overnight.offers).toEqual([]);
    expect(overnight.rejected.length).toBeGreaterThan(0);
  });
});
