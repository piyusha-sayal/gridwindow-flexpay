// Evidence capture against the LIVE Render deployment. Read-only: page views, operator console reads, existing receipts.
// It never requests offers (that would run the Gemini deal agent), never creates an order and never changes a reservation.
// Reads OPERATOR_PASSPHRASE from .env at runtime; prints and stores no secret. PayPal-shaped identifiers are masked.
import { chromium } from "file:///D:/Gridwindow-flexpay/node_modules/@playwright/test/index.mjs";
import { readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";

const B = "https://gridwindow-flexpay.onrender.com";
const P = "https://gridwindow-flexpay-developers.onrender.com";
const OUT = process.argv[2] ?? "D:/Gridwindow-flexpay/docs/evidence/final-release-2026-11-11";
const SCRATCH = process.argv[3] ?? ".";
const pass = readFileSync("D:/Gridwindow-flexpay/.env", "utf8").match(/^OPERATOR_PASSPHRASE=(.*)$/m)[1].trim().replace(/^["']|["']$/g, "");
const records = [];
const checks = {};

const watch = (page) => {
  const errs = { console: [], page: [], failed: [], http: [] };
  page.on("console", (m) => m.type() === "error" && errs.console.push(m.text().slice(0, 160)));
  page.on("pageerror", (e) => errs.page.push(String(e).slice(0, 160)));
  page.on("requestfailed", (r) => { const u = new URL(r.url()); if (!/google-analytics|doubleclick|fonts\.g/.test(u.host)) errs.failed.push(`${u.host}${u.pathname} ${r.failure()?.errorText ?? ""}`.slice(0, 160)); });
  page.on("response", (r) => { const u = new URL(r.url()); if (r.status() >= 400 && (u.host.endsWith("onrender.com"))) errs.http.push(`${r.status()} ${u.pathname}`); });
  page.__errs = errs;
  return page;
};
const reset = (page) => { for (const k of Object.keys(page.__errs)) page.__errs[k] = []; };
const settle = async (page, ms = 1200) => {
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await page.evaluate(async () => { await document.fonts?.ready; await Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; }))); }).catch(() => {});
  await page.waitForTimeout(ms);
};
const overflow = (page) => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
/** Masks anything shaped like a PayPal order, authorization or capture id (e.g. 5O190127TN364715T) before a capture. */
const payIdMask = (page) => [page.getByText(/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{17}\b/)];

