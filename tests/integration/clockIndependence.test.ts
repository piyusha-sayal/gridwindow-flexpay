/**
 * A quote for an explicit plug-in/departure window is a pure function of that window: it must not
 * change with the wall-clock time of day, midnight, or a daylight-saving night. Only the *defaults*
 * of the driver form depend on "now" (see defaultWindow.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createQuote } from "@/server/services/quoteService";
import { makeApp, request, type TestApp } from "./helpers";

const MIN_SAVING_CENTS = 400;
/** Local station times (America/Los_Angeles) expressed as UTC instants on 2026-11-05 (PST, UTC-8). */
const CLOCKS: [string, string][] = [
  ["midday 12:00", "2026-11-05T20:00:00Z"],
  ["evening 19:05", "2026-11-06T03:05:00Z"],
  ["night 22:40", "2026-11-06T06:40:00Z"],
  ["just before midnight 23:59", "2026-11-06T07:59:00Z"],
  ["just after midnight 00:01", "2026-11-05T08:01:00Z"],
  ["early morning 05:30", "2026-11-05T13:30:00Z"],
];
/** Ordinary night, spring-forward night (23 h day, 2027-03-13 -> 14) and fall-back night (2027-11-06 -> 07). */
const NIGHTS: [string, string][] = [
  ["ordinary", "2027-01-24"],
  ["DST start", "2027-03-13"],
  ["DST end", "2027-11-06"],
];

let app: TestApp;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => app.db.close());

async function offersAt(clockIso: string, night: string) {
  app.clock.now = Date.parse(clockIso);
  const quote = await createQuote(app.deps, `drv_clock_${clockIso}_${night}`, request({ nightOf: night, plugInLocal: "19:00", departLocal: "07:00" }));
  return quote.offers.map((o) => ({ price: o.priceCents, discount: o.discountCents, list: o.listPriceCents }));
}

describe("explicit windows are independent of the wall clock", () => {
  for (const [nightName, night] of NIGHTS) {
    it(`${nightName} night ${night}: identical offers at every time of day, each saving at least $4.00`, async () => {
      const results: Awaited<ReturnType<typeof offersAt>>[] = [];
      // Sequential: the clock is shared test state.
      for (const [, iso] of CLOCKS) results.push(await offersAt(iso, night));
      for (const r of results) expect(r).toEqual(results[0]);
      expect(results[0]!.length).toBeGreaterThan(0);
      expect(Math.max(...results[0]!.map((o) => o.discount))).toBeGreaterThanOrEqual(MIN_SAVING_CENTS);
    });
  }
});
