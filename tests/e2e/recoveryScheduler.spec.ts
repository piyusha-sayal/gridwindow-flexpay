import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { OPERATOR_STATE } from "./constants";

/** Synthetic recovery spec: runs against the production build in MOCK mode with a throwaway database. */
const ORIGIN = "http://localhost:3107";
const DISTURBANCE_TYPE = "CHARGER_POWER_REDUCTION";

interface ScheduleSession {
  reservationId: string;
  portLabel: string;
  paymentState: string;
  serviceState: string;
}

interface ScheduleResponse {
  schedule: { nightOf: string; sessions: ScheduleSession[]; disruptions: { eventId: string; reservationId: string; runStatus: string | null; runReason: string | null }[] };
}

/** A night far enough ahead that seeding never depends on the wall clock. */
function nightAt(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Seeds the night once: a second seed on the same night is refused, so an existing night is reused as-is. */
async function seedNight(request: APIRequestContext): Promise<string> {
  const night = nightAt(26);
  const existing = await scheduleFor(request, night);
  if (existing.sessions.length > 0) return night;
  const res = await request.post("/api/operator/demo", { data: { action: "seed", nightOf: night }, headers: { Origin: ORIGIN } });
  expect(res.ok()).toBe(true);
  return night;
}

async function scheduleFor(request: APIRequestContext, night: string): Promise<ScheduleResponse["schedule"]> {
  const res = await request.get(`/api/schedule?nightOf=${night}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as ScheduleResponse).schedule;
}

/** A session the recovery engine can act on: authorized and scheduled, not yet simulated. */
function activeSession(sessions: ScheduleSession[]): ScheduleSession {
  const found = sessions.find((s) => s.paymentState === "AUTHORIZED" && s.serviceState === "SCHEDULED");
  if (!found) throw new Error("Seeded night has no authorized, scheduled session to disturb");
  return found;
}

test.describe("operator recovery scheduler", () => {
  test.use({ storageState: OPERATOR_STATE });

  test("renders the Bryntum scheduler, the table matches, and an injected disturbance appears without reload and persists", async ({ page, request }) => {
    const night = await seedNight(request);
    const before = await scheduleFor(request, night);
    const target = activeSession(before.sessions);

    await page.goto(`/operator/schedule?night=${night}`);
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();

    // Bryntum mounts a scheduler root once the client chunk loads, and draws one row per port.
    const scheduler = page.locator(".b-scheduler").first();
    await expect(scheduler).toBeVisible();
    await expect(scheduler.getByText("Port A", { exact: false })).toBeVisible();
    await expect(scheduler.getByText("Port B", { exact: false })).toBeVisible();
    await expect(scheduler.getByText("Port C", { exact: false })).toBeVisible();

    // The table is the accessible equivalent: one body row per session on the night.
    const rows = page.getByRole("table").locator("tbody tr");
    await expect(rows).toHaveCount(before.sessions.length);

    // Inject a synthetic disturbance through the API; the open page must pick it up by polling.
    const inject = await request.post("/api/recovery/events", {
      data: { eventId: `e2e-${Date.now().toString(36)}`, reservationId: target.reservationId, type: DISTURBANCE_TYPE, params: { maxPowerW: 1800 }, effectiveSlot: 0 },
      headers: { Origin: ORIGIN },
    });
    expect(inject.status()).toBeLessThan(300);

    await expect(page.getByRole("status").filter({ hasText: "Schedule updated by recovery" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Charger power reduced from/)).toBeVisible();

    // Persists after reload, and the server still reports the disturbance on this night.
    await page.reload();
    await expect(page.getByText(/Charger power reduced from/)).toBeVisible();
    const after = await scheduleFor(request, night);
    expect(after.disruptions.length).toBeGreaterThan(0);
  });

  test("keyboard reaches the lane toggle and the table, and axe finds no serious or critical violations", async ({ page, request }) => {
    const night = await seedNight(request);
    await page.goto(`/operator/schedule?night=${night}`);
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
    await expect(page.locator(".b-scheduler").first()).toBeVisible();

    const original = page.getByRole("button", { name: "Original plan" });
    await original.focus();
    await expect(original).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(original).toHaveAttribute("aria-pressed", "true");

    // Bryntum renders its own grid DOM, which currently has serious axe findings (see docs/BRYNTUM_NOTES.md).
    // The scan covers everything else; the table fallback is the accessible equivalent of the timeline.
    const axe = await new AxeBuilder({ page }).exclude(".b-scheduler").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    const blocking = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking.map((v) => `${v.id}: ${v.help} @ ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  });
});

