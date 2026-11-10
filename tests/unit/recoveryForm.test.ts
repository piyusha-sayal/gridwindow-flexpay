import { describe, expect, it } from "vitest";
import { attributionStatusText } from "@/components/recoveryCopy";
import { DISTURBANCE_TYPES, type DisturbanceType } from "@/domain/disturbance";
import { FAULT_ATTRIBUTIONS, type FaultAttribution } from "@/domain/faultAttribution";
import { attributionChoices, buildInjection, DEFAULT_ATTRIBUTION, nextAttribution, type InjectionDraft } from "@/app/operator/recoveryForm";

const EVENT_ID = "evt_form_0001";
const DEPART_MS = Date.parse("2026-11-06T07:00:00Z");

function draft(overrides: Partial<InjectionDraft> = {}): InjectionDraft {
  return { type: "CHARGER_FAILURE", reservationId: "res_form_1", effectiveSlot: 3, value: 1800, attribution: DEFAULT_ATTRIBUTION, ...overrides };
}

function allowedFor(type: DisturbanceType): FaultAttribution[] {
  return attributionChoices(type)
    .filter((c) => c.allowed)
    .map((c) => c.value);
}

describe("attribution choices", () => {
  it("defaults to UNKNOWN, which every disturbance type allows", () => {
    expect(DEFAULT_ATTRIBUTION).toBe("UNKNOWN");
    for (const type of DISTURBANCE_TYPES) expect(allowedFor(type)).toContain("UNKNOWN");
  });

  it("lists every attribution in a fixed order, marking the server's allowed values for each type", () => {
    expect(attributionChoices("EARLY_DEPARTURE").map((c) => c.value)).toEqual([...FAULT_ATTRIBUTIONS]);
    expect(allowedFor("EARLY_DEPARTURE")).toEqual(["DRIVER", "UNKNOWN"]);
    expect(allowedFor("SITE_CAP_REDUCTION")).toEqual(["OPERATOR", "EXTERNAL", "UNKNOWN"]);
    expect(allowedFor("CHARGER_POWER_REDUCTION")).toEqual([...FAULT_ATTRIBUTIONS]);
    expect(allowedFor("CHARGER_FAILURE")).toEqual([...FAULT_ATTRIBUTIONS]);
  });

  it("keeps the operator's choice when the new type allows it, and falls back to UNKNOWN otherwise", () => {
    expect(nextAttribution("OPERATOR", "CHARGER_FAILURE")).toBe("OPERATOR");
    expect(nextAttribution("OPERATOR", "EARLY_DEPARTURE")).toBe("UNKNOWN");
    expect(nextAttribution("EXTERNAL", "EARLY_DEPARTURE")).toBe("UNKNOWN");
    expect(nextAttribution("DRIVER", "SITE_CAP_REDUCTION")).toBe("UNKNOWN");
  });

  it("never selects OPERATOR on its own: switching types from UNKNOWN keeps UNKNOWN", () => {
    for (const type of DISTURBANCE_TYPES) expect(nextAttribution("UNKNOWN", type)).toBe("UNKNOWN");
  });
});

describe("buildInjection carries the attribution", () => {
  it("sends the attribution exactly as the operator chose it", () => {
    const built = buildInjection(draft({ attribution: "OPERATOR" }), DEPART_MS, EVENT_ID);
    expect(built).toMatchObject({ ok: true, request: { type: "CHARGER_FAILURE", attribution: "OPERATOR", params: {} } });
  });

  it("sends UNKNOWN when the operator leaves the default", () => {
    const built = buildInjection(draft(), DEPART_MS, EVENT_ID);
    expect(built).toMatchObject({ ok: true, request: { attribution: "UNKNOWN" } });
  });

  it("refuses a value the disturbance type does not allow, before any request is made", () => {
    const built = buildInjection(draft({ type: "EARLY_DEPARTURE", value: 60, attribution: "OPERATOR" }), DEPART_MS, EVENT_ID);
    expect(built).toEqual({ ok: false, message: "OPERATOR cannot be recorded for this disturbance type." });
  });

  it("still validates the other fields alongside the attribution", () => {
    const built = buildInjection(draft({ type: "CHARGER_POWER_REDUCTION", value: 0 }), DEPART_MS, EVENT_ID);
    expect(built.ok).toBe(false);
  });
});

describe("attributionStatusText", () => {
  it("states the recorded attribution with its confirmation status in words", () => {
    expect(attributionStatusText("UNKNOWN")).toBe("Fault attribution: UNKNOWN (not confirmed)");
    expect(attributionStatusText("OPERATOR")).toBe("Fault attribution: OPERATOR (confirmed)");
    expect(attributionStatusText("EXTERNAL")).toBe("Fault attribution: EXTERNAL (not an operator cause)");
    expect(attributionStatusText("DRIVER")).toBe("Fault attribution: DRIVER (not an operator cause)");
  });
});
