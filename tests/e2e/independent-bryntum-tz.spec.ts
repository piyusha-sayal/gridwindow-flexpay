import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Browser } from "@playwright/test";
import { OPERATOR_STATE } from "./constants";

/**
 * Independent QA: does the real Bryntum time axis agree with the station-zone table, whatever zone the operator's
 * browser is in, including across DST transitions? Synthetic nights only (MOCK mode, throwaway database).
 *
 * Result recorded as defect QA-3: the Bryntum axis is drawn in the BROWSER's zone, the table and labels in the
 * STATION zone. Bars are positioned by absolute time (correct); only the axis tick labels disagree for an operator
 * outside the station zone. The cross-zone assertions below are therefore marked test.fail(): they document the
 * defect without weakening the check, and will start failing loudly (as "unexpected pass") once it is fixed.
 */
const ORIGIN = "http://localhost:3107";
const STATION_ZONE = "America/Los_Angeles";
const SPRING = "2027-03-13"; // 2027-03-14 02:00 PST -> 03:00 PDT
const FALL = "2027-11-06"; // 2027-11-07 02:00 PDT -> 01:00 PST
const OTHER_ZONES = ["Asia/Kolkata", "UTC"];

async function seed(request: APIRequestContext, night: string): Promise<void> {
  const existing = await request.get(`/api/schedule?nightOf=${night}`);
  expect(existing.ok()).toBe(true);
  if ((((await existing.json()) as { schedule: { sessions: unknown[] } }).schedule.sessions ?? []).length > 0) return;
  const res = await request.post("/api/operator/demo", { data: { action: "seed", nightOf: night }, headers: { Origin: ORIGIN } });
  expect(res.ok(), `seed ${night}`).toBe(true);
}

interface View {
  axis: string[];
  hourLabels: string[];
  caption: string;
  rows: string[];
}

const record: Record<string, View> = {};

async function view(browser: Browser, night: string, timezoneId: string): Promise<View> {
  const ctx = await browser.newContext({ storageState: OPERATOR_STATE, timezoneId, viewport: { width: 1440, height: 900 } });
  try {
    const page = await ctx.newPage();
    await page.goto(`/operator/schedule?night=${night}`);
    await expect(page.locator(".b-scheduler").first()).toBeVisible();
    const table = page.getByRole("table");
    const axis = (await page.locator(".b-sch-header-text").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
    const v: View = {
      axis,
      hourLabels: axis.filter((t) => /^\d{1,2} (AM|PM)( P[DS]T)?$/.test(t)),
      caption: (await table.locator("caption").innerText()).trim().toLowerCase(),
      rows: await table.locator("tbody tr").allInnerTexts(),
    };
    record[`${night}|${timezoneId}`] = v;
    return v;
  } finally {
    await ctx.close();
  }
}

test.describe("Bryntum axis versus station-zone table (real browser, DST nights, three browser zones)", () => {
  test.use({ storageState: OPERATOR_STATE });
  test.setTimeout(180_000);

  for (const night of [SPRING, FALL]) {
    test(`${night}: the table and its caption are station-zone and identical in every browser zone`, async ({ browser, request }) => {
      await seed(request, night);
      const views = [await view(browser, night, STATION_ZONE), ...(await Promise.all(OTHER_ZONES.map((z) => view(browser, night, z))))];
      for (const v of views) expect(v.caption).toContain(STATION_ZONE.toLowerCase());
      expect(new Set(views.map((v) => JSON.stringify([v.caption, v.rows]))).size).toBe(1);
    });
  }

  test("spring forward: in the station zone the axis skips 2 AM (1 AM then 3 AM)", async ({ browser, request }) => {
    await seed(request, SPRING);
    const { hourLabels } = await view(browser, SPRING, STATION_ZONE);
    const i = hourLabels.indexOf("1 AM");
    expect(i).toBeGreaterThan(-1);
    expect(hourLabels.slice(i, i + 2)).toEqual(["1 AM", "3 AM"]);
    expect(hourLabels).not.toContain("2 AM");
  });

  test("fall back: in the station zone the axis shows 1 AM twice, so the repeated hour is not hidden", async ({ browser, request }) => {
    await seed(request, FALL);
    const { hourLabels } = await view(browser, FALL, STATION_ZONE);
    expect(hourLabels.filter((t) => t.startsWith("1 AM"))).toEqual(["1 AM PDT", "1 AM PST"]);
  });

  for (const night of [SPRING, FALL]) {
    for (const zone of OTHER_ZONES) {
      // UTC is hour-aligned with the station zone and now matches (station-time axis labels). A half-hour-offset browser
      // (Asia/Kolkata) still gets tick boundaries from its own zone: the remaining QA-3 residual, kept as test.fail.
      test(`QA-3${zone === "UTC" ? " (fixed)" : " (known residual)"} ${night}: axis labels for a browser in ${zone} equal the station-zone axis`, async ({ browser, request }) => {
        if (zone !== "UTC") test.fail(true, "QA-3 residual: native tick boundaries follow a half-hour-offset browser zone");
        await seed(request, night);
        const station = await view(browser, night, STATION_ZONE);
        const other = await view(browser, night, zone);
        expect(other.hourLabels).toEqual(station.hourLabels);
      });
    }
  }

  test("evidence: write the observed axis labels per browser zone", async () => {
    mkdirSync("artifacts/qa/evidence", { recursive: true });
    const out = Object.fromEntries(Object.entries(record).map(([k, v]) => [k, { axis: v.axis, firstTableRow: v.rows[0]?.replace(/\s+/g, " ") }]));
    writeFileSync("artifacts/qa/evidence/bryntum-axis-by-browser-zone.json", JSON.stringify({ label: "SYNTHETIC", stationZone: STATION_ZONE, observed: out }, null, 2));
    expect(Object.keys(record).length).toBeGreaterThan(0);
  });
});
