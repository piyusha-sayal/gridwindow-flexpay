import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { OPERATOR_STATE } from "./constants";

/**
 * Guided demo Scenario C through the recovery architecture: a real driver booking, a SYNTHETIC disturbance recorded
 * through POST /api/recovery/events, the operator's checklist read from the persisted run, and the driver's outcome.
 * Runs against the production build in MOCK mode with a throwaway database.
 */
const ORIGIN = "http://localhost:3107";

interface ReservationSnapshot {
  id: string;
  paymentState: string;
  recovery: { runs: { runId: string; status: string }[] } | null;
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

/** Opens the operator console on the night and selects the first recorded disturbance. */
async function openOperatorChecklist(page: Page, night: string) {
  await page.goto("/operator");
  await page.locator("#night").fill(night);
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await page.getByRole("button", { name: /Charger power reduced/ }).first().click();
  return page.locator("section[aria-labelledby='scenario-c-title']");
}

test.describe("guided demo Scenario C: disturbance and recovery", () => {
  test.use({ storageState: OPERATOR_STATE });

  test("records a disturbance, shows the checklist from the real run, then the driver sees the outcome", async ({ page, request }) => {
    const night = nightAt(55);
    const id = await authorizedReservation(page, night);

    // The same route the operator's Recovery engine uses.
    const eventId = `scc-${Math.random().toString(36).slice(2, 10)}`;
    const record = await request.post("/api/recovery/events", {
      data: { eventId, reservationId: id, type: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 3600 }, effectiveSlot: 0 },
      headers: { Origin: ORIGIN },
    });
    expect(record.status()).toBeLessThan(300);

    // Operator checklist: every step is read from the persisted run and reservation.
    const checklist = await openOperatorChecklist(page, night);
    await expect(checklist.getByRole("heading", { name: "Scenario C: recovery steps" })).toBeVisible();
    await expect(checklist.getByText(/Disturbance detected/)).toBeVisible();
    await expect(checklist.getByText(/(MODEL_DECISION|DETERMINISTIC_FALLBACK) · .*\(\d+ trace entries\)/)).toBeVisible({ timeout: 15_000 });
    await expect(checklist.getByText("Deterministic validation")).toBeVisible();
    await expect(checklist.getByText("MOCK provider (simulated, not PayPal)", { exact: false })).toBeVisible();

    // Each branch asserts only what the persisted run status means.
    const reservation = await reservationFor(request, id);
    const status = reservation.recovery?.runs.find((r) => r.status !== "RUNNING")?.status ?? "RUNNING";
    if (status === "INFEASIBLE") {
      await expect(checklist.getByText("Infeasible or failed: no version written")).toBeVisible();
      await page.goto(`/reservations/${id}`);
      await expect(page.getByRole("region", { name: "Charging change outcome" }).getByText("No feasible recovery")).toBeVisible();
      await expect(page.getByRole("heading", { name: "FlexReceipt" })).toBeHidden();
    } else {
      if (status === "NEEDS_APPROVAL") {
        await expect(checklist.getByText("NEEDS_DRIVER_APPROVAL")).toBeVisible();
        await page.goto(`/reservations/${id}`);
        await page.getByRole("button", { name: "Approve change" }).click();
        await expect(page.getByRole("heading", { name: "Charging change proposed" })).toBeHidden();
      } else {
        await expect(checklist.getByText("AUTO_COMMIT, within pre-approved bounds")).toBeVisible();
      }
      await page.goto(`/reservations/${id}`);
      await page.getByRole("button", { name: "Run the synthetic overnight charge" }).click();
      await expect(page.getByRole("heading", { name: "FlexReceipt" })).toBeVisible();
      const receipt = page.getByRole("region", { name: "FlexReceipt" });
      await receipt.getByText("Autonomous recovery (SYNTHETIC disturbance)", { exact: true }).click();
      await expect(receipt.getByText("SYNTHETIC", { exact: false }).first()).toBeVisible();
    }

    // Financial outcome read from the reservation, labelled as MOCK on the operator checklist.
    const settled = await reservationFor(request, id);
    const updated = await openOperatorChecklist(page, night);
    await expect(updated.getByText(`${settled.paymentState} · MOCK provider (simulated, not PayPal)`, { exact: false })).toBeVisible({ timeout: 15_000 });
  });
});
