import { describe, expect, it } from "vitest";
import { DEMO_STATION, type SessionPlan } from "@/domain/station";
import { buildEnvelope, checkPortCaps, effectiveDepartMs, envelopeBaseLoadW, validateDisturbance, validateWithEnvelope, violationsIntroducedBy, type DisturbanceRecord } from "@/domain/disturbance";
import { buildNightGrid, slotStartMs } from "@/domain/time";

const grid = buildNightGrid("2026-11-05", DEMO_STATION.timeZone);
const at = (slot: number) => slotStartMs(grid, slot);
const zeros = () => new Array<number>(grid.slotCount).fill(0);
const rec = (over: Partial<DisturbanceRecord>): DisturbanceRecord => ({
  reservationId: "res_1",
  portId: "port_c",
  type: "CHARGER_FAILURE",
  effectiveSlot: 4,
  params: {},
  ...over,
});

describe("buildEnvelope", () => {
  it("is the unconstrained station when nothing is recorded", () => {
    const env = buildEnvelope(DEMO_STATION, grid, []);
    expect(env.siteCapW.every((w) => w === DEMO_STATION.stationCapW)).toBe(true);
    expect(env.portCapW).toEqual({});
    expect(env.departMsByReservation).toEqual({});
  });

  it("lowers the site cap only from the effective slot", () => {
    const env = buildEnvelope(DEMO_STATION, grid, [rec({ type: "SITE_CAP_REDUCTION", portId: "port_a", params: { stationCapW: 12_000 } })]);
    expect(env.siteCapW[3]).toBe(DEMO_STATION.stationCapW);
    expect(env.siteCapW[4]).toBe(12_000);
    expect(env.siteCapW[grid.slotCount - 1]).toBe(12_000);
  });

  it("caps one port from the effective slot with an absolute or factor reduction", () => {
    const abs = buildEnvelope(DEMO_STATION, grid, [rec({ type: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 3_600 } })]);
    expect(abs.portCapW.port_c![3]).toBe(11_000);
    expect(abs.portCapW.port_c![4]).toBe(3_600);
    const factor = buildEnvelope(DEMO_STATION, grid, [rec({ type: "CHARGER_POWER_REDUCTION", params: { factorBp: 5_000 } })]);
    expect(factor.portCapW.port_c![4]).toBe(5_500);
  });

  it("sets the failed port to zero from the effective slot and leaves other ports alone", () => {
    const env = buildEnvelope(DEMO_STATION, grid, [rec({ type: "CHARGER_FAILURE" })]);
    expect(env.portCapW.port_c![4]).toBe(0);
    expect(env.portCapW.port_b).toBeUndefined();
  });

  it("takes the earliest early departure per reservation", () => {
    const env = buildEnvelope(DEMO_STATION, grid, [
      rec({ type: "EARLY_DEPARTURE", params: { departMs: at(30) } }),
      rec({ type: "EARLY_DEPARTURE", params: { departMs: at(20) } }),
    ]);
    expect(effectiveDepartMs(env, "res_1", at(60))).toBe(at(20));
    expect(effectiveDepartMs(env, "res_other", at(60))).toBe(at(60));
  });
});

describe("envelopeBaseLoadW", () => {
  it("adds the withheld site capacity as fixed load so the validator sees the lower cap", () => {
    const env = buildEnvelope(DEMO_STATION, grid, [rec({ type: "SITE_CAP_REDUCTION", params: { stationCapW: 12_000 } })]);
    const base = new Array<number>(grid.slotCount).fill(2_000);
    const adjusted = envelopeBaseLoadW(DEMO_STATION, base, env);
    expect(adjusted[3]).toBe(2_000);
    expect(adjusted[4]).toBe(2_000 + (DEMO_STATION.stationCapW - 12_000));
  });
});

describe("validateDisturbance", () => {
  const plugIn = at(0);
  const depart = at(grid.slotCount);
  const check = (r: Partial<DisturbanceRecord>) => validateDisturbance(DEMO_STATION, grid, { plugInMs: plugIn, departMs: depart }, rec(r));

  it("accepts a valid reduction of each type", () => {
    expect(check({ type: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 3_600 } })).toBeNull();
    expect(check({ type: "SITE_CAP_REDUCTION", params: { stationCapW: 12_000 } })).toBeNull();
    expect(check({ type: "EARLY_DEPARTURE", params: { departMs: at(40) } })).toBeNull();
    expect(check({ type: "CHARGER_FAILURE" })).toBeNull();
  });

  it("refuses a power reduction above the rated port power or below zero", () => {
    expect(check({ type: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 12_000 } })).toMatch(/rated/);
    expect(check({ type: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 0 } })).toMatch(/greater than zero/);
  });

  it("refuses a site cap that is not a reduction or leaves no headroom", () => {
    expect(check({ type: "SITE_CAP_REDUCTION", params: { stationCapW: DEMO_STATION.stationCapW } })).toMatch(/reduction/);
    expect(check({ type: "SITE_CAP_REDUCTION", params: { stationCapW: DEMO_STATION.safetyHeadroomW } })).toMatch(/headroom/);
  });

  it("refuses an early departure that is not earlier or precedes its own effective slot", () => {
    expect(check({ type: "EARLY_DEPARTURE", params: { departMs: depart } })).toMatch(/earlier/);
    expect(check({ type: "EARLY_DEPARTURE", params: { departMs: at(10) }, effectiveSlot: 12 })).toMatch(/effective slot/);
  });

  it("refuses an effective slot outside the night", () => {
    expect(check({ effectiveSlot: grid.slotCount })).toMatch(/slot/);
    expect(check({ effectiveSlot: -1 })).toMatch(/slot/);
  });
});

