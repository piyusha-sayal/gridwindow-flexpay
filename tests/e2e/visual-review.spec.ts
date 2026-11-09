/**
 * Visual evidence (MOCK): drives the real app into each reviewable state, captures screenshots into
 * artifacts/qa/sprint11, checks layout geometry at seven viewport widths and checks print media.
 * Runs once, in the desktop project; nights 40–43 are reserved for this spec.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { OPERATOR_PASSPHRASE, OPERATOR_STATE } from "./constants";

test.describe.configure({ mode: "serial" });
test.use({ storageState: OPERATOR_STATE });
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "visual review runs once, on desktop"));
test.setTimeout(240_000);

const OUT = "artifacts/qa/sprint11";
const WIDTHS = [320, 375, 412, 768, 1024, 1280, 1440] as const;
const nightAt = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const ids: Record<string, string> = {};

async function shot(page: Page, file: string) {
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  const text = await page.locator("body").innerText();
  for (const secret of [OPERATOR_PASSPHRASE, "e2e-session-secret", "PAYPAL_CLIENT_SECRET", "ANTHROPIC_API_KEY"]) expect(text).not.toContain(secret);
  await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: true });
}

async function requestOffers(page: Page, night: string, port: string, over: { kwh?: string; plugIn?: string; depart?: string } = {}) {
  await page.goto("/drive");
  await page.getByRole("radio", { name: new RegExp(`^Port ${port}`) }).check();
  await page.getByLabel("Night of").fill(night);
  await page.getByLabel("Energy into battery (kWh)").fill(over.kwh ?? "30");
  await page.getByLabel("Plug in").fill(over.plugIn ?? "19:00");
  await page.getByLabel("Ready by (next morning)").fill(over.depart ?? "07:00");
  await page.getByRole("button", { name: "See offers" }).click();
  await expect(page.getByRole("heading", { name: /flexible offer|cannot be met/ })).toBeVisible();
}

async function authorize(page: Page, night: string, port: string): Promise<string> {
  await requestOffers(page, night, port);
  await page.getByRole("button", { name: "Review and approve" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /^Approve \$/ }).click();
  await page.getByRole("button", { name: "Approve (mock)" }).click();
  await expect(page.getByText("Authorized, not captured.", { exact: false })).toBeVisible();
  return (await page.getByText(/^Reservation res_/).textContent())!.replace("Reservation ", "").trim();
}

async function operatorRow(page: Page, night: string, id: string) {
  await page.goto("/operator");
  await page.getByLabel("Night of").fill(night);
  await page.getByRole("button", { name: "Load" }).click();
  return page.getByRole("row").filter({ hasText: id });
}

/** Page-level horizontal overflow and elements escaping the viewport (outside scroll containers). */
async function layoutIssues(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrolls horizontally (${document.documentElement.scrollWidth} > ${vw})`);
    const inScroller = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === "auto" || o === "scroll") return true;
      }
      return false;
    };
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || el.closest(".sr-only") || inScroller(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 1) out.push(`<${el.tagName.toLowerCase()}> "${(el.textContent ?? "").trim().slice(0, 30)}" extends ${Math.round(r.right - vw)}px past viewport`);
    }
    return Array.from(new Set(out));
  });
}

test("state gallery: validation, infeasible, terms, authorized, captured, pending, declined, voided, operator failure", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto("/");
  await shot(page, "state-01-home");
  await page.goto("/drive");
  await page.getByLabel("Energy into battery (kWh)").fill("500");
  await page.getByRole("button", { name: "See offers" }).click();
  await expect(page.getByText("Enter between 0.01 and 120 kWh.")).toBeVisible();
  await shot(page, "state-02-validation-error");

  await requestOffers(page, nightAt(40), "C", { kwh: "120", plugIn: "05:00", depart: "07:00" });
  await expect(page.getByText("This request cannot be met before your departure.")).toBeVisible();
  await shot(page, "state-03-infeasible-request");

  await requestOffers(page, nightAt(40), "A");
  await expect(page.getByText(/^(Lowest price of \d offers|Tied lowest price \(\d of \d offers\))$/).first()).toBeVisible();
  await expect(page.getByText("Ready by").first()).toBeVisible();
  await page.getByRole("button", { name: "Why is it cheaper?" }).first().click();
  await expect(page.getByText(/Deterministic fallback/).first()).toBeVisible();
  await shot(page, "state-04-offers-with-explanation");
  await page.getByRole("button", { name: "Review and approve" }).click();
  await page.getByRole("checkbox").check();
  await shot(page, "state-05-accepted-terms");
  await page.getByRole("button", { name: /^Approve \$/ }).click();
  await expect(page.getByRole("button", { name: "Approve (mock)" })).toBeVisible();
  await shot(page, "state-06-mock-checkout");
  await page.getByRole("button", { name: "Approve (mock)" }).click();
  await expect(page.getByText("Authorized, not captured.", { exact: false })).toBeVisible();
  ids.authorized = (await page.getByText(/^Reservation res_/).textContent())!.replace("Reservation ", "").trim();
  await shot(page, "state-07-authorized-reservation");

  ids.captured = await authorize(page, nightAt(41), "A");
  await page.getByRole("button", { name: "Run the synthetic overnight charge" }).click();
  const receipt = page.getByRole("region", { name: "FlexReceipt" });
  await expect(receipt.getByText(/^Paid \$\d+\.\d{2}, capture confirmed by provider$/)).toBeVisible();
  await expect(receipt.getByText("Total paid")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Payment captured (provider-confirmed)" })).toBeVisible();
  await expect(receipt.getByRole("button", { name: "Print receipt" })).toBeVisible();
  await page.waitForTimeout(8_000); // accelerated playback finishes
  await shot(page, "state-08-captured-receipt");

  ids.pending = await authorize(page, nightAt(42), "B");
  let row = await operatorRow(page, nightAt(42), ids.pending);
  await row.getByRole("button", { name: "Deliver · capture pending" }).click();
  await expect(row).toContainText("CAPTURE_PENDING");
  await page.goto(`/reservations/${ids.pending}`);
  const pendingReceipt = page.getByRole("region", { name: "FlexReceipt" });
  await expect(pendingReceipt.getByText(/^\$\d+\.\d{2} USD authorized · not final, not yet paid$/)).toBeVisible();
  await expect(pendingReceipt.getByText("Capture pending", { exact: true })).toBeVisible();
  await expect(pendingReceipt.getByText("Total paid")).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: "Capture pending: not final" })).toBeVisible();
  await shot(page, "state-09-pending-capture");

  row = await operatorRow(page, nightAt(42), ids.pending);
  await row.getByRole("button", { name: "Provider declines capture" }).click();
  await expect(row).toContainText("CAPTURE_DECLINED");
  await page.goto(`/reservations/${ids.pending}`);
  await expect(page.getByRole("region", { name: "FlexReceipt" }).getByText("$0.00 USD (not collected)", { exact: true })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Capture declined: not charged" })).toBeVisible();
  await shot(page, "state-10-declined-capture");

  ids.voided = await authorize(page, nightAt(43), "C");
  row = await operatorRow(page, nightAt(43), ids.voided);
  await row.getByRole("button", { name: "Inject outage" }).click();
  await expect(row).toContainText("VOIDED");
  await row.getByRole("button", { name: ids.voided }).click();
  await expect(page.getByRole("heading", { name: ids.voided })).toBeVisible();
  await expect(page.getByText("Operator contribution (not realized)")).toBeVisible();
  await expect(page.getByText(/^\$0\.00 · \+\$\d+\.\d{2} was projected$/)).toBeVisible();
  await shot(page, "state-11-operator-failure-evidence");
  await page.goto(`/reservations/${ids.voided}`);
  await expect(page.getByRole("region", { name: "FlexReceipt" }).getByText(/Not charged. Authorization voided by provider/)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Authorization voided: not charged (provider-confirmed)" })).toBeVisible();
  await shot(page, "state-12-voided-authorization");

  await page.goto("/impact-lab");
  await shot(page, "state-13-benchmark");
});

test("viewport matrix: no horizontal overflow on core screens at 320–1440 px", async ({ page }) => {
  expect(ids.captured, "state gallery must run first").toBeTruthy();
  const screens: [string, (p: Page) => Promise<void>][] = [
    ["home", async (p) => void (await p.goto("/"))],
    ["drive-form", async (p) => void (await p.goto("/drive"))],
    ["drive-offers", (p) => requestOffers(p, nightAt(40), "B")],
    ["reservation-receipt", async (p) => {
      await p.goto(`/reservations/${ids.captured}`);
      await expect(p.getByRole("region", { name: "FlexReceipt" })).toBeVisible();
    }],
    ["operator", async (p) => {
      await operatorRow(p, nightAt(42), ids.pending!);
      await expect(p.getByRole("region", { name: "Night summary" })).toBeVisible();
    }],
    ["benchmark", async (p) => void (await p.goto("/impact-lab"))],
  ];
  const manifest: { width: number; screen: string; file: string; issues: string[] }[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
    for (const [name, open] of screens) {
      await open(page);
      const file = `viewport-${String(width).padStart(4, "0")}-${name}`;
      await shot(page, file);
      manifest.push({ width, screen: name, file: `${file}.png`, issues: await layoutIssues(page) });
    }
  }
  writeFileSync(`${OUT}/viewport-manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  expect(manifest.filter((m) => m.issues.length > 0)).toEqual([]);
});

