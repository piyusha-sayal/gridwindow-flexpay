import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { OPERATOR_STATE } from "./constants";

/**
 * Operator schedule night navigation: the console's Schedule view link carries the loaded night, the picker above the
 * timeline loads a night through the URL (?night=), and a night change never shows another night's sessions.
 * Runs against the production build in MOCK mode with a throwaway database.
 */
const ORIGIN = "http://localhost:3107";

/** Nights far enough ahead that seeding never depends on the wall clock, and used by no other spec. */
function nightAt(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function sessionCount(request: APIRequestContext, night: string): Promise<number> {
  const res = await request.get(`/api/schedule?nightOf=${night}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { schedule: { sessions: unknown[] } }).schedule.sessions.length;
}

/** Seeds the night once and reuses it afterwards (a second seed on the same night is refused). */
async function seeded(request: APIRequestContext, night: string): Promise<number> {
  if ((await sessionCount(request, night)) === 0) {
    const res = await request.post("/api/operator/demo", { data: { action: "seed", nightOf: night }, headers: { Origin: ORIGIN } });
    expect(res.ok()).toBe(true);
  }
  return sessionCount(request, night);
}

/** Matches the board's schedule requests for one night, polls included. */
function scheduleRequestFor(night: string) {
  return (url: URL) => url.pathname === "/api/schedule" && url.searchParams.get("nightOf") === night;
}

const picker = (page: Page) => page.getByLabel("Night of");
const loadButton = (page: Page) => page.getByRole("button", { name: "Load", exact: true });
const tableRows = (page: Page) => page.getByRole("table").locator("tbody tr");
const emptyNight = (page: Page) => page.getByText("No scheduled sessions for this night");
const timeline = (page: Page) => page.getByRole("heading", { name: "Timeline" });

async function chooseNight(page: Page, night: string) {
  await picker(page).fill(night);
  await loadButton(page).click();
  await expect(page).toHaveURL(new RegExp(`/operator/schedule\\?night=${night}$`));
}

test.describe("operator schedule night navigation", () => {
  test.use({ storageState: OPERATOR_STATE });

  test("the console's Schedule view link opens the night the dashboard has loaded", async ({ page }) => {
    const first = nightAt(151);
    const second = nightAt(153);
    const link = page.getByRole("link", { name: "Schedule view" });
    await page.goto("/operator");
    for (const night of [first, second]) {
      await page.locator("#night").fill(night);
      await page.getByRole("button", { name: "Load", exact: true }).click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText(`Night of ${night}`);
      await expect(link).toHaveAttribute("href", `/operator/schedule?night=${night}`);
    }
    // A date typed but not loaded does not change the link.
    await page.locator("#night").fill(first);
    await expect(link).toHaveAttribute("href", `/operator/schedule?night=${second}`);

    await link.click();
    await expect(page).toHaveURL(new RegExp(`/operator/schedule\\?night=${second}$`));
    await expect(picker(page)).toHaveValue(second);
  });

  test("the picker loads nights through the URL, survives refresh and Back/Forward, and stays on empty nights", async ({ page, request }) => {
    const busy = nightAt(141);
    const quiet = nightAt(143);
    const count = await seeded(request, busy);
    expect(count).toBeGreaterThan(0);
    expect(await sessionCount(request, quiet)).toBe(0);

    await page.goto(`/operator/schedule?night=${busy}`);
    await expect(picker(page)).toHaveValue(busy);
    await expect(timeline(page)).toBeVisible();
    await expect(page.locator(".b-scheduler").first()).toBeVisible();
    await expect(tableRows(page)).toHaveCount(count);

    // An empty night keeps the picker, shows nothing from the previous night, and keeps focus on Load.
    await chooseNight(page, quiet);
    await expect(emptyNight(page)).toBeVisible();
    await expect(picker(page)).toHaveValue(quiet);
    await expect(timeline(page)).toHaveCount(0);
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(loadButton(page)).toBeFocused();
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

    // From the empty night to a night with sessions.
    await chooseNight(page, busy);
    await expect(tableRows(page)).toHaveCount(count);
    await expect(timeline(page)).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`night=${busy}$`));
    await expect(picker(page)).toHaveValue(busy);
    await expect(tableRows(page)).toHaveCount(count);

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`night=${quiet}$`));
    await expect(picker(page)).toHaveValue(quiet);
    await expect(emptyNight(page)).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);

    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`night=${busy}$`));
    await expect(picker(page)).toHaveValue(busy);
    await expect(tableRows(page)).toHaveCount(count);

    // The plan toggle still works after navigating.
    const original = page.getByRole("button", { name: "Original plan" });
    const current = page.getByRole("button", { name: "Current (recovered)" });
    await original.click();
    await expect(original).toHaveAttribute("aria-pressed", "true");
    await expect(current).toHaveAttribute("aria-pressed", "false");
    await current.click();
    await expect(current).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".b-scheduler").first()).toBeVisible();
  });

  test("a night change never shows the previous night while the next one loads, and drops a late poll of the old night", async ({ page, request }) => {
    const busy = nightAt(141);
    const other = nightAt(147);
    const count = await seeded(request, busy);
    expect(await sessionCount(request, other)).toBe(0);

    // The first request for the busy night passes; its later polls are held until released.
    let busyRequests = 0;
    let releaseBusy!: () => void;
    const busyHeld = new Promise<void>((resolve) => (releaseBusy = resolve));
    await page.route(scheduleRequestFor(busy), async (route) => {
      busyRequests += 1;
      if (busyRequests > 1) await busyHeld;
      await route.continue();
    });
    // The other night's first response is held, to look at the board while it loads.
    let releaseOther!: () => void;
    const otherHeld = new Promise<void>((resolve) => (releaseOther = resolve));
    await page.route(scheduleRequestFor(other), async (route) => {
      await otherHeld;
      await route.continue();
    });

    await page.goto(`/operator/schedule?night=${busy}`);
    await expect(tableRows(page)).toHaveCount(count);
    // A poll of the busy night is now in flight and held.
    await expect.poll(() => busyRequests, { timeout: 10_000 }).toBeGreaterThan(1);

    await chooseNight(page, other);
    await expect(page.getByText("Loading schedule…")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.locator("#schedule-summary")).toHaveCount(0);
    await expect(timeline(page)).toHaveCount(0);
    await expect(picker(page)).toHaveValue(other);

    releaseOther();
    await expect(emptyNight(page)).toBeVisible();

    // The held busy-night poll now completes; the board must stay on the other night.
    const late = page.waitForResponse((res) => scheduleRequestFor(busy)(new URL(res.url())));
    releaseBusy();
    await late;
    await page.waitForResponse((res) => scheduleRequestFor(other)(new URL(res.url())), { timeout: 10_000 });
    await expect(emptyNight(page)).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`night=${other}$`));
  });
});
