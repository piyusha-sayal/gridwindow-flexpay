/** Redesigned navigation and pages, exercised in MOCK mode against the production build. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("Rewards & Payments shows an honest empty state for a new session", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/rewards");
  await expect(page.getByRole("heading", { level: 1, name: "Rewards & Payments" })).toBeVisible();
  await expect(page.getByText("No charging commitments yet.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Plan My Charge" })).toHaveAttribute("href", "/drive");
  await ctx.close();
});

test("How It Works has a keyboard-operable walkthrough and an FAQ", async ({ page }) => {
  await page.goto("/how-it-works");
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(4);
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Is a real EV or charger connected?")).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test("Impact Lab compares plans for the chosen port and writes nothing", async ({ page }) => {
  await page.goto("/impact-lab");
  await expect(page.getByRole("heading", { level: 1, name: "Impact Lab" })).toBeVisible();
  await page.locator("#kwh").fill("30");
  await page.locator("#port").selectOption({ index: 2 });
  await page.getByRole("button", { name: "Compare" }).click();
  await expect(page.getByText(/synthetic/i).first()).toBeVisible();
  await expect(page.getByRole("table").first()).toBeVisible();
  await page.goto("/rewards");
  await expect(page.getByText("No charging commitments yet.")).toBeVisible();
});

test("/benchmark redirects to the Impact Lab", async ({ page }) => {
  await page.goto("/benchmark");
  await expect(page).toHaveURL(/\/impact-lab$/);
});

test("Smart Charge shows each port's power class and a guided demo that never submits", async ({ page }) => {
  await page.goto("/drive");
  await expect(page.getByRole("radio", { name: /Port A.*3\.6 kW.*Lower-power AC/s })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Port B.*7\.2 kW.*Standard AC/s })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Port C.*11 kW.*Higher-power AC/s })).toBeVisible();
  await page.getByText("Guided demo scenarios").click();
  await page.getByRole("button", { name: /Scenario B: Infeasible charging/ }).click();
  await expect(page.getByRole("radio", { name: /^Port A/ })).toBeChecked();
  await expect(page.getByLabel("Energy into battery (kWh)")).toHaveValue("40");
  await expect(page.getByText("Loaded scenario B.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Approve these exact terms/ })).toHaveCount(0);
});
