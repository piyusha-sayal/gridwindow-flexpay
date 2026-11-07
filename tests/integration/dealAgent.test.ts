/** Flex Deal Agent against the real services: session isolation, expiry, read-only guarantee, DST-safe relative deadlines. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO_STATION } from "@/domain/station";
import { localParts } from "@/domain/time";
import { dealRequestSchema, recommendDealForDriver } from "@/server/ai/dealAgent";
import { acceptOffer } from "@/server/services/checkoutService";
import { createQuote, getQuoteSet, relativeDeadlineWindow } from "@/server/services/quoteService";
import { makeApp, request, resetApp, type TestApp } from "./helpers";

const DRIVER = "drv_deal";
let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});
beforeEach(async () => {
  await resetApp(app);
});
afterAll(async () => {
  await app.db.close();
});

const goals = { minSavingsCents: null, preference: "lowest_cost" as const };
const TABLES = ["reservations", "payment_operations", "provider_proofs", "events", "quote_sets", "mock_provider_objects"];
async function rowCounts() {
  return Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, (await app.db.query<{ n: number }>(`select count(*)::int as n from ${t}`))[0]!.n])));
}

describe("deal agent service", () => {
  it("recommends from the caller's own quote and writes nothing", async () => {
    const quote = await createQuote(app.deps, DRIVER, request({ nightOf: "2026-11-05" }));
    const before = await rowCounts();
    const res = await recommendDealForDriver(app.deps, null, DRIVER, { quoteSetId: quote.quoteSetId, ...goals });
    expect(res.evaluation.status).toBe("RECOMMENDED");
    expect(quote.offers.map((o) => o.offerId)).toContain(res.evaluation.recommendedOfferId);
    expect(await rowCounts()).toEqual(before);
    expect(app.gateway.calls).toHaveLength(0);
  });

  it("another driver's quote is not found (no existence oracle)", async () => {
    const quote = await createQuote(app.deps, DRIVER, request());
    await expect(recommendDealForDriver(app.deps, null, "drv_other", { quoteSetId: quote.quoteSetId, ...goals })).rejects.toMatchObject({ code: "QUOTE_NOT_FOUND", httpStatus: 404 });
    await expect(recommendDealForDriver(app.deps, null, "drv_other", { quoteSetId: "qs_missing", ...goals })).rejects.toMatchObject({ code: "QUOTE_NOT_FOUND", httpStatus: 404 });
  });

  it("after expiry: no recommendation, and the recommended offer still cannot be accepted", async () => {
    const quote = await createQuote(app.deps, DRIVER, request());
    const fresh = await recommendDealForDriver(app.deps, null, DRIVER, { quoteSetId: quote.quoteSetId, ...goals });
    const offer = quote.offers.find((o) => o.offerId === fresh.evaluation.recommendedOfferId)!;
    app.clock.now = quote.expiresAtMs;
    const res = await recommendDealForDriver(app.deps, null, DRIVER, { quoteSetId: quote.quoteSetId, ...goals });
    expect(res.evaluation).toMatchObject({ status: "EXPIRED", recommendedOfferId: null });
    await expect(acceptOffer(app.deps, DRIVER, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true })).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
  });

  it("a minimum saving above every validated discount is reported, not relaxed", async () => {
    const quote = await createQuote(app.deps, DRIVER, request());
    const max = Math.max(...quote.offers.map((o) => o.discountCents));
    const res = await recommendDealForDriver(app.deps, null, DRIVER, { quoteSetId: quote.quoteSetId, minSavingsCents: max + 1, preference: "lowest_cost" });
    expect(res.evaluation).toMatchObject({ status: "NO_QUALIFYING_OFFER", recommendedOfferId: null, bestAvailable: { discountCents: max } });
  });
});

describe("goal changes and tampering", () => {
  it("changing the minimum saving or preference recomputes from the stored quote, never the client", async () => {
    const quote = await createQuote(app.deps, DRIVER, request());
    const sorted = [...quote.offers].sort((a, b) => a.discountCents - b.discountCents);
    const any = await recommendDealForDriver(app.deps, null, DRIVER, { quoteSetId: quote.quoteSetId, ...goals });
    const strict = await recommendDealForDriver(app.deps, null, DRIVER, { quoteSetId: quote.quoteSetId, minSavingsCents: sorted.at(-1)!.discountCents, preference: "lowest_cost" });
    expect(strict.evaluation.candidates.filter((c) => c.qualifies).every((c) => c.discountCents >= sorted.at(-1)!.discountCents)).toBe(true);
    expect(strict.evaluation.goals.minSavingsCents).toBe(sorted.at(-1)!.discountCents);
    const early = await recommendDealForDriver(app.deps, null, DRIVER, { quoteSetId: quote.quoteSetId, minSavingsCents: null, preference: "early_finish" });
    const earliest = Math.min(...quote.offers.map((o) => o.chargeEndMs));
    expect(quote.offers.find((o) => o.offerId === early.evaluation.recommendedOfferId)!.chargeEndMs).toBe(earliest);
    expect(any.evaluation.rankingPolicy).not.toBe(early.evaluation.rankingPolicy);
    // Every figure is the stored backend figure; nothing was rewritten.
    for (const c of [...any.evaluation.candidates, ...early.evaluation.candidates]) {
      const o = quote.offers.find((x) => x.offerId === c.offerId)!;
      expect([c.priceCents, c.discountCents, c.listPriceCents]).toEqual([o.priceCents, o.discountCents, o.listPriceCents]);
    }
    expect((await getQuoteSet(app.deps, DRIVER, quote.quoteSetId)).quote.offers).toEqual(quote.offers);
  });

  it("rejects client-supplied prices, offers, terms or out-of-range goals", () => {
    const ok = { quoteSetId: "qs_1", minSavingsCents: 400, preference: "lowest_cost" };
    expect(dealRequestSchema.safeParse(ok).success).toBe(true);
    for (const extra of [{ priceCents: 1 }, { recommendedOfferId: "o_1" }, { spendCapCents: 99_999 }, { termsHash: "x" }, { approve: true }]) {
      expect(dealRequestSchema.safeParse({ ...ok, ...extra }).success).toBe(false);
    }
    for (const minSavingsCents of [0, -100, 4.5, 50_001, "400"]) expect(dealRequestSchema.safeParse({ ...ok, minSavingsCents }).success).toBe(false);
    expect(dealRequestSchema.safeParse({ ...ok, preference: "free" }).success).toBe(false);
  });

  it("a superseded quote is judged on its own stored prices and expiry; the new quote is independent", async () => {
    const old = await createQuote(app.deps, DRIVER, request());
    app.clock.now = old.expiresAtMs;
    const fresh = await createQuote(app.deps, DRIVER, request());
    const stale = await recommendDealForDriver(app.deps, null, DRIVER, { quoteSetId: old.quoteSetId, ...goals });
    expect(stale.evaluation).toMatchObject({ status: "EXPIRED", recommendedOfferId: null });
    const current = await recommendDealForDriver(app.deps, null, DRIVER, { quoteSetId: fresh.quoteSetId, ...goals });
    expect(fresh.offers.map((o) => o.offerId)).toContain(current.evaluation.recommendedOfferId);
    expect(old.offers.map((o) => o.offerId)).not.toContain(current.evaluation.recommendedOfferId);
  });
});

describe("relative deadline window (station time zone)", () => {
  it("'in two hours' is exact across the fall-back DST change", () => {
    // 2026-11-01 00:30 PDT; two real hours later is 01:30 PST (wall clock would wrongly say 02:30).
    const now = Date.parse("2026-11-01T07:30:00Z");
    const w = relativeDeadlineWindow(DEMO_STATION, now, 120);
    expect(w).toEqual({ nightOf: "2026-10-31", plugInLocal: "00:30", departLocal: "01:30" });
    expect(localParts(now + 120 * 60_000, DEMO_STATION.timeZone)).toMatchObject({ hour: 1, minute: 30 });
  });

  it("evening request: plug in at the next quarter-hour, night is today", () => {
    const now = Date.parse("2026-11-05T04:07:00Z"); // 20:07 PST on Nov 4
    expect(relativeDeadlineWindow(DEMO_STATION, now, 120)).toEqual({ nightOf: "2026-11-04", plugInLocal: "20:15", departLocal: "22:00" });
  });
});
