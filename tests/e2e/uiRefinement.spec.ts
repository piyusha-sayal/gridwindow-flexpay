import { expect, test, type Page } from "@playwright/test";
import { OPERATOR_STATE } from "./constants";
import type { ScheduleView } from "../../src/server/services/scheduleView";

/** Final UI refinement: runs against the production build in MOCK mode with a throwaway database. */
const ORIGIN = "http://localhost:3107";

function nightAt(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

test("home page has a single Plan My Charge entry and no closing call-to-action band", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Your car ready on time/ })).toBeVisible();
  await expect(page.getByText("Ready to plan tonight's charge?")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Plan My Charge" })).toHaveCount(1);
});

test("FAQ uses the full content width and every answer opens", async ({ page }) => {
  await page.goto("/how-it-works");
  const faq = page.locator("#faq").locator("xpath=..");
  const main = page.locator("main");
  const [faqBox, mainBox] = [await faq.boundingBox(), await main.boundingBox()];
  expect(faqBox!.width).toBeGreaterThanOrEqual(mainBox!.width * 0.9);
  const first = page.locator("#faq").locator("xpath=..").locator("details").first();
  await first.locator("summary").click();
  await expect(first).toHaveAttribute("open", "");
});

test("the visually hidden Walkthrough heading stays in the heading structure for screen readers", async ({ page }) => {
  await page.goto("/how-it-works");
  const heading = page.getByRole("heading", { level: 2, name: "Walkthrough" });
  await expect(heading).toHaveCount(1);
  await expect(heading).toHaveClass(/sr-only/);
});

test("port cards are reachable by keyboard and show a visible focus indicator", async ({ page }) => {
  await page.goto("/drive");
  const portC = page.getByRole("radio", { name: /^Port C/ });
  await portC.focus();
  await expect(portC).toBeFocused();
  const outline = await portC.locator("xpath=..").evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
  await expect(portC).toHaveAccessibleName(/^Port C/);
  await expect(portC).toHaveAccessibleDescription(/Why choose this port\?/);
});

test.describe("driver choices", () => {
  test("port guidance covers hover, keyboard selection and screen readers", async ({ page }) => {
    await page.goto("/drive");
    const group = page.getByRole("radiogroup", { name: "Port" });
    await expect(group.getByRole("radio")).toHaveCount(3);
    await expect(page.getByText("Up to 11 kW")).toBeVisible();
    await expect(page.getByText("Up to 7.2 kW")).toBeVisible();
    await expect(page.getByText("Up to 3.6 kW")).toBeVisible();

    await page.getByRole("radio", { name: /^Port C/ }).check();
    const details = page.getByTestId("port-details");
    await expect(details).toContainText("Why choose this port?");
    await expect(details).toContainText("Why might it not suit you?");

    // Hover previews another port without changing the choice.
    await page.locator("label", { has: page.getByRole("radio", { name: /^Port A/ }) }).hover();
    await expect(details).toContainText("(preview, select to choose)");
    await expect(page.getByRole("radio", { name: /^Port C/ })).toBeChecked();

    // Keyboard: arrow keys move the choice and the panel follows.
    await page.mouse.move(0, 0);
    await page.getByRole("radio", { name: /^Port C/ }).focus();
    await page.keyboard.press("ArrowUp");
    await expect(details).toContainText("A middle option");
    await expect(page.getByRole("radio", { name: /^Port B/ })).toHaveAccessibleDescription(/Why choose this port\?/);
  });

  test("preferences explain what they do and what they cost", async ({ page }) => {
    await page.goto("/drive");
    await page.getByRole("radio", { name: /^Gentle charging/ }).check();
    const details = page.getByTestId("preference-details");
    await expect(details).toContainText("lower peak charging power");
    await expect(details).toContainText("It may require longer charging time.");
    await page.getByRole("radio", { name: /^Finish early/ }).check();
    await expect(details).toContainText("Price and power profile may differ");
    await page.getByRole("radio", { name: /^Lowest price/ }).check();
    await expect(details).toContainText("It may not finish earliest.");
  });

  test("offers explain why the plan fits, and AI provenance is secondary", async ({ page }) => {
    await page.goto("/drive");
    await page.getByRole("radio", { name: /^Port C/ }).check();
    await page.getByLabel("Night of").fill(nightAt(90));
    await page.getByLabel("Plug in").fill("19:00");
    await page.getByLabel("Ready by (next morning)").fill("07:00");
    await page.getByLabel("Energy into battery (kWh)").fill("30");
    await page.getByLabel("Budget (USD)").fill("20.00");
    await page.getByRole("button", { name: "See offers" }).click();
    await expect(page.getByRole("heading", { name: /flexible offer/ })).toBeVisible();

    await expect(page.getByText("Why choose this plan?")).toHaveCount(0);
    const fits = page.getByText("Why this plan fits");
    expect(await fits.count()).toBeGreaterThanOrEqual(2);
    await fits.first().click();
    const items = page.locator("details[open] ul li");
    expect(await items.count()).toBeGreaterThanOrEqual(2);
    expect(await items.count()).toBeLessThanOrEqual(3);
    await expect(items.first()).toContainText("Delivers 30.00 kWh");

    // The AI explanation is not available here, so the fallback is used: no banner, provenance one click away.
    await page.getByRole("button", { name: "Why is it cheaper?" }).first().click();
    await expect(page.getByText("How this was generated").first()).toBeVisible();
    await expect(page.getByText(/Deterministic fallback \(no AI\)/).first()).toBeHidden();
    await page.getByText("How this was generated").first().click();
    await expect(page.getByText(/Deterministic fallback \(no AI\)/).first()).toBeVisible();
  });
});

