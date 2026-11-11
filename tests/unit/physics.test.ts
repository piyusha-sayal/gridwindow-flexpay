import { describe, expect, it } from "vitest";
import { allocate, type AllocationContext } from "@/domain/allocator";
import { SYNTHETIC_TARIFF, touSeries } from "@/domain/forecast";
import { DEMO_STATION, type ChargeRequest, type SessionPlan, type StationConfig } from "@/domain/station";
import { buildNightGrid, slotStartMs } from "@/domain/time";
import { batteryMilliWhFromGridWh, centsToUsd, requiredGridWh, slotGridWh, usdToCents } from "@/domain/units";
import { validatePlans } from "@/domain/validator";

const grid = buildNightGrid("2026-10-20", DEMO_STATION.timeZone);
const at = (slot: number) => slotStartMs(grid, slot);

function ctx(station: StationConfig, baseLoadW = 0, committed: SessionPlan[] = []): AllocationContext {
  return {
    station,
    grid,
    tariff: SYNTHETIC_TARIFF,
    touMc: touSeries(SYNTHETIC_TARIFF, grid),
    baseLoadW: new Array(grid.slotCount).fill(baseLoadW),
    committed,
  };
}

function stationWithPortPower(maxPowerW: number): StationConfig {
  return { ...DEMO_STATION, safetyHeadroomW: 0, ports: DEMO_STATION.ports.map((p) => ({ ...p, maxPowerW })) };
}

/** 01:00-04:00 local on the 2026-10-20 night = slots 28..39 (grid starts 18:00). */
const oneToFour = (overrides: Partial<ChargeRequest> = {}): ChargeRequest => ({
  portId: "port_a",
  plugInMs: at(28),
  departMs: at(40),
  targetBatteryWh: 30_000,
  efficiencyBp: 9_200,
  spendCapCents: 100_00,
  ...overrides,
});

describe("unit math", () => {
  it("computes the reference energy numbers exactly", () => {
    expect(slotGridWh(11_000)).toBe(2_750);
    expect(batteryMilliWhFromGridWh(33_000, 9_200)).toBe(30_360_000); // 30.36 kWh
    expect(batteryMilliWhFromGridWh(21_600, 9_200)).toBe(19_872_000); // 19.872 kWh
    expect(requiredGridWh(30_000, 9_200)).toBe(32_609); // 32.6087 kWh rounded up
  });

  it("round-trips cents without floats", () => {
    expect(centsToUsd(1234)).toBe("12.34");
    expect(centsToUsd(5)).toBe("0.05");
    expect(usdToCents("12.34")).toBe(1234);
    expect(usdToCents("7")).toBe(700);
    expect(usdToCents("0.1")).toBe(10);
    expect(() => usdToCents("1e3")).toThrow();
    expect(() => usdToCents("-1.00")).toThrow();
    expect(() => usdToCents("1.234")).toThrow();
  });
});

