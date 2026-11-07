import { describe, expect, it } from "vitest";
import { heroTariffMc } from "@/app/heroSchedule";
import { FIXED_NIGHT_AXIS, quoteAxis, slotTariffMc, tariffBands } from "@/app/drive/NightAxis";
import { axisMinutes, formatDuration, summarizeRequest, summarySentence } from "@/app/drive/requestSummary";

describe("driver request summary (display only)", () => {
  it("places evening times tonight and morning times on the next morning, like the server", () => {
    expect(axisMinutes("18:00")).toBe(0);
    expect(axisMinutes("19:00")).toBe(60);
    expect(axisMinutes("07:00")).toBe(13 * 60);
    expect(axisMinutes("7:00")).toBeNull();
  });

  it("computes parked and full-power charging time with the assumed efficiency", () => {
    const s = summarizeRequest({ plugInLocal: "19:00", departLocal: "07:00", targetBatteryKWh: "30" }, 11_000)!;
    expect(s.parkedMin).toBe(12 * 60);
    // 30 kWh / 0.92 = 32 609 Wh at 11 kW = 177.87 min, rounded up.
    expect(s.chargeMin).toBe(178);
    expect(summarySentence(s)).toBe("You're parked 12 h and need about 2 h 58 min of charging, so we have 9 h 2 min to find cheaper hours.");
  });

  it("returns nothing for incomplete input and explains when time is short", () => {
    expect(summarizeRequest({ plugInLocal: "19:00", departLocal: "18:00", targetBatteryKWh: "30" }, 11_000)).toBeNull();
    expect(summarizeRequest({ plugInLocal: "19:00", departLocal: "07:00", targetBatteryKWh: "" }, 11_000)).toBeNull();
    const short = summarizeRequest({ plugInLocal: "05:00", departLocal: "07:00", targetBatteryKWh: "120" }, 11_000)!;
    expect(summarySentence(short)).toMatch(/^You're parked 2 h but need about .* at 11 kW\./);
    expect(formatDuration(45)).toBe("45 min");
  });
});

describe("night axis", () => {
  it("labels the fixed axis 18:00 → 10:00 and matches the landing tariff", () => {
    expect(FIXED_NIGHT_AXIS.label(0)).toBe("18:00");
    expect(FIXED_NIGHT_AXIS.label(64)).toBe("10:00");
    expect(slotTariffMc(FIXED_NIGHT_AXIS)).toEqual(heroTariffMc());
  });

  it("labels a quote grid in the station time zone and merges equal tariff slots", () => {
    const startMs = Date.UTC(2026, 10, 20, 2, 0); // 18:00 PST
    const axis = quoteAxis({ startMs, slotCount: 64 }, "America/Los_Angeles");
    expect(axis.label(0)).toBe("18:00");
    expect(tariffBands(slotTariffMc(axis)).map((b) => [b.from, b.to, b.mc])).toEqual([
      [0, 12, 46_000],
      [12, 24, 30_000],
      [24, 48, 14_000],
      [48, 64, 24_000],
    ]);
  });
});
