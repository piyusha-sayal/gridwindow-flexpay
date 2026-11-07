/**
 * Financial-state certification (MOCK): every payment state reachable through the real UI is
 * driven by application code, and the driver page must show exactly the copy for the state the
 * backend persisted. Transient and fault-only states are covered by tests/unit/paymentCopy.test.ts.
 */
import { expect, test, type Page } from "@playwright/test";
import { PAYMENT_COPY } from "@/app/reservations/[id]/paymentCopy";
import type { PaymentState } from "@/domain/paymentState";
import { OPERATOR_STATE } from "./constants";

test.describe.configure({ mode: "serial" });
test.use({ storageState: OPERATOR_STATE });
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "state matrix runs once, on desktop"));

const nightAt = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** Accepts an offer and returns the reservation id without approving the checkout. */
async function accept(page: Page, night: string, port: string): Promise<string> {
  await page.goto("/drive");
  await page.getByRole("radio", { name: new RegExp(`^Port ${port}`) }).check();
  await page.getByLabel("Night of").fill(night);
  await page.getByLabel("Plug in").fill("19:00"); // explicit: the default follows the wall clock
  await page.getByLabel("Ready by (next morning)").fill("07:00");
  await page.getByRole("button", { name: "See offers" }).click();
  await page.getByRole("button", { name: "Review and approve" }).click();
  await page.getByRole("checkbox").check();
  // The page navigates to checkout right away, so read the accept response as it passes through.
  let reservationId = "";
  await page.route("**/api/offers/accept", async (route) => {
    const res = await route.fetch();
    reservationId = ((await res.json()) as { reservationId: string }).reservationId;
    await route.fulfill({ response: res });
  });
  await page.getByRole("button", { name: /^Approve \$/ }).click();
  await expect(page.getByText("MOCK PAYMENT PROVIDER — this is not PayPal")).toBeVisible();
  await page.unroute("**/api/offers/accept");
  expect(reservationId).toMatch(/^res_/);
  return reservationId;
}

/** The driver page shows the copy for the state the backend persisted. */
async function expectState(page: Page, id: string, state: PaymentState) {
  await page.goto(`/reservations/${id}`);
  const persisted = (await (await page.request.get(`/api/reservations/${id}`)).json()) as { reservation: { paymentState: string } };
  expect(persisted.reservation.paymentState).toBe(state);
  await expect(page.getByText(PAYMENT_COPY[state].title, { exact: true })).toBeVisible();
}

async function operatorRow(page: Page, night: string, id: string) {
  await page.goto("/operator");
  await page.getByLabel("Night of").fill(night);
  await page.getByRole("button", { name: "Load" }).click();
  return page.getByRole("row").filter({ hasText: id });
}

test("order created → authorized → captured", async ({ page }) => {
  const night = nightAt(31);
  const id = await accept(page, night, "A");
  await expect(page.getByText("MOCK PAYMENT PROVIDER — this is not PayPal")).toBeVisible();
  const checkoutUrl = page.url();
  await expectState(page, id, "ORDER_CREATED");
  // The buyer returns to the provider's checkout page and approves there.
  await page.goto(checkoutUrl);
  await page.getByRole("button", { name: "Approve (mock)" }).click();
  await expect(page.getByText("Authorized, not captured.", { exact: false })).toBeVisible();
  await expectState(page, id, "AUTHORIZED");
  await page.getByRole("button", { name: "Run the synthetic overnight charge" }).click();
  await expect(page.getByRole("region", { name: "FlexReceipt" })).toBeVisible();
  await expectState(page, id, "CAPTURED");
});

test("authorized → service failure → voided", async ({ page }) => {
  const night = nightAt(32);
  const id = await accept(page, night, "B");
  await page.getByRole("button", { name: "Approve (mock)" }).click();
  await expect(page.getByText("Authorized, not captured.", { exact: false })).toBeVisible();
  const row = await operatorRow(page, night, id);
  await row.getByRole("button", { name: "Inject outage" }).click();
  await expect(row).toContainText("VOIDED");
  await expectState(page, id, "VOIDED");
});

test("capture pending → declined (MOCK provider scripting)", async ({ page }) => {
  const night = nightAt(33);
  const id = await accept(page, night, "C");
  await page.getByRole("button", { name: "Approve (mock)" }).click();
  await expect(page.getByText("Authorized, not captured.", { exact: false })).toBeVisible();
  let row = await operatorRow(page, night, id);
  await row.getByRole("button", { name: "Deliver · capture pending" }).click();
  await expect(row).toContainText("CAPTURE_PENDING");
  await expectState(page, id, "CAPTURE_PENDING");
  row = await operatorRow(page, night, id);
  await row.getByRole("button", { name: "Provider declines capture" }).click();
  await expect(row).toContainText("CAPTURE_DECLINED");
  await expectState(page, id, "CAPTURE_DECLINED");
});

/** Amounts on the redesigned page must equal the persisted record: accepted, held, captured and receipt totals. */
test("amounts: accepted, held, captured and voided amounts match the persisted reservation", async ({ page }) => {
  const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
  type View = { economics: { priceCents: number }; proofs: { type: string; amountCents: number | null }[]; paymentState: string };
  const view = async (id: string) => ((await (await page.request.get(`/api/reservations/${id}`)).json()) as { reservation: View }).reservation;
  const payment = page.getByRole("region", { name: "Payment" });
  const receipt = page.getByRole("region", { name: "FlexReceipt" });

  // Authorize → capture.
  const captured = await accept(page, nightAt(36), "A");
  await page.getByRole("button", { name: "Approve (mock)" }).click();
  await expect(page.getByText("Authorized, not captured.", { exact: false })).toBeVisible();
  const held = await view(captured);
  const price = usd(held.economics.priceCents);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`${price} for`);
  await expect(payment).toContainText(`${price}held, not collected`);
  await expect(receipt).toHaveCount(0);
  await page.getByRole("button", { name: "Run the synthetic overnight charge" }).click();
  await expect(receipt.getByText(`Paid ${price} — capture confirmed by provider`)).toBeVisible();
  const done = await view(captured);
  expect(done.paymentState).toBe("CAPTURED");
  expect(done.proofs.find((p) => p.type === "CAPTURED")?.amountCents).toBe(held.economics.priceCents);
  await expect(payment).toContainText(`${price}paid`);
  await expect(receipt.getByText(`${price} USD`, { exact: true }).first()).toBeVisible();

  // Authorize → outage → void: the accepted amount stays on the terms, nothing reads as collected.
  const voided = await accept(page, nightAt(37), "B");
  await page.getByRole("button", { name: "Approve (mock)" }).click();
  await expect(page.getByText("Authorized, not captured.", { exact: false })).toBeVisible();
  const accepted = usd((await view(voided)).economics.priceCents);
  const row = await operatorRow(page, nightAt(37), voided);
  await row.getByRole("button", { name: "Inject outage" }).click();
  await expect(row).toContainText("VOIDED");
  await page.goto(`/reservations/${voided}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`${accepted} for`);
  await expect(payment).toContainText("$0.00not collected");
  await expect(payment).not.toContainText("paid");
  await expect(page.getByRole("region", { name: "Charging · synthetic" })).toContainText("Charging failed");
  await expect(receipt.getByText("$0.00 USD (not collected)", { exact: true })).toBeVisible();
  await receipt.getByText("Amount and approved terms", { exact: true }).click();
  await expect(receipt.getByText(`${accepted} USD`, { exact: true })).toBeVisible();
});
