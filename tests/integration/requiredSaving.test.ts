/** Mandatory minimum saving: confirmed with the quote, stored server-side, enforced at accept before any order exists. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { termsSavingCents } from "@/domain/quotes";
import { dealRequestSchema, recommendDealForDriver } from "@/server/ai/dealAgent";
import { acceptOffer, acceptSchema } from "@/server/services/checkoutService";
import { createQuote, getQuoteSet, quoteRequestSchema } from "@/server/services/quoteService";
import { makeApp, request, resetApp, type TestApp } from "./helpers";

const DRIVER = "drv_required";
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

async function reservationCount(): Promise<number> {
  return (await app.db.query<{ n: number }>("select count(*)::int as n from reservations"))[0]!.n;
}

/** 42 kWh from 18:00: the offers' savings differ, so one offer is below the best. */
const SPREAD = { targetBatteryKWh: 42, plugInLocal: "18:00" } as const;
async function quoteWithSpread(requiredMinSavingsCents?: number) {
  const probe = await createQuote(app.deps, DRIVER, request(SPREAD));
  const savings = [...new Set(probe.offers.map(termsSavingCents))].sort((a, b) => a - b);
  expect(savings.length).toBeGreaterThan(1);
  const quote = await createQuote(app.deps, DRIVER, request(requiredMinSavingsCents === undefined ? SPREAD : { ...SPREAD, requiredMinSavingsCents }));
  return { quote, low: savings[0]!, high: savings.at(-1)! };
}

const accept = (quoteSetId: string, o: { offerId: string; termsHash: string }) => acceptOffer(app.deps, DRIVER, { quoteSetId, offerId: o.offerId, termsHash: o.termsHash, consent: true });

describe("mandatory minimum saving", () => {
  it("is stored with the quote and returned unchanged", async () => {
    const quote = await createQuote(app.deps, DRIVER, request({ requiredMinSavingsCents: 123 }));
    expect(quote.requiredMinSavingsCents).toBe(123);
    expect((await getQuoteSet(app.deps, DRIVER, quote.quoteSetId)).quote.requiredMinSavingsCents).toBe(123);
    const plain = await createQuote(app.deps, DRIVER, request());
    expect(plain.requiredMinSavingsCents).toBeNull();
  });

  it("unsatisfied: accept is refused before any reservation or payment order exists", async () => {
    const { high } = await quoteWithSpread();
    const { quote } = await quoteWithSpread(high);
    const below = quote.offers.find((o) => termsSavingCents(o) < high)!;
    await expect(accept(quote.quoteSetId, below)).rejects.toMatchObject({ code: "MIN_SAVING_NOT_MET", httpStatus: 409 });
    // A duplicate approval is refused the same way and still creates nothing.
    await expect(accept(quote.quoteSetId, below)).rejects.toMatchObject({ code: "MIN_SAVING_NOT_MET" });
    expect(await reservationCount()).toBe(0);
    expect(app.gateway.calls).not.toContain("createOrder");
  });

  it("satisfied: an offer at or above the requirement is accepted and ordered once", async () => {
    const { high } = await quoteWithSpread();
    const { quote } = await quoteWithSpread(high);
    const meets = quote.offers.find((o) => termsSavingCents(o) >= high)!;
    const res = await accept(quote.quoteSetId, meets);
    expect(res.reservationId).toMatch(/^res/);
    await accept(quote.quoteSetId, meets).catch((e: { code?: string }) => expect(e.code).toBe("ALREADY_ACCEPTED"));
    expect(app.gateway.calls.filter((c) => c === "createOrder")).toHaveLength(1);
    expect(await reservationCount()).toBe(1);
  });

  it("an expired quote is refused as expired, whatever the requirement", async () => {
    const { high } = await quoteWithSpread();
    const { quote } = await quoteWithSpread(high);
    app.clock.now = quote.expiresAtMs;
    await expect(accept(quote.quoteSetId, quote.offers[0]!)).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
  });

  it("the deal agent uses the stored requirement and refuses a different client goal", async () => {
    const { high } = await quoteWithSpread();
    const { quote } = await quoteWithSpread(high);
    const res = await recommendDealForDriver(app.deps, null, DRIVER, { quoteSetId: quote.quoteSetId, minSavingsCents: high, preference: "lowest_cost" });
    expect(res.evaluation).toMatchObject({ savingMandatory: true, goals: { minSavingsCents: high } });
    expect(res.evaluation.candidates.filter((c) => c.qualifies).every((c) => c.discountCents >= high)).toBe(true);
    for (const minSavingsCents of [null, high - 1, high + 1]) {
      await expect(recommendDealForDriver(app.deps, null, DRIVER, { quoteSetId: quote.quoteSetId, minSavingsCents, preference: "lowest_cost" })).rejects.toMatchObject({ code: "GOAL_MISMATCH", httpStatus: 409 });
    }
  });

  it("a changed requirement needs a new quote; the old quote keeps its own", async () => {
    const { low, high } = await quoteWithSpread();
    const { quote: strict } = await quoteWithSpread(high);
    const { quote: relaxed } = await quoteWithSpread(low);
    const cheapStrict = strict.offers.find((o) => termsSavingCents(o) < high)!;
    const cheapRelaxed = relaxed.offers.find((o) => termsSavingCents(o) < high)!;
    await expect(accept(strict.quoteSetId, cheapStrict)).rejects.toMatchObject({ code: "MIN_SAVING_NOT_MET" });
    await expect(accept(relaxed.quoteSetId, cheapRelaxed)).resolves.toMatchObject({ reservationId: expect.stringMatching(/^res/) });
  });
});

describe("advisory saving preference", () => {
  it("is reported by the agent but does not block an informed approval", async () => {
    const { quote, high } = await quoteWithSpread();
    const res = await recommendDealForDriver(app.deps, null, DRIVER, { quoteSetId: quote.quoteSetId, minSavingsCents: high + 1, preference: "lowest_cost" });
    expect(res.evaluation).toMatchObject({ status: "NO_QUALIFYING_OFFER", savingMandatory: false, recommendedOfferId: null });
    await expect(accept(quote.quoteSetId, quote.offers[0]!)).resolves.toMatchObject({ reservationId: expect.stringMatching(/^res/) });
  });
});

describe("tampering", () => {
  it("the requirement is a positive integer number of cents, set only when quoting", () => {
    for (const bad of [0, -100, 4.5, 50_001, "400", null]) {
      expect(quoteRequestSchema.safeParse({ ...request(), requiredMinSavingsCents: bad }).success).toBe(false);
    }
    expect(quoteRequestSchema.safeParse({ ...request(), requiredMinSavingsCents: 400 }).success).toBe(true);
    const base = { quoteSetId: "qs_x", offerId: "off_x", termsHash: "a".repeat(64), consent: true };
    for (const extra of [{ requiredMinSavingsCents: 1 }, { minSavingsCents: 1 }, { waiveMinimum: true }]) {
      expect(acceptSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    }
    expect(dealRequestSchema.safeParse({ quoteSetId: "qs_x", minSavingsCents: 1, preference: "lowest_cost", requiredMinSavingsCents: 1 }).success).toBe(false);
  });
});
