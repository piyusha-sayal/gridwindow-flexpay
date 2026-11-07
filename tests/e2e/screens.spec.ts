/** Captures review screenshots of the real app per viewport (desktop, tablet, mobile) into artifacts/screenshots. */
import { expect, test } from "@playwright/test";
import { OPERATOR_PASSPHRASE, OPERATOR_STATE } from "./constants";

test.use({ storageState: OPERATOR_STATE });

const offset: Record<string, number> = { desktop: 15, tablet: 16, mobile: 17 };

test.setTimeout(120_000);

test("screens: home, driver offers, reservation receipt, operator console, benchmark", async ({ page }, info) => {
  // Before every capture: no credential fields or secret values may be on screen.
  const shot = async (name: string) => {
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    const text = await page.locator("body").innerText();
    for (const secret of [OPERATOR_PASSPHRASE, "e2e-session-secret", "PAYPAL_CLIENT_SECRET", "ANTHROPIC_API_KEY"]) expect(text).not.toContain(secret);
    await page.screenshot({ path: `artifacts/screenshots/${info.project.name}-${name}.png`, fullPage: true });
  };
  const night = new Date(Date.now() + (offset[info.project.name] ?? 18) * 86_400_000).toISOString().slice(0, 10);

  await page.goto("/");
  await shot("1-home");

  await page.goto("/drive");
  await page.getByLabel("Night of").fill(night);
  await page.getByLabel("Plug in").fill("19:00"); // explicit: the default follows the wall clock
  await page.getByLabel("Ready by (next morning)").fill("07:00");
  await page.getByRole("button", { name: "See offers" }).click();
  await expect(page.getByRole("heading", { name: /flexible offer|cannot be met/ })).toBeVisible();
  await page.getByRole("button", { name: "Why is it cheaper?" }).first().click();
  await expect(page.getByText(/Deterministic fallback/).first()).toBeVisible();
  await shot("2-driver-offers");

  await page.getByRole("button", { name: "Review and approve" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /^Approve \$/ }).click();
  await expect(page.getByRole("button", { name: "Approve (mock)" })).toBeVisible();
  await shot("3-mock-checkout");
  await page.getByRole("button", { name: "Approve (mock)" }).click();
  await expect(page.getByText("Authorized, not captured.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Run the synthetic overnight charge" }).click();
  await expect(page.getByRole("region", { name: "FlexReceipt" })).toBeVisible();
  await page.waitForTimeout(8_000); // let the accelerated playback finish
  await shot("4-reservation-receipt");

  await page.goto("/operator");
  await page.getByLabel("Night of").fill(night);
  await page.getByRole("button", { name: "Load" }).click();
  await page.getByRole("button", { name: `Seed background drivers for ${night}` }).click();
  await expect(page.getByText(/Seeded \d background reservation/)).toBeVisible();
  await page.getByRole("button", { name: /^Reservation res_.*parked/ }).first().click();
  await shot("5-operator");

  await page.goto("/benchmark");
  await shot("6-benchmark");
});
