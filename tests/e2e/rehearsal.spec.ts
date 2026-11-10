/**
 * Timed MOCK rehearsal of plans/DEMO_PLAN.md (success, service failure, provider pending and
 * infeasible request). Measures app response time per step, not presenter pace, and writes
 * artifacts/qa/demo-rehearsal.json. Never resets data: other specs share this database.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { OPERATOR_STATE } from "./constants";

test.use({ storageState: OPERATOR_STATE });
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "rehearsal runs once, on desktop"));

const nightAt = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function requestOffers(page: Page, port: string, night: string, kwh = "30", plugIn = "19:00", depart = "07:00", cap = "20.00") {
  await page.goto("/drive");
  await page.getByRole("radio", { name: new RegExp(`^Port ${port}`) }).check();
  await page.getByLabel("Night of").fill(night);
  await page.getByLabel("Energy into battery (kWh)").fill(kwh);
  await page.getByLabel("Plug in").fill(plugIn);
  await page.getByLabel("Ready by (next morning)").fill(depart);
  await page.getByLabel("Budget (USD)").fill(cap);
  await page.getByRole("button", { name: "See offers" }).click();
  await expect(page.getByRole("heading", { name: /flexible offer|cannot be met/ })).toBeVisible();
}

async function loadNight(page: Page, night: string) {
  await page.goto("/operator");
  await page.getByLabel("Night of").fill(night);
  await page.getByRole("button", { name: "Load" }).click();
  await expect(page.getByRole("heading", { level: 1, name: / at Harbor Lane/ })).toBeVisible();
}

test("demo rehearsal (MOCK): timed per DEMO_PLAN", async ({ page }) => {
  test.setTimeout(180_000);
  const steps: { step: string; ms: number }[] = [];
  const step = async (name: string, fn: () => Promise<void>) => {
    const t0 = Date.now();
    await test.step(name, fn);
    steps.push({ step: name, ms: Date.now() - t0 });
  };
  const night = nightAt(34);

  await step("home", async () => {
    await page.goto("/");
    await expect(page.locator("h1")).toBeVisible();
  });
  await step("seed background drivers", async () => {
    await loadNight(page, night);
    await page.getByRole("button", { name: `Seed background drivers for ${night}` }).click();
    await expect(page.getByText(/Seeded \d background reservation/)).toBeVisible();
  });
  await step("driver request → offers (port A; the seed occupies B and C)", () => requestOffers(page, "A", night));
  await step("grounded explanation (fallback)", async () => {
    await page.getByRole("button", { name: "Why is it cheaper?" }).first().click();
    await expect(page.getByText(/Deterministic fallback \(no AI\)/).first()).toBeAttached();
  });
  await step("consent → MOCK checkout → authorized", async () => {
    await page.getByRole("button", { name: "Review and approve" }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /^Approve \$/ }).click();
    await expect(page.getByText("MOCK PAYMENT PROVIDER: this is not PayPal")).toBeVisible();
    await page.getByRole("button", { name: "Approve (mock)" }).click();
    await expect(page.getByText("Authorized, not captured.", { exact: false })).toBeVisible();
  });
  const driverUrl = page.url();
  await step("operator view (timeline, load, cap)", () => loadNight(page, night));
  await step("success: deliver → CAPTURED receipt", async () => {
    await page.goto(driverUrl);
    await page.getByRole("button", { name: "Run the synthetic overnight charge" }).click();
    await expect(page.getByRole("region", { name: "FlexReceipt" }).getByText(/capture confirmed by provider/)).toBeVisible();
  });
  await step("failure: inject outage on a seeded reservation → VOIDED", async () => {
    await loadNight(page, night);
    const row = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Inject outage" }).and(page.locator(":enabled")) }).first();
    await row.getByRole("button", { name: "Inject outage" }).click();
    await expect(page.getByRole("row").filter({ hasText: "VOIDED" }).first()).toBeVisible();
  });
  await step("provider pending → resolve (MOCK only)", async () => {
    const row = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Deliver · capture pending" }) }).first();
    await row.getByRole("button", { name: "Deliver · capture pending" }).click();
    await expect(page.getByRole("button", { name: "Provider completes capture" })).toBeVisible();
    await page.getByRole("button", { name: "Provider completes capture" }).first().click();
    await expect(page.getByRole("button", { name: "Provider completes capture" })).toHaveCount(0);
  });
  await step("infeasible request explained", async () => {
    await requestOffers(page, "C", nightAt(35), "120", "05:00", "07:00", "100");
    await expect(page.getByText("This request cannot be met before your departure.")).toBeVisible();
  });
  await step("benchmark", async () => {
    await page.goto("/impact-lab");
    await expect(page.locator("h1")).toBeVisible();
  });

  const totalMs = steps.reduce((s, x) => s + x.ms, 0);
  await mkdir("artifacts/qa", { recursive: true });
  await writeFile("artifacts/qa/demo-rehearsal.json", JSON.stringify({ mode: "MOCK", note: "app response time under automation, not presenter pace", totalMs, steps }, null, 2) + "\n");
  expect(totalMs).toBeLessThan(60_000);
});
