/**
 * Impact Lab runs the driver-flow engine for hypothetical nights. It must return real comparisons
 * for different ports and never write quote or reservation rows.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ImpactScenarioInput } from "@/app/impact-lab/scenario";
import { compareScenario } from "@/server/services/impactService";
import { makeApp, NIGHT, resetApp, type TestApp } from "./helpers";

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

const scenario = (overrides: Partial<ImpactScenarioInput> = {}): ImpactScenarioInput => ({
  portId: "port_a",
  nightOf: NIGHT,
  plugInLocal: "19:00",
  readyByLocal: "07:00",
  kWh: 30,
  preference: "lowest_price",
  tariff: "standard",
  ...overrides,
});

async function count(table: string): Promise<number> {
  const rows = await app.db.query<{ n: number }>(`select count(*)::int as n from ${table}`);
  return rows[0]!.n;
}

describe("impact lab comparison", () => {
  it("gives different feasible results for a lower-power and a higher-power port", async () => {
    const a = await compareScenario(app.deps, scenario({ portId: "port_a" }));
    const c = await compareScenario(app.deps, scenario({ portId: "port_c" }));
    expect(a.baseline.feasible).toBe(true);
    expect(c.baseline.feasible).toBe(true);
    expect(a.baseline.profile!.peakKw).toBeCloseTo(3.6, 1);
    expect(c.baseline.profile!.peakKw).toBeGreaterThan(a.baseline.profile!.peakKw);
    expect(c.baseline.profile!.durationMinutes).toBeLessThan(a.baseline.profile!.durationMinutes);
  });

  it("returns a plain-English reason and no offer when the target cannot be reached", async () => {
    const result = await compareScenario(app.deps, scenario({ kWh: 55, readyByLocal: "20:00" }));
    expect(result.baseline.feasible).toBe(false);
    expect(result.baseline.reason).toMatch(/Not enough charging time/);
    expect(result.baseline.profile).toBeNull();
    expect(result.offers).toEqual([]);
    expect(result.recommendation.status).toBe("none");
  });

  it("labels every result as synthetic and modeled", async () => {
    const result = await compareScenario(app.deps, scenario({ tariff: "evening_x2" }));
    expect(result.assumptions.provenance).toBe("SYNTHETIC");
    expect(result.assumptions.tariff).toMatch(/doubled/);
  });

  it("writes no quote or reservation rows", async () => {
    const before = [await count("quote_sets"), await count("reservations")];
    await compareScenario(app.deps, scenario({ portId: "port_c" }));
    await compareScenario(app.deps, scenario({ kWh: 55, readyByLocal: "20:00" }));
    expect([await count("quote_sets"), await count("reservations")]).toEqual(before);
  });
});