describe("validateWithEnvelope and checkPortCaps", () => {
  it("flags power above a reduced port limit only from the effective slot", () => {
    const env = buildEnvelope(DEMO_STATION, grid, [rec({ type: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 3_600 } })]);
    const powerW = zeros();
    powerW[2] = 7_200;
    powerW[6] = 7_200;
    const plan: SessionPlan = { sessionId: "res_1", portId: "port_c", plugInMs: at(0), departMs: at(grid.slotCount), powerW };
    const codes = checkPortCaps(DEMO_STATION, grid, env, [plan]);
    expect(codes.map((v) => v.slot)).toEqual([6]);
  });

  it("flags a committed plan that exceeds a reduced site cap", () => {
    const env = buildEnvelope(DEMO_STATION, grid, [rec({ type: "SITE_CAP_REDUCTION", params: { stationCapW: 10_000 } })]);
    const powerW = zeros();
    powerW[8] = 11_000;
    const plan: SessionPlan = { sessionId: "res_1", portId: "port_c", plugInMs: at(0), departMs: at(grid.slotCount), powerW };
    const violations = validateWithEnvelope({
      station: DEMO_STATION,
      grid,
      forecastBaseLoadW: zeros(),
      envelope: env,
      plans: [plan],
    });
    expect(violations.some((v) => v.code === "STATION_CAP" && v.slot === 8)).toBe(true);
  });
});

describe("violationsIntroducedBy (quoting, acceptance and the capacity commit share this rule)", () => {
  const plan = (sessionId: string, portId: string, slots: Record<number, number>): SessionPlan => {
    const powerW = zeros();
    for (const [slot, w] of Object.entries(slots)) powerW[Number(slot)] = w;
    return { sessionId, portId, plugInMs: at(0), departMs: at(grid.slotCount), powerW };
  };

  it("does not blame a new plan for another session's existing port-cap violation", () => {
    // Port B was cut to 2.4 kW from slot 4 and its session still holds a 7.2 kW plan (no feasible recovery).
    const env = buildEnvelope(DEMO_STATION, grid, [rec({ portId: "port_b", type: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 2_400 } })]);
    const committed = [plan("res_1", "port_b", { 4: 7_200, 5: 7_200, 6: 7_200 })];
    const candidate = plan("candidate", "port_c", { 4: 3_600, 5: 3_600 });
    const input = { station: DEMO_STATION, grid, forecastBaseLoadW: zeros(), envelope: env };
    expect(validateWithEnvelope({ ...input, plans: [...committed, candidate] }).length).toBeGreaterThan(0); // the old, all-plans check
    expect(violationsIntroducedBy({ ...input, committed, candidate })).toEqual([]);
  });

  it("still blames a new plan that draws power in a slot that is already over the site cap", () => {
    const env = buildEnvelope(DEMO_STATION, grid, [rec({ type: "SITE_CAP_REDUCTION", params: { stationCapW: 10_000 } })]);
    const committed = [plan("res_1", "port_c", { 8: 11_000 })];
    const input = { station: DEMO_STATION, grid, forecastBaseLoadW: zeros(), envelope: env, committed };
    const intoOverload = violationsIntroducedBy({ ...input, candidate: plan("candidate", "port_a", { 8: 3_600 }) });
    expect(intoOverload.some((v) => v.code === "STATION_CAP" && v.slot === 8)).toBe(true);
    expect(violationsIntroducedBy({ ...input, candidate: plan("candidate", "port_a", { 20: 3_600 }) })).toEqual([]);
  });

  it("checks the candidate's own energy target when one is given", () => {
    const env = buildEnvelope(DEMO_STATION, grid, []);
    const candidate = plan("candidate", "port_a", { 20: 3_600 });
    const short = violationsIntroducedBy({ station: DEMO_STATION, grid, forecastBaseLoadW: zeros(), envelope: env, committed: [], candidate, targets: [{ sessionId: "candidate", targetBatteryWh: 30_000, efficiencyBp: 9_200 }] });
    expect(short.length).toBeGreaterThan(0);
  });
});
