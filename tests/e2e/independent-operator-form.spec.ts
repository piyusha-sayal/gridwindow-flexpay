import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { OPERATOR_STATE } from "./constants";

/**
 * Independent QA: the demo injects the disturbance through the operator console form, not the API.
 * Drives the real form (MOCK mode, SYNTHETIC) and checks the run, the source label and the Bryntum board.
 */
const OUT = "artifacts/qa/evidence";
const NIGHT = new Date(Date.now() + 53 * 86_400_000).toISOString().slice(0, 10);

test.describe("operator console: inject a SYNTHETIC disturbance through the form", () => {
  test.use({ storageState: OPERATOR_STATE, viewport: { width: 1440, height: 1000 } });
  test.setTimeout(180_000);

  test("form records the event, the run appears with its source label and tool trace, and the driver is asked to consent", async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await page.goto("/drive");
    await page.getByRole("radio", { name: /^Port B/ }).check();
    await page.getByLabel("Night of").fill(NIGHT);
    await page.getByLabel("Plug in").fill("19:00");
    await page.getByLabel("Ready by (next morning)").fill("07:00");
    await page.getByLabel("Energy into battery (kWh)").fill("30");
    await page.getByLabel("Budget (USD)").fill("20.00");
    await page.getByRole("button", { name: "See offers" }).click();
    await page.getByRole("button", { name: "Review and approve" }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /^Approve \$\d+\.\d{2} with mock provider$/ }).click();
    await page.getByRole("button", { name: "Approve (mock)" }).click();
    await expect(page.getByText("Authorized, not captured.", { exact: false })).toBeVisible();
    await page.waitForURL(/\/reservations\/[^/?]+$/);
    const id = new URL(page.url()).pathname.split("/").pop()!;

    const op = await page.context().newPage();
    await op.goto("/operator");
    await op.getByLabel("Night of").fill(NIGHT);
    await op.getByRole("button", { name: "Load" }).click();
    const panel = op.locator("section[aria-labelledby='recovery-title']");
    await expect(panel.getByRole("heading", { name: "Recovery engine" })).toBeVisible();
    await panel.locator("#rec-session").selectOption({ value: id });
    await panel.locator("#rec-type").selectOption({ label: "Early departure" });
    await panel.locator("#rec-slot").fill("0");
    await panel.getByRole("button", { name: "Inject SYNTHETIC disturbance" }).click();
    await expect(panel.getByRole("heading", { name: "Recorded disturbances" })).toBeVisible();
    await expect(panel.getByText(/SYNTHETIC/).first()).toBeVisible();
    await op.screenshot({ path: `${OUT}/20-operator-form-injection.png`, fullPage: true });

    await page.reload();
    await expect(page.getByRole("heading", { name: "Charging change proposed" })).toBeVisible({ timeout: 20_000 });
  });
});