describe("allocator physics", () => {
  it("30 kWh in 3 h is feasible at 11 kW / 92%", () => {
    const res = allocate(ctx(stationWithPortPower(11_000)), oneToFour(), { kind: "immediate" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.batteryMilliWh).toBeGreaterThanOrEqual(30_000_000);
    expect(res.powerW.every((w) => w <= 11_000)).toBe(true);
    expect(res.firstActiveSlot).toBeGreaterThanOrEqual(28);
    expect(res.lastActiveSlot).toBeLessThanOrEqual(39);
  });

  it("30 kWh in 3 h is infeasible at 7.2 kW", () => {
    const res = allocate(ctx(stationWithPortPower(7_200)), oneToFour(), { kind: "immediate" });
    expect(res).toMatchObject({ ok: false, reason: "INSUFFICIENT_CAPACITY" });
    const opt = allocate(ctx(stationWithPortPower(7_200)), oneToFour(), { kind: "optimized" });
    expect(opt).toMatchObject({ ok: false, reason: "INSUFFICIENT_CAPACITY" });
  });

  it("never charges outside the plugged-in window", () => {
    const res = allocate(ctx(DEMO_STATION), oneToFour({ targetBatteryWh: 10_000, plugInMs: at(10), departMs: at(50) }), { kind: "optimized" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    res.powerW.forEach((w, i) => {
      if (i < 10 || i >= 50) expect(w).toBe(0);
    });
  });

  it("refuses a second vehicle on an occupied port", () => {
    const parked: SessionPlan = { sessionId: "s1", portId: "port_a", plugInMs: at(0), departMs: at(60), powerW: new Array(grid.slotCount).fill(0) };
    const res = allocate(ctx(DEMO_STATION, 0, [parked]), oneToFour(), { kind: "optimized" });
    expect(res).toMatchObject({ ok: false, reason: "PORT_OCCUPIED" });
  });

  it("parked vehicle still occupies its port even after its charging finished", () => {
    const power = new Array(grid.slotCount).fill(0);
    power[0] = 11_000;
    const parked: SessionPlan = { sessionId: "s1", portId: "port_b", plugInMs: at(0), departMs: at(60), powerW: power };
    const res = allocate(ctx(DEMO_STATION, 0, [parked]), oneToFour({ portId: "port_b" }), { kind: "immediate" });
    expect(res).toMatchObject({ ok: false, reason: "PORT_OCCUPIED" });
  });

  it("three 11 kW ports with base load never exceed the 33 kW station cap", () => {
    const station = DEMO_STATION;
    const c = ctx(station, 6_000);
    const committed: SessionPlan[] = [];
    for (const port of station.ports) {
      const req: ChargeRequest = { ...oneToFour({ portId: port.id, plugInMs: at(4), departMs: at(56), targetBatteryWh: 40_000 }) };
      const res = allocate({ ...c, committed }, req, { kind: "immediate" });
      expect(res.ok).toBe(true);
      if (res.ok) committed.push({ sessionId: port.id, portId: port.id, plugInMs: req.plugInMs, departMs: req.departMs, powerW: res.powerW });
    }
    const violations = validatePlans(station, grid, c.baseLoadW, committed, station.ports.map((p) => ({ sessionId: p.id, targetBatteryWh: 40_000, efficiencyBp: 9_200 })));
    expect(violations).toEqual([]);
    for (let i = 0; i < grid.slotCount; i++) {
      const load = 6_000 + committed.reduce((s, p) => s + (p.powerW[i] ?? 0), 0);
      expect(load).toBeLessThanOrEqual(station.stationCapW - station.safetyHeadroomW);
    }
  });

  it("optimized policy never costs more than immediate for the same request", () => {
    const c = ctx(DEMO_STATION, 4_000);
    const req = oneToFour({ plugInMs: at(0), departMs: at(52), targetBatteryWh: 25_000 });
    const imm = allocate(c, req, { kind: "immediate" });
    const opt = allocate(c, req, { kind: "optimized" });
    expect(imm.ok && opt.ok).toBe(true);
    if (imm.ok && opt.ok) expect(opt.costMicrocents).toBeLessThanOrEqual(imm.costMicrocents);
  });
});

describe("independent validator", () => {
  const empty = () => new Array<number>(grid.slotCount).fill(0);

  it("flags station cap, port cap, unplugged charging, double booking and shortfall", () => {
    const p1 = empty();
    p1[30] = 12_000; // port cap
    p1[2] = 4_000; // unplugged (plug-in at slot 28)
    const p2 = empty();
    p2[30] = 11_000;
    const p3 = empty();
    p3[30] = 11_000;
    const plans: SessionPlan[] = [
      { sessionId: "x", portId: "port_a", plugInMs: at(28), departMs: at(40), powerW: p1 },
      { sessionId: "y", portId: "port_b", plugInMs: at(28), departMs: at(40), powerW: p2 },
      { sessionId: "z", portId: "port_b", plugInMs: at(30), departMs: at(45), powerW: p3 },
    ];
    const codes = validatePlans(DEMO_STATION, grid, empty(), plans, [{ sessionId: "y", targetBatteryWh: 30_000, efficiencyBp: 9_200 }]).map((v) => v.code);
    expect(codes).toEqual(expect.arrayContaining(["PORT_POWER_CAP", "CHARGING_WHILE_UNPLUGGED", "STATION_CAP", "PORT_DOUBLE_BOOKED", "ENERGY_SHORTFALL"]));
  });

  it("flags non-integer and negative power", () => {
    const p = empty();
    p[30] = 1_000.5;
    p[31] = -100;
    const codes = validatePlans(DEMO_STATION, grid, empty(), [{ sessionId: "x", portId: "port_a", plugInMs: at(0), departMs: at(60), powerW: p }]).map((v) => v.code);
    expect(codes).toEqual(expect.arrayContaining(["NON_INTEGER_POWER", "NEGATIVE_POWER"]));
  });
});

describe("time zones", () => {
  it("builds a 64-slot night on a normal date and a 68-slot night across DST end", () => {
    expect(buildNightGrid("2026-10-20", "America/Los_Angeles").slotCount).toBe(64);
    // US DST ends 2026-11-01 02:00 local: 18:00 Oct 31 -> 10:00 Nov 1 is 17 real hours.
    expect(buildNightGrid("2026-10-31", "America/Los_Angeles").slotCount).toBe(68);
    // DST start 2026-03-08: 18:00 Mar 7 -> 10:00 Mar 8 is 15 real hours.
    expect(buildNightGrid("2026-03-07", "America/Los_Angeles").slotCount).toBe(60);
  });
});
