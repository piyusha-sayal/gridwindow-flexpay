/** Provider identity on operator rows (audit I9). Display only: no provider call, no state change. */
import { describe, expect, it } from "vitest";
import { rowProvider } from "@/app/operator/metrics";

describe("rowProvider", () => {
  it("labels a row by its own provider mode and does not flag a matching row", () => {
    expect(rowProvider({ providerMode: "PAYPAL_SANDBOX" }, "PAYPAL_SANDBOX")).toEqual({ label: "PayPal Sandbox", mismatch: false, note: null });
    expect(rowProvider({ providerMode: "MOCK" }, "MOCK")).toMatchObject({ label: "MOCK (simulated)", mismatch: false, note: null });
  });

  it("flags a MOCK row on a sandbox server so it is not read as a real payment failure", () => {
    const p = rowProvider({ providerMode: "MOCK" }, "PAYPAL_SANDBOX");
    expect(p.mismatch).toBe(true);
    expect(p.label).toBe("MOCK (simulated)");
    expect(p.note).toContain("Created under MOCK (simulated)");
    expect(p.note).toContain("runs PayPal Sandbox");
  });

  it("flags a sandbox row on a MOCK server", () => {
    expect(rowProvider({ providerMode: "PAYPAL_SANDBOX" }, "MOCK").mismatch).toBe(true);
  });

  it("keeps an unknown mode visible instead of hiding it", () => {
    expect(rowProvider({ providerMode: "SOMETHING_ELSE" }, "MOCK")).toMatchObject({ label: "SOMETHING_ELSE", mismatch: true });
  });
});
