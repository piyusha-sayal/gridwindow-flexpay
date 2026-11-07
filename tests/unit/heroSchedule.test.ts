import { describe, expect, it } from "vitest";
import { HERO_DEFAULT_READY_SLOT, HERO_EFFICIENCY_BP, HERO_PLUG_IN_SLOT, heroSchedule, heroTimeLabel } from "@/app/heroSchedule";
import { ASSUMED_EFFICIENCY_BP } from "@/server/services/quoteService";

describe("landing hero scheduler", () => {
  it("uses the server's charging efficiency", () => {
    expect(HERO_EFFICIENCY_BP).toBe(ASSUMED_EFFICIENCY_BP);
  });

  it("reproduces the recorded demo for a 07:00 ready-by: $16.80 list, $12.43 offer, charging 00:00–03:00", () => {
    const r = heroSchedule(HERO_DEFAULT_READY_SLOT);
    expect(r.kind).toBe("OFFER");
    if (r.kind !== "OFFER") return;
    expect(r).toMatchObject({ listCents: 1680, priceCents: 1243, discountCents: 437 });
    expect([heroTimeLabel(r.startSlot), heroTimeLabel(r.endSlot)]).toEqual(["00:00", "03:00"]);
    // Charge-now starts at plug-in at full power.
    expect(r.baselineW[HERO_PLUG_IN_SLOT]).toBe(11_000);
  });

  it("reports not enough time and no cheaper window instead of a price", () => {
    expect(heroSchedule(HERO_PLUG_IN_SLOT + 4).kind).toBe("NOT_ENOUGH_TIME");
    // Ready by 22:00: only the 46¢/30¢ hours charge-now would use anyway.
    expect(heroSchedule(16).kind).toBe("NO_CHEAPER_WINDOW");
  });
});
