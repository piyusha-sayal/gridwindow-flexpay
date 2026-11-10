import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { OPERATOR_STATE } from "./constants";

/** Driver-side recovery journeys: runs against the production build in MOCK mode with a throwaway database. */
const ORIGIN = "http://localhost:3107";

interface ReservationRecovery {
  versions: { version: number }[];
  runs: { runId: string; status: string }[];
}

interface ReservationSnapshot {
  id: string;
  departMs: number;
  recovery: ReservationRecovery | null;
}

/** A night unique to this spec, far enough ahead that the wall clock never matters. */
function nightAt(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Books a flexible charge through the real driver wizard, stopping once the mock authorization is held. */
async function authorizedReservation(page: Page, night: string, portLabel: string): Promise<string> {
  await page.goto("/drive");
  await expect(page.getByRole("heading", { name: "What does your car need tonight?" })).toBeVisible();
  await page.getByRole("radio", { name: new RegExp(`^Port ${portLabel}`) }).check();
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
  const body = (await res.json()) as { reservation: ReservationSnapshot };
  return body.reservation;
}

function latestVersion(r: ReservationSnapshot): number {
  return Math.max(...(r.recovery?.versions.map((v) => v.version) ?? [1]));
}

/** Operator injects a disturbance through the real API. The effective slot is the first slot, so nothing already scheduled is frozen. */
async function injectDisturbance(request: APIRequestContext, reservationId: string, body: Record<string, unknown>): Promise<void> {
  const res = await request.post("/api/recovery/events", {
    data: { eventId: `drv-${Math.random().toString(36).slice(2, 10)}`, reservationId, effectiveSlot: 0, ...body },
    headers: { Origin: ORIGIN },
  });
  expect(res.status()).toBeLessThan(300);
}

/** Early departure one hour before the agreed departure. */
async function injectEarlyDeparture(request: APIRequestContext, reservationId: string, departMs: number): Promise<void> {
  await injectDisturbance(request, reservationId, { type: "EARLY_DEPARTURE", params: { departMs: departMs - 60 * 60_000 } });
}

test.describe("driver recovery", () => {
  test.use({ storageState: OPERATOR_STATE });

  test("early departure: pending approval with differences, Approve advances the schedule, receipt shows the recovery", async ({ page, request }) => {
    const night = nightAt(33);
    const id = await authorizedReservation(page, night, "A");
    const before = await reservationFor(request, id);
    await injectEarlyDeparture(request, id, before.departMs);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Charging change proposed" })).toBeVisible();
    const card = page.locator("section[aria-labelledby='consent-title']");
    await expect(card.getByText("Proposed change")).toBeVisible();
    await expect(card.getByText("(unchanged)").first()).toBeVisible();
    await expect(card.getByText("Finish charging").first()).toBeVisible();
    await expect(card.getByText("Expires")).toBeVisible();

    await page.getByRole("button", { name: "Approve change" }).click();
    await expect(page.getByRole("heading", { name: "Charging change proposed" })).toBeHidden();
    await expect.poll(async () => latestVersion(await reservationFor(request, id))).toBeGreaterThan(latestVersion(before));

    await page.getByRole("button", { name: "Run the synthetic overnight charge" }).click();
    await expect(page.getByRole("heading", { name: "FlexReceipt" })).toBeVisible();
    const receipt = page.getByRole("region", { name: "FlexReceipt" });
    await receipt.getByText("Autonomous recovery (SYNTHETIC disturbance)", { exact: true }).click();
    await expect(receipt.getByText("Consent: Approved by you", { exact: false })).toBeVisible();
    await expect(receipt.getByRole("heading", { name: "Recovery run · Approved by you and applied" })).toBeVisible();
    // QA-4: once approved and applied, the receipt never claims an automatic recovery or a pending approval.
    await expect(receipt).not.toContainText("Recovered automatically");
    await expect(receipt).not.toContainText("Nothing changes until you approve it");
  });

  test("decline keeps the schedule version unchanged and says so", async ({ page, request }) => {
    const id = await authorizedReservation(page, nightAt(34), "B");
    const before = await reservationFor(request, id);
    await injectEarlyDeparture(request, id, before.departMs);

    await page.reload();
    await page.getByRole("button", { name: "Keep original schedule" }).click();
    await expect(page.getByRole("heading", { name: "Charging change proposed" })).toBeHidden();
    await expect(page.getByText("Declined by driver")).toBeVisible();
    await expect(page.getByText("Your original schedule is unchanged.")).toBeVisible();
    expect(latestVersion(await reservationFor(request, id))).toBe(latestVersion(before));
  });

  test("a proposal made stale by a newer disturbance is refused with a clear message", async ({ page, request }) => {
    const id = await authorizedReservation(page, nightAt(35), "C");
    const before = await reservationFor(request, id);
    await injectEarlyDeparture(request, id, before.departMs);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Charging change proposed" })).toBeVisible();

    // A newer disturbance lands while the proposal is open.
    await injectDisturbance(request, id, { type: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 1800 } });
    await page.getByRole("button", { name: "Approve change" }).click();
    const message = page.locator("[role=alert]").filter({ hasText: "A newer disturbance changed this schedule" });
    await expect(message).toBeVisible();
    await expect(message).not.toContainText(/undefined|stack|Error/);
    expect(latestVersion(await reservationFor(request, id))).toBe(latestVersion(before));
  });

  test("another driver cannot load or decide this recovery", async ({ page, browser, request }) => {
    const id = await authorizedReservation(page, nightAt(36), "A");
    const before = await reservationFor(request, id);
    await injectEarlyDeparture(request, id, before.departMs);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Charging change proposed" })).toBeVisible();
    const runId = (await reservationFor(request, id)).recovery!.runs.find((run) => run.status === "NEEDS_APPROVAL")!.runId;

    // An explicitly anonymous context: no driver cookie and no operator cookie.
    const other = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const otherPage = await other.newPage();
      const cookieNames = (await other.cookies()).map((c) => c.name);
      expect(cookieNames.some((name) => /operator|driver/i.test(name))).toBe(false);
      const read = await otherPage.request.get(`/api/recovery/runs/${runId}`);
      expect(read.status()).toBe(404);
      const approve = await otherPage.request.post(`/api/recovery/runs/${runId}/approve`, { headers: { Origin: ORIGIN }, data: {} });
      expect(approve.status()).toBe(404);
      const reject = await otherPage.request.post(`/api/recovery/runs/${runId}/reject`, { headers: { Origin: ORIGIN }, data: {} });
      expect(reject.status()).toBe(404);
      const reservation = await otherPage.request.get(`/api/reservations/${id}`);
      expect(reservation.ok()).toBe(false);
    } finally {
      await other.close();
    }
    // The owner still sees the proposal, untouched.
    await expect(page.getByRole("button", { name: "Approve change" })).toBeVisible();
  });

  test("the FlexReceipt labels disturbances as SYNTHETIC, apart from PayPal and MOCK payment evidence", async ({ page, request }) => {
    const id = await authorizedReservation(page, nightAt(37), "B");
    const before = await reservationFor(request, id);
    await injectEarlyDeparture(request, id, before.departMs);
    await page.reload();
    await page.getByRole("button", { name: "Keep original schedule" }).click();
    await page.getByRole("button", { name: "Run the synthetic overnight charge" }).click();
    await expect(page.getByRole("heading", { name: "FlexReceipt" })).toBeVisible();

    const receipt = page.getByRole("region", { name: "FlexReceipt" });
    await receipt.getByText("Autonomous recovery (SYNTHETIC disturbance)", { exact: true }).click();
    await expect(receipt.getByText("Early departure", { exact: false }).first()).toBeVisible();
    await expect(receipt.getByText("SYNTHETIC", { exact: true }).first()).toBeVisible();
    await expect(receipt.getByText(/separate from PayPal Sandbox payment evidence/)).toBeVisible();

    await receipt.getByText("Payment evidence", { exact: true }).click();
    await expect(receipt.getByText("MOCK provider", { exact: false }).first()).toBeVisible();
  });

  test("infeasible recovery shows a plain reason and leaves the original schedule", async ({ page, request }) => {
    const id = await authorizedReservation(page, nightAt(38), "C");
    const before = await reservationFor(request, id);
    await injectDisturbance(request, id, { type: "CHARGER_FAILURE", params: {} });
    await page.reload();

    await expect(page.getByRole("heading", { name: "Charging change outcome" })).toBeVisible();
    await expect(page.getByText("No feasible recovery")).toBeVisible();
    await expect(page.getByText("Your original schedule is unchanged.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Charging change proposed" })).toBeHidden();
    expect(latestVersion(await reservationFor(request, id))).toBe(latestVersion(before));
  });

  test("keyboard: approval buttons are reachable in order and operable", async ({ page, request }) => {
    const id = await authorizedReservation(page, nightAt(39), "A");
    const before = await reservationFor(request, id);
    await injectEarlyDeparture(request, id, before.departMs);
    await page.reload();

    const approve = page.getByRole("button", { name: "Approve change" });
    const keep = page.getByRole("button", { name: "Keep original schedule" });
    await approve.focus();
    await expect(approve).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(keep).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(approve).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Charging change proposed" })).toBeHidden();
  });

  test("axe: no serious or critical violations on the pending-approval reservation page", async ({ page, request }) => {
    const id = await authorizedReservation(page, nightAt(40), "B");
    const before = await reservationFor(request, id);
    await injectEarlyDeparture(request, id, before.departMs);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Charging change proposed" })).toBeVisible();

    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    const blocking = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking.map((v) => `${v.id}: ${v.help} @ ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  });
});

test.describe("driver recovery on a phone", () => {
  test.use({ storageState: OPERATOR_STATE });

  test("pending approval on Pixel 7 has no page-level horizontal overflow", async ({ browser, request }) => {
    // The driver cookie lives in this context, so the wizard and the reservation are both viewed as the same driver.
    const phone = await browser.newContext({ ...devices["Pixel 7"], storageState: OPERATOR_STATE });
    try {
      const page = await phone.newPage();
      const id = await authorizedReservation(page, nightAt(41), "C");
      const before = await reservationFor(request, id);
      await injectEarlyDeparture(request, id, before.departMs);
      await page.reload();
      await expect(page.getByRole("heading", { name: "Charging change proposed" })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    } finally {
      await phone.close();
    }
  });
});
