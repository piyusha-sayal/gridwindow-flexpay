/**
 * Presentation helpers added in the final UI refinement: the per-offer "Why this plan fits" points and the capacity
 * summary. Both only restate values that already exist in the quote or the schedule model.
 */
import { describe, expect, it } from "vitest";
import { planFitPoints } from "@/app/drive/OfferList";
import { PORT_GUIDE, PREFERENCE_GUIDE, PREFERENCES } from "@/app/drive/driverTypes";
import { formatKw, summarizeCapacity } from "@/app/operator/schedule/capacityStats";
import type { CapacityBucket } from "@/app/operator/schedule/scheduleModel";
import { DEMO_STATION } from "@/domain/station";
import { SLOT_MS } from "@/domain/units";
import { smokeFixtures } from "../../scripts/aiSmokeFlow";

const { quote } = smokeFixtures();
const TZ = DEMO_STATION.timeZone;

describe("planFitPoints", () => {
  it("gives at most three points for every offer, built only from quote values", () => {
    for (const o of quote.offers) {
      const points = planFitPoints(o, quote, "flex_lowest_cost", TZ);
      expect(points.length).toBeGreaterThanOrEqual(2);
      expect(points.length).toBeLessThanOrEqual(3);
      expect(points[0]).toMatch(/^Delivers 30\.00 kWh/);
    }
  });

  it("states the deadline only because the offer finishes before the driver leaves", () => {
    const o = quote.offers[0]!;
    expect(o.chargeEndMs).toBeLessThanOrEqual(quote.request.departMs);
    expect(planFitPoints(o, quote, "flex_lowest_cost", TZ)[0]).toMatch(/before you leave at/);
    const late = { ...o, chargeEndMs: quote.request.departMs + SLOT_MS };
    expect(planFitPoints(late, quote, "flex_lowest_cost", TZ)[0]).not.toMatch(/before you leave/);
  });

  it("marks the preference match only on the offer of the chosen preference", () => {
    const [first, second] = quote.offers;
    const all = (kind: typeof first extends undefined ? never : NonNullable<typeof first>["kind"]) => [planFitPoints(first!, quote, kind, TZ).join(" "), planFitPoints(second!, quote, kind, TZ).join(" ")];
    const [a, b] = all(first!.kind);
    expect(a).toMatch(/Matches your .* preference/);
    expect(b).not.toMatch(/Matches your .* preference/);
  });

  it("never claims a saving or battery health, and uses no em dash", () => {
    for (const o of quote.offers) {
      const text = planFitPoints(o, quote, o.kind, TZ).join(" ");
      expect(text).not.toMatch(/sav(e|ing)|health|cheaper|\u2014/i);
    }
  });

  it("reports a trade-off against the other offers, or says there is none", () => {
    for (const o of quote.offers) {
      const last = planFitPoints(o, quote, "flex_lowest_cost", TZ).at(-1)!;
      expect(last).toMatch(/Takes |Costs |Ready \d+ min|No meaningful trade-off|only offer/);
    }
    const only = { ...quote, offers: [quote.offers[0]!] };
    expect(planFitPoints(only.offers[0]!, only, "flex_lowest_cost", TZ).at(-1)).toBe("This is the only offer that fits your request.");
  });
});

describe("port and preference copy", () => {
  it("covers all three ports and all three preferences with no em dash", () => {
    expect(Object.keys(PORT_GUIDE).sort()).toEqual(["port_a", "port_b", "port_c"]);
    expect(PREFERENCES.map((p) => p.value).sort()).toEqual(Object.keys(PREFERENCE_GUIDE).sort());
    const text = JSON.stringify([PORT_GUIDE, PREFERENCE_GUIDE]);
    expect(text).not.toMatch(/\u2014/);
    expect(text).not.toMatch(/cheaper|saves|savings/i);
  });

  it("uses the agreed one-line descriptions", () => {
    expect(PORT_GUIDE.port_a!.summary).toBe("Lower power, suitable for longer charging stays.");
    expect(PORT_GUIDE.port_b!.summary).toBe("Balanced charging speed and power demand.");
    expect(PORT_GUIDE.port_c!.summary).toBe("Faster energy delivery for tighter deadlines.");
  });
});

const bucket = (slot: number, drawKw: number, capKw = 24): CapacityBucket => ({ slot, startMs: slot * SLOT_MS, drawKw, baseKw: 0, capKw, over: drawKw > capKw });

describe("summarizeCapacity", () => {
  it("groups consecutive over-limit slots into one range and computes peak and limit from the buckets", () => {
    const s = summarizeCapacity([bucket(0, 10), bucket(1, 33), bucket(2, 30), bucket(3, 20), bucket(4, 26), bucket(5, 12)]);
    expect(s.peakKw).toBe(33);
    expect(s.minLimitKw).toBe(24);
    expect(s.maxLimitKw).toBe(24);
    expect(s.overSlots).toBe(3);
    expect(s.overloads).toEqual([
      { startMs: SLOT_MS, endMs: 3 * SLOT_MS, slots: 2 },
      { startMs: 4 * SLOT_MS, endMs: 5 * SLOT_MS, slots: 1 },
    ]);
  });

  it("reports no overload when demand stays within the limit, and handles an empty schedule", () => {
    expect(summarizeCapacity([bucket(0, 24), bucket(1, 5)]).overloads).toEqual([]);
    expect(summarizeCapacity([])).toEqual({ peakKw: 0, minLimitKw: 0, maxLimitKw: 0, overSlots: 0, overloads: [] });
  });

  it("shows a varying limit as a range and formats kW", () => {
    const s = summarizeCapacity([bucket(0, 10, 24), bucket(1, 10, 18)]);
    expect([s.minLimitKw, s.maxLimitKw]).toEqual([18, 24]);
    expect(formatKw(33)).toBe("33 kW");
    expect(formatKw(7.2)).toBe("7.2 kW");
  });
});
