/**
 * Demo scenarios driven through the real UI and API in MOCK mode. Every assertion reads
 * state produced by application code; nothing is staged.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { OPERATOR_STATE } from "./constants";

test.describe.configure({ mode: "serial" });
// Operator session from the setup project; driver flows in the same context still get their own driver cookie.
test.use({ storageState: OPERATOR_STATE });

const nightAt = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

interface Need {
  night: string;
  port: string;
  kwh?: string;
  plugIn?: string;
  depart?: string;
  cap?: string;
}

async function requestOffers(page: Page, n: Need) {
  await page.goto("/drive");
  await page.getByRole("radio", { name: new RegExp(`^Port ${n.port}`) }).check();
  await page.getByLabel("Night of").fill(n.night);
  await page.getByLabel("Energy into battery (kWh)").fill(n.kwh ?? "30");
  await page.getByLabel("Plug in").fill(n.plugIn ?? "19:00");
  await page.getByLabel("Ready by (next morning)").fill(n.depart ?? "07:00");
  await page.getByLabel("Budget (USD)").fill(n.cap ?? "20.00");
  await page.getByRole("button", { name: "See offers" }).click();
  await expect(page.getByRole("heading", { name: /flexible offer|cannot be met/ })).toBeVisible();
}

async function authorize(page: Page, n: Need): Promise<string> {
  await requestOffers(page, n);
  await page.getByRole("button", { name: "Review and approve" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /^Approve \$/ }).click();
  await page.getByRole("button", { name: "Approve (mock)" }).click();
  await expect(page.getByText("Authorized, not captured.", { exact: false })).toBeVisible();
  return (await page.getByText(/^Reservation res_/).textContent())!.replace("Reservation ", "").trim();
}

async function operatorView(page: Page, night: string) {
  await page.goto("/operator");
  await expect(page.getByRole("heading", { level: 1, name: / at Harbor Lane/ })).toBeVisible();
  await page.getByLabel("Night of").fill(night);
  await page.getByRole("button", { name: "Load" }).click();
  await expect(page.getByLabel("Night of")).toHaveValue(night);
}

test("Scenario A: flexible agreement → mock authorization → simulated charge → MOCK FlexReceipt (persists after refresh)", async ({ page }) => {
  const night = nightAt(8);
  await requestOffers(page, { night, port: "A" });
  await expect(page.getByText("Feasible · validated").first()).toBeVisible();
  // Grounded explanation: without model credentials the deterministic fallback is labeled as such.
  await page.getByRole("button", { name: "Why is it cheaper?" }).first().click();
  await expect(page.getByText(/Deterministic fallback \(no AI\)/).first()).toBeVisible();
  await page.getByRole("button", { name: "Review and approve" }).click();
  await expect(page.getByText("Merchant", { exact: true })).toBeVisible();
  await expect(page.getByText("MOCK payment · simulated").first()).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /^Approve \$/ }).click();
  await expect(page.getByText("MOCK PAYMENT PROVIDER: this is not PayPal")).toBeVisible();
  await page.getByRole("button", { name: "Approve (mock)" }).click();
  await expect(page.getByText("Authorized, not captured.", { exact: false })).toBeVisible();
  await expect(page.getByRole("region", { name: "FlexReceipt" })).toHaveCount(0);

  await page.getByRole("button", { name: "Run the synthetic overnight charge" }).click();
  const receipt = page.getByRole("region", { name: "FlexReceipt" });
  await expect(receipt.getByText("MOCK: simulated payment, not PayPal")).toBeVisible();
  await expect(receipt.getByText(/^Paid \$\d+\.\d{2}, capture confirmed by provider$/)).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Energy delivered" })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Captured after delivery was verified.")).toBeVisible();
  await page.getByRole("region", { name: "FlexReceipt" }).getByText("Payment evidence", { exact: true }).click();
  await expect(page.getByRole("region", { name: "FlexReceipt" }).getByText("CAPTURED", { exact: true })).toBeVisible();

  await page.getByLabel("Your question").fill("When was I charged?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText(/Payment: CAPTURED via MOCK provider/)).toBeVisible();
});

test("Scenario B: operator outage → service failure → mock void → truthful driver outcome", async ({ page }) => {
  const night = nightAt(9);
  const id = await authorize(page, { night, port: "B" });
  const driverUrl = page.url();
  await operatorView(page, night);
  const row = page.getByRole("row").filter({ hasText: id });
  await row.getByRole("button", { name: "Inject outage" }).click();
  await expect(row).toContainText("VOIDED");
  await expect(row).toContainText("FAILED");
  await row.getByRole("button", { name: id }).click();
  await expect(page.getByRole("dialog", { name: id }).getByText("SERVICE_FAILED", { exact: true })).toBeVisible();

  await page.goto(driverUrl);
  await expect(page.getByText("Authorization voided. No payment was collected.")).toBeVisible();
  await expect(page.getByText("Charging failed (synthetic charger outage), so the authorization was voided.")).toBeVisible();
  await expect(page.getByRole("region", { name: "FlexReceipt" }).getByText("Not charged. Authorization voided by provider (bank hold removal may take time)")).toBeVisible();
});

test("Scenario C: physically infeasible request is truthfully rejected with the reason", async ({ page }) => {
  await requestOffers(page, { night: nightAt(10), port: "C", kwh: "120", plugIn: "05:00", depart: "07:00", cap: "100" });
  await expect(page.getByText("This request cannot be met before your departure.")).toBeVisible();
  await expect(page.getByText(/at most 20\.24 kWh can reach the battery/)).toBeVisible();
  await expect(page.locator('input[name="offer"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Approve/ })).toHaveCount(0);
});

test("economic rejection: no shared saving means no offer, with per-variant reasons", async ({ page }) => {
  await requestOffers(page, { night: nightAt(10), port: "A", plugIn: "01:00", depart: "04:00" });
  await expect(page.getByText("No flexible offer is available for this request.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Not offered/ })).toBeVisible();
  await expect(page.locator('input[name="offer"]')).toHaveCount(0);
});

test("pending then completed settlement, and declined settlement, never show false success", async ({ page }) => {
  const night = nightAt(11);
  const pendingId = await authorize(page, { night, port: "A" });
  const pendingUrl = page.url();
  const declinedId = await authorize(page, { night, port: "C", plugIn: "20:00" });
  const declinedUrl = page.url();

  await operatorView(page, night);
  await page.getByRole("row").filter({ hasText: pendingId }).getByRole("button", { name: "Deliver · capture pending" }).click();
  await expect(page.getByRole("row").filter({ hasText: pendingId })).toContainText("CAPTURE_PENDING");
  await page.getByRole("row").filter({ hasText: declinedId }).getByRole("button", { name: "Deliver · capture declined" }).click();
  await expect(page.getByRole("row").filter({ hasText: declinedId })).toContainText("CAPTURE_DECLINED");

  await page.goto(pendingUrl);
  await expect(page.getByText(/The outcome is not final yet/)).toBeVisible();
  await expect(page.getByText("Capture pending, not final; the provider has not confirmed the payment")).toBeVisible();
  // A pending capture must never read as a definitive outcome either way.
  await expect(page.getByText(/not charged|you were not charged|Paid \$/i)).toHaveCount(0);
  await expect(page.getByText(/capture confirmed by provider/)).toHaveCount(0);

  await page.goto(declinedUrl);
  await expect(page.getByText(/declined the capture, so no payment was collected/)).toBeVisible();
  await expect(page.getByText("Capture declined. No payment collected")).toBeVisible();

  await operatorView(page, night);
  await page.getByRole("row").filter({ hasText: pendingId }).getByRole("button", { name: "Provider completes capture" }).click();
  await expect(page.getByRole("row").filter({ hasText: pendingId })).toContainText("CAPTURED");
  await page.goto(pendingUrl);
  await expect(page.getByText("Captured after delivery was verified.")).toBeVisible();
});

test("offer expiry disables approval in the browser", async ({ page }) => {
  await page.clock.install();
  await requestOffers(page, { night: nightAt(12), port: "B" });
  await page.getByRole("button", { name: "Review and approve" }).click();
  await page.getByRole("checkbox").check();
  await expect(page.getByRole("button", { name: /^Approve \$/ })).toBeEnabled();
  await page.clock.fastForward("11:00");
  await expect(page.getByText("Offer expired", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Approve \$/ })).toBeDisabled();
});

test("client validation explains invalid input before any request", async ({ page }) => {
  await page.goto("/drive");
  await page.getByLabel("Energy into battery (kWh)").fill("500");
  await page.getByLabel("Budget (USD)").fill("abc");
  await page.getByLabel("Plug in").fill("19:00");
  await page.getByLabel("Ready by (next morning)").fill("18:00");
  await page.getByRole("button", { name: "See offers" }).click();
  await expect(page.getByText("Enter between 0.01 and 120 kWh.")).toBeVisible();
  await expect(page.getByText("Enter a dollar amount between 1.00 and 500.00.")).toBeVisible();
  await expect(page.getByText("Departure must be after plug-in.")).toBeVisible();
  await expect(page.getByLabel("Energy into battery (kWh)")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("heading", { name: /flexible offer|cannot be met/ })).toHaveCount(0);
});

test("demo tools seed background drivers through the real flow (operator only)", async ({ page }) => {
  const night = nightAt(13);
  await operatorView(page, night);
  await page.getByRole("button", { name: `Seed background drivers for ${night}` }).click();
  await expect(page.getByText(/Seeded 2 background reservation/)).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "AUTHORIZED" })).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^Reservation res_.*parked/ })).toHaveCount(2);
});

test("destructive demo reset requires an explicit confirmation even for a signed-in operator", async ({ page }) => {
  const res = await page.request.post("/api/operator/demo", { data: { action: "reset" }, headers: { Origin: "http://localhost:3107" } });
  expect(res.status()).toBe(400);
});

test("accessibility: no serious or critical axe violations on key screens", async ({ page }) => {
  const night = nightAt(14);
  const check = async (name: string) => {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${name}: ${v.id} (${v.nodes.length})`)).toEqual([]);
  };
  await page.goto("/");
  await check("home");
  await requestOffers(page, { night, port: "A" });
  await check("drive+offers");
  await page.goto("/benchmark");
  await check("benchmark");
  await operatorView(page, night);
  await check("operator");
});