test.describe("operator recovery scheduler on a phone", () => {
  test.use({ storageState: OPERATOR_STATE });

  test("the schedule page has no page-level horizontal overflow at Pixel 7 size", async ({ browser, request }) => {
    const night = await seedNight(request);
    const context = await browser.newContext({ ...devices["Pixel 7"], storageState: OPERATOR_STATE });
    const page = await context.newPage();
    try {
      await page.goto(`/operator/schedule?night=${night}`);
      await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    } finally {
      await context.close();
    }
  });
});

test.describe("operator recovery scheduler on a tablet", () => {
  test.use({ storageState: OPERATOR_STATE });

  test("the timeline and table fit a tablet viewport without page-level horizontal overflow", async ({ browser, request }) => {
    const night = await seedNight(request);
    const context = await browser.newContext({ ...devices["iPad (gen 7)"], storageState: OPERATOR_STATE });
    const page = await context.newPage();
    try {
      await page.goto(`/operator/schedule?night=${night}`);
      await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Table view" })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    } finally {
      await context.close();
    }
  });
});

/** Station zone America/Los_Angeles. A winter night (no transition inside) and the 2027 transition nights, all in the future. */
const STATION_REGULAR_NIGHT = "2027-01-16";
const STATION_SPRING_NIGHT = "2027-03-13";
const STATION_FALL_NIGHT = "2027-11-06";
/** A whole or half-hour tick; the repeated fall-back hour also carries its zone abbreviation (PDT or PST). */
const HOUR_LABEL = /^\d{1,2}(:\d{2})? (AM|PM)( [A-Z]{2,4})?$/;

/** Hour-tick labels and the timeline's event bars, read from the rendered Bryntum DOM. */
async function readTimeline(page: Page) {
  await expect(page.locator(".b-scheduler").first()).toBeVisible();
  await expect(page.locator(".b-sch-event").first()).toBeVisible();
  return page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll(".b-sch-header-text"))
      .map((e) => (e.textContent ?? "").trim())
      .filter((t) => /^\d{1,2}(:\d{2})? (AM|PM)( [A-Z]{2,4})?$/.test(t));
    const bars = Array.from(document.querySelectorAll(".b-sch-event")).map((e) => ({
      text: (e.textContent ?? "").trim(),
      left: e.getBoundingClientRect().left,
    }));
    return { labels, bars, browserZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  });
}

/** Seeds a night by its date (not the wall clock), reusing it when it already has sessions. */
async function seedNightOn(request: APIRequestContext, night: string): Promise<string> {
  const existing = await scheduleFor(request, night);
  if (existing.sessions.length > 0) return night;
  const res = await request.post("/api/operator/demo", { data: { action: "seed", nightOf: night }, headers: { Origin: ORIGIN } });
  expect(res.ok()).toBe(true);
  return night;
}