async function shot(page, rel, { target = null, full = false, env = "LIVE", feature, note = "" } = {}) {
  const file = path.join(OUT, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  const opts = { path: file, mask: payIdMask(page), maskColor: "#3b3b3b", animations: "disabled" };
  if (target) {
    // Crop from a full-page render: the site's fixed navigation then sits only at the top of the page, never over the element.
    await target.scrollIntoViewIfNeeded();
    const box = await target.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: Math.max(0, r.left + window.scrollX), y: Math.max(0, r.top + window.scrollY), width: r.width, height: r.height }; });
    // Back to the top: Chromium draws the fixed header at the current scroll offset even in a full-page render.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ ...opts, fullPage: true, clip: box });
  }
  else {
    if (full) { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300); }
    await page.screenshot({ ...opts, fullPage: full });
  }
  const vp = page.viewportSize();
  records.push({ file: rel.replace(/\\/g, "/"), env, url: page.url().replace(/\/reservations\/[^/?#]+/, "/reservations/<id>"), viewport: `${vp.width}x${vp.height}`, feature, note, bytes: statSync(file).size, overflowPx: await overflow(page), errors: JSON.parse(JSON.stringify(page.__errs)) });
  reset(page);
  console.log("saved", rel);
}

const b = await chromium.launch();
const ctxOpts = { timezoneId: "America/Los_Angeles", locale: "en-US", colorScheme: "light" };
const desk = await b.newContext({ ...ctxOpts, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
const mob = await b.newContext({ ...ctxOpts, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const tab = await b.newContext({ ...ctxOpts, viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

await fetch(B + "/api/config").catch(() => {}); // wake the free instance
const p = watch(await desk.newPage());
const go = async (page, url) => { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 }); await settle(page); };

// ---------- 01 product (live page views) ----------
await go(p, B + "/");
await shot(p, "01-product/01-home-desktop.png", { feature: "Home page" });
await go(p, B + "/drive");
await p.getByRole("radio", { name: /^Port C/ }).check();
await p.getByLabel("Energy into battery (kWh)").fill("30");
await p.getByLabel("Budget (USD)").fill("20.00");
await p.waitForTimeout(500);
await shot(p, "01-product/03-smart-charge-request.png", { full: true, feature: "Smart Charge request form (filled in the browser, not submitted: submitting runs the live AI deal agent)" });
await go(p, B + "/how-it-works");
await shot(p, "01-product/07-how-it-works.png", { feature: "How it works" });
await go(p, B + "/impact-lab");
await shot(p, "01-product/08-impact-lab.png", { feature: "Impact Lab (synthetic benchmark, labelled modeled)" });

// ---------- 06 Channel3 (live provider) ----------
await go(p, B + "/rewards");
await shot(p, "06-channel3/01-rewards-overview.png", { feature: "Rewards overview (modeled savings)" });
const gearSection = p.locator("section[aria-labelledby='gear-title']");
checks.channel3 = { sectionVisible: (await gearSection.count()) > 0, heading: (await gearSection.count()) ? await p.locator("#gear-title").innerText() : null };
if (checks.channel3.sectionVisible) {
  const section = gearSection;
  await section.scrollIntoViewIfNeeded();
  await settle(p, 800);
  const cards = section.locator("a[href^='http']");
  const n = await cards.count();
  const items = [];
  for (let i = 0; i < n; i++) {
    const a = cards.nth(i);
    const img = a.locator("img");
    items.push({
      https: (await a.getAttribute("href")).startsWith("https://"),
      host: new URL(await a.getAttribute("href")).host,
      target: await a.getAttribute("target"),
      rel: await a.getAttribute("rel"),
      text: (await a.innerText()).replace(/\s+/g, " ").slice(0, 120),
      imgLoaded: (await img.count()) ? await img.first().evaluate((el) => el.complete && el.naturalWidth > 0) : null,
    });
  }
  checks.channel3.cards = items;
  await shot(p, "06-channel3/02-channel3-product-cards.png", { target: section, feature: "Channel3 live product cards" });
  if (n) {
    const zoom = watch(await (await b.newContext({ ...ctxOpts, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage());
    await go(zoom, B + "/rewards");
    const first = zoom.locator("section[aria-labelledby='gear-title']").locator("a[href^='http']").first();
    await first.scrollIntoViewIfNeeded();
    await settle(zoom, 600);
    await shot(zoom, "06-channel3/03-channel3-product-details.png", { target: first, feature: "One Channel3 product card (title, merchant, price, image)" });
    // The merchant link opens in a new tab on the merchant's own https host.
    const [popup] = await Promise.all([zoom.context().waitForEvent("page", { timeout: 30_000 }), first.click()]);
    await popup.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
    checks.channel3.firstLinkOpened = { newTab: true, host: new URL(popup.url()).host };
    await popup.close();
    await zoom.context().close();
  }
}

// ---------- 03 operator console + AG Grid (live, read-only) ----------
await go(p, B + "/operator");
await p.fill("#pass", pass);
await p.click("button:has-text('Sign in')");
await p.getByLabel("Night of").waitFor({ timeout: 60_000 });
const load = async (night) => { await p.getByLabel("Night of").fill(night); await p.getByRole("button", { name: "Load" }).click(); await settle(p, 2500); };
await load("2026-11-11");
await shot(p, "03-operator-ag-grid/01-operator-dashboard.png", { feature: "Operator console (live PayPal Sandbox deployment)" });
await p.getByRole("button", { name: "Open data grid" }).click();
await settle(p, 1200);
const gridSection = p.locator("#grid-title").locator("xpath=ancestor::section[1]");
await gridSection.scrollIntoViewIfNeeded();
await shot(p, "03-operator-ag-grid/02-ag-grid-reservations.png", { target: gridSection, feature: "AG Grid reservation grid (night of 2026-11-11)" });
await load("2026-11-10");
if (!(await p.locator("#grid-search").count())) { await p.getByRole("button", { name: "Open data grid" }).click(); await settle(p, 1000); }
const shownCount = async () => (await p.getByText(/^\d+ of \d+ reservations/i).first().textContent()).match(/^\s*(\d+) of (\d+)/i).slice(1).map(Number);
const rowsAll = await shownCount();
await p.getByLabel("Needs attention only").check();
await settle(p, 800);
const rowsAttention = await shownCount();
await gridSection.scrollIntoViewIfNeeded();
await shot(p, "03-operator-ag-grid/03-ag-grid-needs-attention-filter.png", { target: gridSection, feature: "'Needs attention only' filter applied (night of 2026-11-10)" });
await p.getByLabel("Needs attention only").uncheck();
await p.fill("#grid-search", "captured");
await settle(p, 600);
const rowsSearch = await shownCount();
await p.fill("#grid-search", "");
const payHeader = p.locator(".ag-header-cell", { hasText: /Payment/ }).first();
await payHeader.click();
await settle(p, 600);
const sortState = await payHeader.getAttribute("aria-sort");
await gridSection.scrollIntoViewIfNeeded();
await shot(p, "03-operator-ag-grid/04-ag-grid-payment-status.png", { target: gridSection, feature: "Grid sorted by payment status (provider-confirmed states, MOCK rows flagged)" });
const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 30_000 }), p.getByRole("button", { name: "Export CSV" }).click()]);
const csvPath = path.join(SCRATCH, "live-grid-export.csv");
await dl.saveAs(csvPath);
const csv = readFileSync(csvPath, "utf8").trim().split(/\r?\n/);
checks.agGrid = { night: "2026-11-10", rowsAll, rowsAttention, searchCapturedRows: rowsSearch, paymentHeaderAriaSort: sortState, csv: { file: dl.suggestedFilename(), dataRows: csv.length - 1, header: csv[0].slice(0, 200) } };
const capturedRow = p.locator('[role="row"]').filter({ hasText: "H62XfQtp" }).first(); // the live Sandbox capture
await capturedRow.click();
await settle(p, 1500);
const details = p.getByRole("region", { name: /details/i }).first();
const detailTarget = (await details.count()) ? details : null;
if (detailTarget) await detailTarget.scrollIntoViewIfNeeded();
await shot(p, "03-operator-ag-grid/05-reservation-details.png", { target: detailTarget, feature: "Row click opens the reservation details panel" });

// ---------- 02 PayPal: existing live Sandbox receipts (capture and void) ----------
const cookieHeader = (await desk.cookies(B)).map((c) => `${c.name}=${c.value}`).join("; ");
const api = async (u) => (await fetch(B + u, { headers: { cookie: cookieHeader } })).json();
const findRes = async (night, suffix) => (await api(`/api/operator/dashboard?night=${night}`)).dashboard.sessions.find((s) => s.id.endsWith(suffix)).id;
checks.paypal = {};
for (const [key, night, suffix, files] of [
  ["capture", "2026-11-10", "2XfQtp", ["02-paypal/05-successful-capture.png", "02-paypal/06-flexreceipt.png"]],
  ["void", "2026-11-12", "afKCrn", ["02-paypal/07-operator-failure-void.png", "02-paypal/08-zero-charge-receipt.png"]],
]) {
  const id = await findRes(night, suffix);
  const r = (await api(`/api/reservations/${id}`)).reservation;
  checks.paypal[key] = { reservation: `…${suffix}`, providerMode: r.providerMode, paymentState: r.paymentState, serviceState: r.serviceState, proofs: r.proofs.map((x) => ({ type: x.type, providerStatus: x.providerStatus, amountCents: x.amountCents, evidenceSource: x.evidenceSource, observedAt: x.observedAt })), webhooksVerified: r.events.filter((e) => e.type === "WEBHOOK_VERIFIED").length };
  await go(p, `${B}/reservations/${id}`);
  await shot(p, files[0], { feature: key === "capture" ? "Live Sandbox reservation after delivery: capture confirmed by PayPal" : "Live Sandbox reservation after a synthetic charger failure: authorization voided by PayPal" });
  const receipt = p.getByRole("heading", { name: "FlexReceipt" }).locator("xpath=ancestor::*[self::section or self::article][1]");
  if (await receipt.count()) { await receipt.scrollIntoViewIfNeeded(); await settle(p, 600); }
  await shot(p, files[1], { target: (await receipt.count()) ? receipt : null, feature: key === "capture" ? "FlexReceipt: paid amount equals the provider-confirmed capture" : "FlexReceipt: nothing collected, authorization voided" });
}

// ---------- 07 APIMatic portal (live static site) ----------
await go(p, P + "/");
await shot(p, "07-apimatic/01-developer-portal-home.png", { feature: "APIMatic developer portal home" });
await go(p, P + "/api/openapi/site/getSiteConfig");
await shot(p, "07-apimatic/02-openapi-endpoints.png", { feature: "API reference with the endpoint list (site group)" });
await go(p, P + "/api/openapi/checkout/acceptOffer");
await shot(p, "07-apimatic/03-accept-offer-api-reference.png", { feature: "Accept offer API reference" });
const example = p.getByText(/Response|Example/).filter({ visible: true }).nth(1);
if (await example.count()) { await example.scrollIntoViewIfNeeded(); await p.mouse.wheel(0, 200); await settle(p, 600); }
await shot(p, "07-apimatic/04-request-response-example.png", { feature: "Request and response examples for accept offer" });
await go(p, P + "/sdks/typescript");
await shot(p, "07-apimatic/05-typescript-sdk-documentation.png", { feature: "Generated TypeScript SDK documentation" });

// ---------- mobile and tablet ----------
const m = watch(await mob.newPage());
await go(m, B + "/");
await shot(m, "01-product/02-home-mobile.png", { feature: "Home page on a phone" });
await m.evaluate(() => window.scrollTo(0, 900)); await m.waitForTimeout(800);
await shot(m, "08-responsive/01-mobile-home.png", { feature: "Home page on a phone, second screen, with the bottom navigation (no horizontal scroll)" });
await go(m, B + "/drive");
await m.getByLabel("Energy into battery (kWh)").scrollIntoViewIfNeeded(); await m.evaluate(() => window.scrollBy(0, -120)); await m.waitForTimeout(600);
await shot(m, "08-responsive/02-mobile-smart-charge.png", { feature: "Smart Charge form on a phone (energy, window and ports)" });
await go(m, B + "/rewards");
await shot(m, "08-responsive/04-mobile-rewards.png", { feature: "Rewards on a phone" });
const mGear = m.locator("section[aria-labelledby='gear-title']");
if (await mGear.count()) {
  const sec = mGear;
  await sec.scrollIntoViewIfNeeded();
  await settle(m, 800);
  await shot(m, "06-channel3/04-channel3-mobile.png", { target: sec, feature: "Channel3 cards on a phone" });
}
await go(m, P + "/");
await shot(m, "07-apimatic/06-developer-portal-mobile.png", { feature: "Developer portal on a phone" });
const t = watch(await tab.newPage());
await go(t, B + "/operator");
await t.fill("#pass", pass);
await t.click("button:has-text('Sign in')");
await t.getByLabel("Night of").waitFor({ timeout: 60_000 });
await t.getByLabel("Night of").fill("2026-11-11");
await t.getByRole("button", { name: "Load" }).click();
await settle(t, 2500);
await shot(t, "08-responsive/05-tablet-operator.png", { feature: "Operator console on a tablet" });

writeFileSync(path.join(SCRATCH, "capture-live-records.json"), JSON.stringify({ capturedAt: new Date().toISOString(), base: B, portal: P, records, checks }, null, 2));
await b.close();
console.log(JSON.stringify(checks, null, 1).slice(0, 4000));
