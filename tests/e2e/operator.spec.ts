import { expect, test } from "@playwright/test";

const night = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);

test("operator signs in, sees occupancy vs power, injects an outage and the authorization is voided", async ({ page }) => {
  // Create an authorized reservation as a driver first.
  await page.goto("/drive");
  await page.getByRole("radio", { name: /^Port B/ }).check();
  await page.getByLabel("Night of").fill(night);
  await page.getByLabel("Plug in").fill("19:00"); // explicit: the default follows the wall clock
  await page.getByLabel("Ready by (next morning)").fill("07:00");
  await page.getByRole("button", { name: "See offers" }).click();
  await page.getByRole("button", { name: "Review and approve" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /^Approve \$/ }).click();
  await page.getByRole("button", { name: "Approve (mock)" }).click();
  await expect(page.getByText("Authorized, not captured.", { exact: false })).toBeVisible();
  const reservationId = (await page.getByText(/^Reservation res_/).textContent())!.replace("Reservation ", "").trim();

  await page.goto("/operator");
  await page.getByLabel("Passphrase").fill("wrong-passphrase");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Incorrect passphrase" })).toBeVisible();
  await page.getByLabel("Passphrase").fill("e2e-operator-passphrase");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { level: 1, name: / at Harbor Lane/ })).toBeVisible();
  await page.getByLabel("Night of").fill(night);
  await page.getByRole("button", { name: "Load" }).click();
  await expect(page.getByRole("heading", { name: "Ports", exact: true })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: reservationId });
  await expect(row).toContainText("AUTHORIZED");
  await row.getByRole("button", { name: "Inject outage" }).click();
  await expect(row).toContainText("VOIDED");
  await expect(row).toContainText("FAILED");
});
