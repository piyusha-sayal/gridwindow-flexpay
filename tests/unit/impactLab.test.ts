import { describe, expect, it } from "vitest";
import { DEFAULT_SCENARIO, scenarioFromQuery, type ImpactScenarioInput } from "@/app/impact-lab/scenario";
import { SYNTHETIC_TARIFF } from "@/domain/forecast";
import { SYNTHETIC_ECONOMICS } from "@/domain/economics";
import { explainReason, recommend, tariffFor, type OfferView, type RejectedView } from "@/server/services/impactService";

const defaults: ImpactScenarioInput = { ...DEFAULT_SCENARIO, nightOf: "2026-11-09", plugInLocal: "19:00" };

const offer = (kind: OfferView["kind"], priceCents: number): OfferView => ({
  kind,
  label: kind,
  priceCents,
  savingCents: 100,
  profile: { startMs: 0, endMs: 0, peakKw: 3.6, durationMinutes: 60, powerW: [] },
});

describe("impact lab recommendation", () => {
  it("reports an exact price tie instead of choosing one offer", () => {
    const offers = [offer("flex_lowest_cost", 900), offer("flex_gentle", 900), offer("flex_early_finish", 1000)];
    const rec = recommend(offers, [], "lowest_price");
    expect(rec).toEqual({ status: "tie", kinds: ["flex_lowest_cost", "flex_gentle"], priceCents: 900 });
  });

  it("chooses the single cheapest offer when prices differ", () => {
    const offers = [offer("flex_lowest_cost", 900), offer("flex_gentle", 950)];
    expect(recommend(offers, [], "lowest_price")).toEqual({ status: "chosen", kind: "flex_lowest_cost" });
  });

  it("explains a missing preferred offer with its rejection reason", () => {
    const rejected: RejectedView[] = [{ kind: "flex_early_finish", label: "Ready 1 hour early", reason: "The window is too short." }];
    const rec = recommend([offer("flex_gentle", 900)], rejected, "finish_early");
    expect(rec.status).toBe("none");
    if (rec.status === "none") expect(rec.message).toContain("The window is too short.");
  });
});

describe("impact lab reasons and tariffs", () => {
  it("translates codes into plain English, including validator details", () => {
    expect(explainReason("DISCOUNT_BELOW_MINIMUM", SYNTHETIC_ECONOMICS)).toContain("$0.25");
    expect(explainReason("VALIDATOR_REJECTED: STATION_CAP", SYNTHETIC_ECONOMICS)).not.toContain("STATION_CAP");
    expect(explainReason("SOMETHING_NEW", SYNTHETIC_ECONOMICS)).toBe("Not offered for an unrecognized reason.");
  });

  it("doubles only the evening band on a copy and leaves the shared tariff unchanged", () => {
    const doubled = tariffFor("evening_x2");
    const evening = doubled.bands.find((b) => b.fromHour === 16)!;
    expect(evening.mcPerKWh).toBe(SYNTHETIC_TARIFF.bands.find((b) => b.fromHour === 16)!.mcPerKWh * 2);
    expect(SYNTHETIC_TARIFF.bands.find((b) => b.fromHour === 16)!.mcPerKWh).toBe(46_000);
    expect(tariffFor("standard")).toBe(SYNTHETIC_TARIFF);
  });
});

describe("impact lab query parsing", () => {
  it("keeps valid parameters and ignores bad ones", () => {
    const s = scenarioFromQuery(
      { portId: "port_c", kWh: "42.5", plugInLocal: "25:99", readyByLocal: "06:30", preference: "gentle", tariff: "bogus", nightOf: "not-a-date" },
      defaults,
    );
    expect(s.portId).toBe("port_c");
    expect(s.kWh).toBe(42.5);
    expect(s.plugInLocal).toBe("19:00");
    expect(s.readyByLocal).toBe("06:30");
    expect(s.preference).toBe("gentle");
    expect(s.tariff).toBe("standard");
    expect(s.nightOf).toBe("2026-11-09");
  });

  it("rejects unknown ports and out-of-range energy", () => {
    const s = scenarioFromQuery({ portId: "port_z", kWh: "500" }, defaults);
    expect(s.portId).toBe(DEFAULT_SCENARIO.portId);
    expect(s.kWh).toBe(defaults.kWh);
  });
});