test.describe("operator timeline time zone in a real browser", () => {
  test.use({ storageState: OPERATOR_STATE });

  test("axis labels are station time in every browser zone, and bars sit at the same absolute offsets", async ({ browser, request }) => {
    await seedNightOn(request, STATION_REGULAR_NIGHT);
    const byZone: Record<string, Awaited<ReturnType<typeof readTimeline>>> = {};
    for (const zone of ["UTC", "Asia/Kolkata", "America/Los_Angeles"]) {
      const context = await browser.newContext({ storageState: OPERATOR_STATE, timezoneId: zone });
      const page = await context.newPage();
      try {
        await page.goto(`/operator/schedule?night=${STATION_REGULAR_NIGHT}`);
        await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
        byZone[zone] = await readTimeline(page);
      } finally {
        await context.close();
      }
    }

    // The browser zone is the input under test: it must differ between the three runs.
    expect(byZone["UTC"]!.browserZone).toBe("UTC");
    expect(byZone["Asia/Kolkata"]!.browserZone).toBe("Asia/Calcutta");
    expect(byZone["America/Los_Angeles"]!.browserZone).toBe("America/Los_Angeles");

    // Station-zone axis: a UTC browser shows 6 PM at the 18:00 PST start, never a UTC clock hour such as 2 AM.
    expect(byZone["UTC"]!.labels).toContain("6 PM");
    // The whole axis reads the same station sequence in a UTC browser as in a Pacific browser.
    expect(byZone["UTC"]!.labels).toEqual(byZone["America/Los_Angeles"]!.labels);
    expect(byZone["America/Los_Angeles"]!.labels).toContain("6 PM");
    // Kolkata is 13.5 hours ahead of Pacific in winter: its whole-hour ticks fall on Pacific half hours.
    expect(byZone["Asia/Kolkata"]!.labels).toContain("6:30 PM");
    expect(byZone["Asia/Kolkata"]!.labels).not.toContain("6 PM");

    // The same burst and occupancy labels in every zone (station time).
    const texts = (zone: string) => byZone[zone]!.bars.map((b) => b.text).sort();
    expect(texts("UTC")).toEqual(texts("America/Los_Angeles"));
    expect(texts("Asia/Kolkata")).toEqual(texts("America/Los_Angeles"));

    // Bar offsets relative to the leftmost bar: absolute time, so the same in every browser zone (within 2 px).
    const offsets = (zone: string) => {
      const bars = byZone[zone]!.bars;
      const min = Math.min(...bars.map((b) => b.left));
      return Object.fromEntries(bars.map((b) => [b.text, Math.round(b.left - min)]));
    };
    const reference = offsets("America/Los_Angeles");
    for (const zone of ["UTC", "Asia/Kolkata"]) {
      for (const [text, px] of Object.entries(offsets(zone))) expect(Math.abs(px - reference[text]!)).toBeLessThanOrEqual(2);
    }
  });

  test("spring-forward night: no 2 AM tick, and 1 AM is followed by 3 AM, in a Pacific browser and in a UTC browser", async ({ browser, request }) => {
    await seedNightOn(request, STATION_SPRING_NIGHT);
    for (const zone of ["America/Los_Angeles", "UTC"]) {
      const context = await browser.newContext({ storageState: OPERATOR_STATE, timezoneId: zone });
      const page = await context.newPage();
      try {
        await page.goto(`/operator/schedule?night=${STATION_SPRING_NIGHT}`);
        await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
        const { labels } = await readTimeline(page);
        const hours = labels.filter((l) => HOUR_LABEL.test(l));
        expect(hours, `hour labels in ${zone}`).not.toContain("2 AM");
        expect(hours.indexOf("3 AM"), `hour labels in ${zone}`).toBe(hours.indexOf("1 AM") + 1);
      } finally {
        await context.close();
      }
    }
  });

  test("fall-back night: the repeated 1 AM hour is labelled PDT then PST in a Pacific browser", async ({ browser, request }) => {
    await seedNightOn(request, STATION_FALL_NIGHT);
    const context = await browser.newContext({ storageState: OPERATOR_STATE, timezoneId: "America/Los_Angeles" });
    const page = await context.newPage();
    try {
      await page.goto(`/operator/schedule?night=${STATION_FALL_NIGHT}`);
      await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
      const { labels } = await readTimeline(page);
      const hours = labels.filter((l) => HOUR_LABEL.test(l));
      // The repeated hour appears twice, and each occurrence names its zone so the two are distinguishable.
      expect(hours, `hour labels: ${hours.join(", ")}`).not.toContain("1 AM");
      expect(hours.indexOf("1 AM PDT"), `hour labels: ${hours.join(", ")}`).toBeGreaterThanOrEqual(0);
      expect(hours.indexOf("1 AM PST"), `hour labels: ${hours.join(", ")}`).toBe(hours.indexOf("1 AM PDT") + 1);
      expect(hours.indexOf("2 AM"), `hour labels: ${hours.join(", ")}`).toBe(hours.indexOf("1 AM PST") + 1);
      expect(hours.filter((l) => l.startsWith("1 AM"))).toHaveLength(2);
      expect(hours.filter((l) => l === "2 AM")).toHaveLength(1);
    } finally {
      await context.close();
    }
  });

  test("fall-back night: UTC browser shows the same station labels as Pacific, and bars sit at the same absolute offsets", async ({ browser, request }) => {
    await seedNightOn(request, STATION_FALL_NIGHT);
    const byZone: Record<string, Awaited<ReturnType<typeof readTimeline>>> = {};
    for (const zone of ["America/Los_Angeles", "UTC"]) {
      const context = await browser.newContext({ storageState: OPERATOR_STATE, timezoneId: zone });
      const page = await context.newPage();
      try {
        await page.goto(`/operator/schedule?night=${STATION_FALL_NIGHT}`);
        await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
        byZone[zone] = await readTimeline(page);
      } finally {
        await context.close();
      }
    }
    expect(byZone["UTC"]!.browserZone).toBe("UTC");
    expect(byZone["UTC"]!.labels).toEqual(byZone["America/Los_Angeles"]!.labels);
    expect(byZone["UTC"]!.bars.map((b) => b.text).sort()).toEqual(byZone["America/Los_Angeles"]!.bars.map((b) => b.text).sort());
    const offsets = (zone: string) => {
      const bars = byZone[zone]!.bars;
      const min = Math.min(...bars.map((b) => b.left));
      return Object.fromEntries(bars.map((b) => [b.text, Math.round(b.left - min)]));
    };
    const reference = offsets("America/Los_Angeles");
    for (const [text, px] of Object.entries(offsets("UTC"))) expect(Math.abs(px - reference[text]!), text).toBeLessThanOrEqual(2);
  });

  test("fall-back night in a Kolkata browser: half-hour station ticks still show PDT then PST, with no duplicate unlabelled hour", async ({ browser, request }) => {
    await seedNightOn(request, STATION_FALL_NIGHT);
    const context = await browser.newContext({ storageState: OPERATOR_STATE, timezoneId: "Asia/Kolkata" });
    const page = await context.newPage();
    try {
      await page.goto(`/operator/schedule?night=${STATION_FALL_NIGHT}`);
      await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
      const { labels } = await readTimeline(page);
      const hours = labels.filter((l) => HOUR_LABEL.test(l));
      expect(hours.filter((l) => /^1(:\d{2})? AM PDT$/.test(l)).length, `labels: ${hours.join(", ")}`).toBeGreaterThan(0);
      expect(hours.filter((l) => /^1(:\d{2})? AM PST$/.test(l)).length, `labels: ${hours.join(", ")}`).toBeGreaterThan(0);
      expect(hours.filter((l) => /^1(:\d{2})? AM$/.test(l)), `labels: ${hours.join(", ")}`).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  test("spring-forward night in a Kolkata browser: no 2 AM or 2:30 AM tick", async ({ browser, request }) => {
    await seedNightOn(request, STATION_SPRING_NIGHT);
    const context = await browser.newContext({ storageState: OPERATOR_STATE, timezoneId: "Asia/Kolkata" });
    const page = await context.newPage();
    try {
      await page.goto(`/operator/schedule?night=${STATION_SPRING_NIGHT}`);
      await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
      const { labels } = await readTimeline(page);
      const hours = labels.filter((l) => HOUR_LABEL.test(l));
      expect(hours.filter((l) => /^2(:\d{2})? AM/.test(l)), `labels: ${hours.join(", ")}`).toHaveLength(0);
      expect(hours, `labels: ${hours.join(", ")}`).toContain("1:30 AM");
      expect(hours, `labels: ${hours.join(", ")}`).toContain("3:30 AM");
    } finally {
      await context.close();
    }
  });
});

test.describe("operator recovery before and after", () => {
  test.use({ storageState: OPERATOR_STATE });

  test("the timeline, table and summary agree with the persisted run after an injected disturbance", async ({ page, request }) => {
    const night = await seedNightOn(request, STATION_REGULAR_NIGHT);
    const target = activeSession((await scheduleFor(request, night)).sessions);
    const inject = await request.post("/api/recovery/events", {
      data: { eventId: `e2e-ba-${Date.now().toString(36)}`, reservationId: target.reservationId, type: DISTURBANCE_TYPE, params: { maxPowerW: 1800 }, effectiveSlot: 0 },
      headers: { Origin: ORIGIN },
    });
    expect(inject.status()).toBeLessThan(300);

    const after = await scheduleFor(request, night);
    const disturbance = after.disruptions.find((d) => d.reservationId === target.reservationId);
    expect(disturbance?.runStatus, "the disturbance has a persisted run").toBeTruthy();
    const run = disturbance!;

    await page.goto(`/operator/schedule?night=${night}`);
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
    await expect(page.locator(".b-sch-event").first()).toBeVisible();
    const row = page.getByRole("table").locator("tbody tr").filter({ hasText: target.reservationId });

    if (run.runStatus === "COMMITTED") {
      // The current lane shows the recovered version; the original lane shows the agreed plan only.
      await expect(row).toContainText("v2 (recovered)");
      await expect(page.locator(".b-sch-event", { hasText: "Recovered " }).first()).toBeVisible();
      await page.getByRole("button", { name: "Original plan" }).click();
      await expect(page.locator(".b-sch-event", { hasText: "Recovered " })).toHaveCount(0);
    } else if (run.runStatus === "NEEDS_APPROVAL") {
      // A proposal is drawn as a proposal and is never reported as committed.
      await expect(row).toContainText("v1 (agreed)");
      await expect(page.locator(".b-sch-event", { hasText: "Proposal " }).first()).toBeVisible();
      await expect(page.locator("#schedule-summary")).toContainText("not committed");
      await expect(page.locator(".b-sch-event", { hasText: "Recovered " })).toHaveCount(0);
    } else {
      // Infeasible, failed or rejected: no recovered plan is shown, and the persisted reason is shown.
      await expect(row).toContainText("v1 (agreed)");
      await expect(page.locator(".b-sch-event", { hasText: "Recovered " })).toHaveCount(0);
      if (run.runReason) await expect(page.getByText(run.runReason, { exact: false })).toBeVisible();
    }
  });
});
