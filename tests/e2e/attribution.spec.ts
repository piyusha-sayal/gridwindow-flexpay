import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { OPERATOR_STATE } from "./constants";

/**
 * Fault attribution through the real operator form: two bookings on two nights, each disturbed as a charger failure with
 * a different attribution (UNKNOWN, then OPERATOR). Runs against the production build in MOCK mode with a throwaway
 * database. The settlement sweep runs only at boot and every few minutes, so this spec asserts what is visible at once:
 * the recorded attribution and that nothing is captured. Deadline and void outcomes are covered by the integration suite.
 */

interface ReservationSnapshot {
  id: string;
  paymentState: string;
}

function nightAt(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Books Port B through the real driver wizard and stops once the mock authorization is held. */
async function authorizedReservation(page: Page, night: string): Promise<string> {
  await page.goto("/drive");
  await expect(page.getByRole("heading", { name: "What does your car need tonight?" })).toBeVisible();
  await page.getByRole("radio", { name: /^Port B/ }).check();
  await page.getByLabel("Night of").fill(night);
  await page.getByLabel("Plug in").fill("19:00");
  await page.getByLabel("Ready by (next morning)").fill("07:00");
  await page.getByLabel("Energy into battery (kWh)").fill("30");
  await page.getByLabel("Budget (USD)").fill("20.00");
  await page.getByRole("button", { name: "See offers" }).click();
  await expect(page.getByRole("heading", { name: /flexible offer/ })).toBeVisible();
  await page.getByRole("button", { name: "Review and approve" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /^Approve \$\d+\.\d{2} with mock provider$/ }).click();
  await page.getByRole("button", { name: "Approve (mock)" }).click();
  await expect(page.getByText("Authorized, not captured.", { exact: false })).toBeVisible();
  await page.waitForURL(/\/reservations\/[^/?]+$/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

async function reservationFor(request: APIRequestContext, id: string): Promise<ReservationSnapshot> {
  const res = await request.get(`/api/reservations/${encodeURIComponent(id)}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { reservation: ReservationSnapshot }).reservation;
}

/** Opens the operator console on a night, then records a charger failure with the chosen attribution. */
async function recordFailure(page: Page, night: string, attribution: "UNKNOWN" | "OPERATOR") {
  await page.goto("/operator");
  await page.locator("#night").fill(night);
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await page.getByLabel("Disturbance", { exact: true }).selectOption({ label: "Charger failure" });
  await page.getByRole("radio", { name: new RegExp(`^${attribution} `) }).check();
  await expect(page.getByRole("radio", { name: new RegExp(`^${attribution} `) })).toBeChecked();
  await page.getByRole("button", { name: "Inject SYNTHETIC disturbance" }).click();
  await expect(page.getByText("Charger failure recorded as SYNTHETIC", { exact: false })).toBeVisible();
}

test.describe("fault attribution on the operator form", () => {
  test.use({ storageState: OPERATOR_STATE });

  test("UNKNOWN and OPERATOR are recorded as chosen; nothing is captured and the choice survives a reload", async ({ page, request }) => {
    const unknownNight = nightAt(60);
    const operatorNight = nightAt(61);
    const unknownId = await authorizedReservation(page, unknownNight);
    const operatorId = await authorizedReservation(page, operatorNight);

    await page.goto("/operator");
    await page.locator("#night").fill(unknownNight);
    await page.getByRole("button", { name: "Load", exact: true }).click();
    await page.getByLabel("Disturbance", { exact: true }).selectOption({ label: "Early departure" });
    // OPERATOR is not offered for an early departure: disabled, with the reason, never silently replaced.
    await expect(page.getByRole("radio", { name: /^OPERATOR / })).toBeDisabled();
    await expect(page.getByText("OPERATOR and EXTERNAL cannot be recorded for Early departure.", { exact: false })).toBeVisible();
    await page.getByLabel("Disturbance", { exact: true }).selectOption({ label: "Charger failure" });
    await expect(page.getByRole("radio", { name: /^UNKNOWN / })).toBeChecked();
    await expect(page.getByRole("radio", { name: /^OPERATOR / })).not.toBeChecked();

    await recordFailure(page, unknownNight, "UNKNOWN");
    await expect(page.getByText("Fault attribution: UNKNOWN (not confirmed)", { exact: false }).first()).toBeVisible();

    await recordFailure(page, operatorNight, "OPERATOR");
    await expect(page.getByText("Fault attribution: OPERATOR (confirmed)", { exact: false }).first()).toBeVisible();

    // After a reload the recorded attribution is read back from the server, not from the form.
    await page.reload();
    await page.locator("#night").fill(unknownNight);
    await page.getByRole("button", { name: "Load", exact: true }).click();
    await expect(page.getByText("Fault attribution: UNKNOWN (not confirmed)", { exact: false }).first()).toBeVisible();

    // Neither booking is captured. Settlement is left to the sweep, which never captures on an unconfirmed outcome.
    for (const id of [unknownId, operatorId]) {
      expect((await reservationFor(request, id)).paymentState).not.toBe("CAPTURED");
    }
    expect((await reservationFor(request, unknownId)).paymentState).toBe("AUTHORIZED");
  });
});