test.describe("operator capacity graph", () => {
  test.use({ storageState: OPERATOR_STATE });

  async function seeded(page: Page): Promise<string> {
    const night = nightAt(52);
    const existing = await page.request.get(`/api/schedule?nightOf=${night}`);
    const sessions = ((await existing.json()) as { schedule: { sessions: unknown[] } }).schedule.sessions;
    if (sessions.length === 0) {
      const res = await page.request.post("/api/operator/demo", { data: { action: "seed", nightOf: night }, headers: { Origin: ORIGIN } });
      expect(res.ok()).toBe(true);
    }
    return night;
  }

  test("shows title, limit, peak, legend and a text summary of overload periods", async ({ page }) => {
    const night = await seeded(page);
    await page.goto(`/operator/schedule?night=${night}`);
    const section = page.getByRole("region", { name: "Site demand vs usable limit" });
    await expect(section).toBeVisible();
    await expect(section.getByText("Peak site demand")).toBeVisible();
    await expect(section.getByText("Usable site limit", { exact: true }).first()).toBeVisible();
    await expect(section.getByText("23 kW").first()).toBeVisible();
    await expect(section.getByText("Over capacity")).toBeVisible();
    await expect(section.getByRole("list", { name: "Legend" })).toContainText("Scheduled charging");
    await expect(section.getByRole("list", { name: "Scheduled demand against the site limit, per quarter-hour" })).toBeVisible();
    await expect(page.getByRole("region", { name: /Schedule table/ })).toBeVisible();
  });
  test("operator reservation rows state their provider mode and a matching row keeps its actions", async ({ page }) => {
    const night = await seeded(page);
    await page.goto("/operator");
    await page.getByLabel("Night of").fill(night);
    await page.getByRole("button", { name: "Load" }).click();
    const badges = page.getByText("MOCK (simulated)", { exact: true });
    await expect(badges.first()).toBeAttached();
    // The server runs MOCK, so these rows match it: no mismatch note and Reconcile stays enabled.
    await expect(page.getByText(/Actions are unavailable here/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reconcile" }).locator("visible=true").first()).toBeEnabled();
  });

  test("polling removes voided capacity without a reload or a recovery notice", async ({ page }) => {
    const night = await seeded(page);
    const response = await page.request.get(`/api/schedule?nightOf=${night}`);
    const { schedule } = await response.json() as { schedule: ScheduleView };
    const active = schedule.sessions.find((s) => s.slotsCommitted)!;
    expect(active).toBeTruthy();
    let next: ScheduleView = { ...schedule, sessions: [active], disruptions: [] };
    await page.route("**/api/schedule?*", (route) => route.fulfill({ json: { schedule: next } }));
    await page.goto(`/operator/schedule?night=${night}`);
    await expect(page.locator("#schedule-summary")).toContainText("1 sessions");
    const buckets = page.getByRole("list", { name: "Scheduled demand against the site limit, per quarter-hour" }).getByRole("listitem");
    const initialLabels = await buckets.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")!));
    expect(initialLabels.length).toBeGreaterThan(0);
    expect(initialLabels.some((label) => !label.includes(": 0 kW scheduled charging"))).toBe(true);
    next = { ...next, sessions: [{ ...active, paymentState: "VOIDED", serviceState: "FAILED", slotsCommitted: false }] };
    await expect(page.locator("#schedule-summary")).toContainText("0 sessions", { timeout: 15_000 });
    await expect(page.locator("#schedule-summary")).toContainText("1 released");
    for (const label of await buckets.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")))) {
      expect(label).toContain(": 0 kW scheduled charging");
    }
    await expect(page.getByRole("status").filter({ hasText: "Schedule updated by recovery" })).toHaveCount(0);
  });
});
