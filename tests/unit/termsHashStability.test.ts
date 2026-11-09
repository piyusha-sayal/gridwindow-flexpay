import { describe, expect, it } from "vitest";
import { SETTLEMENT_POLICY_V1, termsHash, type OfferTerms } from "@/domain/terms";

/**
 * Regression guard: hashes of agreements already stored must stay byte-identical. The fixtures are fixed literals and
 * the expected hashes were recorded before the attribution change. A change here breaks every stored agreement.
 */
const fixture: Omit<OfferTerms, "settlementPolicy"> = {
  version: "gw-terms-v1",
  quoteSetId: "qs_fixture_1",
  offerId: "offer_fixture_1",
  stationId: "DEMO_STATION",
  merchantRef: "mock-merchant",
  portId: "port_c",
  currency: "USD",
  amountCents: 693,
  listPriceCents: 800,
  targetBatteryWh: 15000,
  efficiencyBp: 9200,
  plugInMs: 1762398000000,
  departMs: 1762425600000,
  gridStartMs: 1762396800000,
  powerW: [0, 0, 3800, 3800, 4000, 0],
  expiresAtMs: 1762400000000,
};

describe("stored agreement hashes are stable", () => {
  it("a legacy agreement (no settlementPolicy field) keeps its hash", () => {
    expect(termsHash(fixture)).toBe("5cfad5f694cf4c22f5ea2469283bdf796d229bd3b624d0fcf89de565d90ebd64");
  });

  it("an agreement already carrying OPERATOR_FAILURE_FULL_VOID_V1 keeps its hash", () => {
    expect(termsHash({ ...fixture, settlementPolicy: SETTLEMENT_POLICY_V1 })).toBe("cf31e5fbe3fd07c1f15df0a94a81b5f2bc1be14666f4cebd743a03a7b8094e72");
  });
});