test("navigation marks the current page and the landing CTA works from the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/impact-lab");
  const main = page.getByRole("navigation", { name: "Main" });
  await expect(main.getByRole("link", { name: "Impact Lab", exact: true })).toHaveAttribute("aria-current", "page");
  for (const name of ["Home", "Smart Charge", "Rewards & Payments", "Impact Lab", "How It Works", "Operator Console"]) await expect(main.getByRole("link", { name, exact: true })).toBeVisible();
  await page.goto("/");
  const cta = page.getByRole("link", { name: "Plan My Charge" }).first();
  await cta.focus();
  await expect(cta).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/drive$/);
  await expect(main.getByRole("link", { name: "Smart Charge", exact: true })).toHaveAttribute("aria-current", "page");
});

test("mobile uses a bottom bar with a More sheet instead of a top menu", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  const bar = page.getByRole("navigation", { name: "Mobile" });
  for (const name of ["Home", "Charge", "Rewards"]) await expect(bar.getByRole("link", { name, exact: true })).toBeVisible();
  const more = bar.getByRole("button", { name: "More" });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  for (const name of ["Impact Lab", "How It Works", "Operator Console"]) await expect(bar.getByRole("link", { name })).toBeVisible();
  await bar.getByRole("link", { name: "How It Works" }).click();
  await expect(page).toHaveURL(/\/how-it-works$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("mobile operator cards show payment status and keep actions reachable without horizontal scroll", async ({ page }) => {
  expect(ids.voided, "state gallery must run first").toBeTruthy();
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/operator");
  await page.getByLabel("Night of").fill(nightAt(43));
  await page.getByRole("button", { name: "Load" }).click();
  const card = page.getByRole("listitem").filter({ hasText: ids.voided! });
  await expect(page.getByRole("region", { name: "Reservations table (scrolls horizontally)" })).toBeHidden();
  for (const label of ["Port", "Parked", "Energy", "Customer amount", "Charging", "Payment"]) await expect(card.getByText(label, { exact: true })).toBeVisible();
  const reconcile = card.getByRole("button", { name: "Reconcile" });
  await reconcile.scrollIntoViewIfNeeded();
  await expect(reconcile).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await card.getByRole("button", { name: `Details for reservation ${ids.voided}` }).click();
  await expect(page.getByRole("heading", { name: ids.voided })).toBeVisible();
  await shot(page, "mobile-0320-operator-card-detail");
});

test("mobile Impact Lab shows the study headline results below the scenario panel, without horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/impact-lab");
  const glance = page.getByRole("region", { name: "At a glance" });
  for (const label of ["Requests simulated", "Optimized served", "Hard-constraint violations", "Unfavorable pairwise comparisons"]) await expect(glance.getByText(label)).toBeVisible();
  await expect(glance.getByText("Requests not served (infeasible)")).toBeVisible();
  await expect(page.getByRole("table").first()).toBeAttached();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("print media: receipt-only output, every section expanded, PDF renders", async ({ page }) => {
  expect(ids.captured, "state gallery must run first").toBeTruthy();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/reservations/${ids.captured}`);
  const receipt = page.getByRole("region", { name: "FlexReceipt" });
  await expect(receipt).toBeVisible();
  const sections = receipt.locator("details");
  await expect(sections.first()).not.toHaveAttribute("open");

  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await expect(receipt).toBeVisible();
  for (const hidden of [page.locator(".site-header"), page.getByRole("heading", { name: "Payment", exact: true }), page.getByRole("button", { name: "Print receipt" })]) await expect(hidden).toBeHidden();
  const count = await sections.count();
  expect(count).toBeGreaterThanOrEqual(5);
  for (let i = 0; i < count; i++) await expect(sections.nth(i)).toHaveAttribute("open", "");
  for (const text of ["Total paid", "Terms SHA-256", "Payment evidence", "Discount math (modeled)", "MOCK: simulated payment, not PayPal"]) await expect(receipt.getByText(text).first()).toBeVisible();
  // Running footer with the receipt number on every printed page (CSS @page margin box).
  const footerRule = await page.evaluate(() =>
    Array.from(document.styleSheets).flatMap((sh) => Array.from(sh.cssRules).map((r) => r.cssText)).find((t) => t.includes("GridWindow FlexReceipt FR-")) ?? null,
  );
  expect(footerRule).toMatch(/@bottom-left/);
  await page.screenshot({ path: `${OUT}/print-receipt.png`, fullPage: true });
  const pdf = await page.pdf({ path: `${OUT}/print-receipt.pdf`, format: "Letter", printBackground: true });
  const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  expect(pages).toBeGreaterThanOrEqual(1);
  expect(pages).toBeLessThanOrEqual(3);
  writeFileSync(`${OUT}/print-manifest.json`, JSON.stringify({ sections: count, pdfPages: pages }, null, 2) + "\n");

  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.emulateMedia({ media: "screen" });
  await expect(sections.first()).not.toHaveAttribute("open");
});

test("landing hero: ready-by slider moves by keyboard and reprices from the synthetic tariff", async ({ page }) => {
  await page.goto("/");
  const slider = page.getByRole("slider", { name: "Ready-by time" });
  await expect(slider).toHaveAttribute("aria-valuetext", "Ready by 07:00");
  await expect(page.getByText("$12.43", { exact: true })).toBeVisible();
  await slider.focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(slider).toHaveAttribute("aria-valuetext", "Ready by 06:00");
  await page.keyboard.press("Home");
  await expect(page.getByText("Not enough time")).toBeVisible();
  await page.keyboard.press("End");
  await expect(slider).toHaveAttribute("aria-valuetext", "Ready by 10:00");
});
