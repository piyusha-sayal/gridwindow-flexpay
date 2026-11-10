import { expect, test, type Page } from "@playwright/test";
import { OPERATOR_STATE } from "./constants";

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
    const section = page.getByRole("region", { name: "Scheduled demand vs site limit" });
    await expect(section).toBeVisible();
    await expect(section.getByText("Peak scheduled demand")).toBeVisible();
    await expect(section.getByText("Site limit", { exact: true }).first()).toBeVisible();
    await expect(section.getByText("24 kW").first()).toBeVisible();
    await expect(section.getByText("Over capacity")).toBeVisible();
    await expect(section.getByRole("list", { name: "Legend" })).toContainText("Scheduled demand");
    await expect(section.getByRole("list", { name: "Scheduled demand against the site limit, per quarter-hour" })).toBeVisible();
    await expect(page.getByRole("region", { name: /Schedule table/ })).toBeVisible();
  });
});
