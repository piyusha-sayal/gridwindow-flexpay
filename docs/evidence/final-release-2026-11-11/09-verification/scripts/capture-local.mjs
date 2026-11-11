// Evidence capture against an ISOLATED local server: production build, MOCK payment provider, throwaway PGlite data,
// no model keys (every AI answer is the labelled deterministic fallback), no hosted database. SYNTHETIC charging.
import { chromium } from "file:///D:/Gridwindow-flexpay/node_modules/@playwright/test/index.mjs";
import { mkdirSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";

const B = process.env.BASE ?? "http://localhost:3210";
const PASS = process.env.EVIDENCE_OPERATOR_PASSPHRASE ?? "evidence-operator-passphrase-local";
const OUT = process.argv[2] ?? "D:/Gridwindow-flexpay/docs/evidence/final-release-2026-11-11";
const SCRATCH = process.argv[3] ?? ".";
const NIGHT_DRIVE = "2026-11-19";
const NIGHT_RECOVERY = "2026-11-18";
const records = [];
const checks = {};

const watch = (page) => {
  const errs = { console: [], page: [], failed: [], http: [] };
  page.on("console", (m) => m.type() === "error" && errs.console.push(m.text().slice(0, 160)));
  page.on("pageerror", (e) => errs.page.push(String(e).slice(0, 160)));
  page.on("requestfailed", (r) => errs.failed.push(`${new URL(r.url()).pathname} ${r.failure()?.errorText ?? ""}`.slice(0, 160)));
  page.on("response", (r) => { if (r.status() >= 400) errs.http.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  page.__errs = errs;
  return page;
};
const reset = (page) => { for (const k of Object.keys(page.__errs)) page.__errs[k] = []; };
const settle = async (page, ms = 1000) => {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.evaluate(async () => { await document.fonts?.ready; }).catch(() => {});
  await page.waitForTimeout(ms);
};
const overflow = (page) => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
async function shot(page, rel, { target = null, full = false, feature, note = "" } = {}) {
  const file = path.join(OUT, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  const opts = { path: file, animations: "disabled" };
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
  records.push({ file: rel.replace(/\\/g, "/"), env: "LOCAL-MOCK", url: page.url().replace(B, "").replace(/\/reservations\/[^/?#]+/, "/reservations/<id>"), viewport: `${vp.width}x${vp.height}`, feature, note, bytes: statSync(file).size, overflowPx: await overflow(page), errors: JSON.parse(JSON.stringify(page.__errs)) });
  reset(page);
  console.log("saved", rel);
}

const b = await chromium.launch();
const ctxOpts = { baseURL: B, timezoneId: "America/Los_Angeles", locale: "en-US", colorScheme: "light" };
const desk = await b.newContext({ ...ctxOpts, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const signIn = await desk.request.post("/api/operator/session", { data: { passphrase: PASS }, headers: { Origin: B } });
if (!signIn.ok()) throw new Error(`operator sign-in failed: ${signIn.status()}`);
const api = async (u) => (await desk.request.get(u)).json();
const reservation = async (id) => (await api(`/api/reservations/${encodeURIComponent(id)}`)).reservation;
const latestVersion = (r) => Math.max(...(r.recovery?.versions?.map((v) => v.version) ?? [1]));

async function showLowerPorts(page) {
  await page.evaluate(() => {
    const root = document.querySelector(".b-scheduler");
    if (!root) return;
    for (const el of root.querySelectorAll("*")) {
      const st = getComputedStyle(el);
      if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 4) el.scrollTop = el.scrollHeight;
    }
  });
  await page.waitForTimeout(600);
}
async function fillRequest(page, { night, port = "B", energy = "30", budget = "20.00" }) {
  await page.getByRole("radio", { name: new RegExp(`^Port ${port}`) }).check();
  await page.getByLabel("Night of").fill(night);
  await page.getByLabel("Plug in").fill("19:00");
  await page.getByLabel("Ready by (next morning)").fill("07:00");
  await page.getByLabel("Energy into battery (kWh)").fill(energy);
  await page.getByLabel("Budget (USD)").fill(budget);
}
async function book(page, night, port) {
  await page.goto("/drive");
  await fillRequest(page, { night, port });
  await page.getByRole("button", { name: "See offers" }).click();
  await page.getByRole("heading", { name: /flexible offer/ }).waitFor();
  await page.getByRole("button", { name: "Review and approve" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /^Approve \$\d+\.\d{2} with mock provider$/ }).click();
  await page.getByRole("button", { name: "Approve (mock)" }).click();
  await page.getByText("Authorized, not captured.", { exact: false }).waitFor();
  await page.waitForURL(/\/reservations\/[^/?]+$/);
  return new URL(page.url()).pathname.split("/").pop();
}

// ---------- 01 product + 05 AI (deterministic fallback) + 02 PayPal consent/authorization (MOCK) ----------
const SKIP_PARSE = process.env.SKIP_PARSE === "1"; // the request-parsing shots were already captured
const nlCtx = await b.newContext({ ...ctxOpts, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const n = watch(await nlCtx.newPage());
await n.goto("/drive");
await settle(n);
await n.getByLabel("Charging request in words").fill("Find me 30 kWh before 7 AM and save at least $4.");
await n.getByRole("button", { name: "Fill form" }).click();
await n.locator(".ai-note").waitFor();
await settle(n, 600);
checks.parse = { energy: await n.getByLabel("Energy into battery (kWh)").inputValue(), readyBy: await n.getByLabel("Ready by (next morning)").inputValue(), labelPresent: (await n.getByText("How this was generated").count()) > 0 };
if (!SKIP_PARSE) {
  await shot(n, "01-product/04-ai-assisted-form.png", { full: true, feature: "Plain-language request fills the form (deterministic parser; no model key on this server)" });
  const sayBox = n.locator("#nl").locator("xpath=ancestor::*[contains(@class,'card') or self::section][1]");
  await shot(n, "05-ai-agentic-commerce/01-assistant-request-parsing-fallback.png", { target: (await sayBox.count()) ? sayBox : null, feature: "Request assistant result (deterministic fallback, no model call)" });
}
// The parsed "$4 minimum saving" on port B: the best offer saves less, and the agent says so instead of relaxing the goal.
await fillRequest(n, { night: NIGHT_DRIVE, port: "B" });
await n.getByRole("button", { name: "See offers" }).click();
await n.getByRole("heading", { name: /flexible offer|cannot be met/ }).waitFor();
const goalPanel = n.locator("section[aria-labelledby='deal-agent-title']");
await goalPanel.locator(".agent-rec, [role='alert'], .agent-headline").first().waitFor({ timeout: 30_000 }).catch(() => {});
await settle(n, 800);
checks.goalNotRelaxed = (await goalPanel.innerText()).replace(/\s+/g, " ").slice(0, 220);
await shot(n, "01-product/05b-savings-goal-not-relaxed.png", { full: true, feature: "A required $4.00 saving that no offer meets is reported, never relaxed" });
await goalPanel.scrollIntoViewIfNeeded();
await shot(n, "05-ai-agentic-commerce/02b-deal-agent-goal-not-met-fallback.png", { target: goalPanel, feature: "Deal agent: no offer meets the goal (deterministic fallback)" });
await nlCtx.close();

// A fresh driver with no minimum saving: the deal agent can recommend, and the recommended offer is preselected.
const drvCtx = await b.newContext({ ...ctxOpts, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const p = watch(await drvCtx.newPage());
await p.goto("/drive");
await fillRequest(p, { night: NIGHT_DRIVE, port: "B" });
await p.getByRole("button", { name: "See offers" }).click();
await p.getByRole("heading", { name: /flexible offer/ }).waitFor();
const dealPanel = p.locator("section[aria-labelledby='deal-agent-title']");
await dealPanel.locator(".agent-rec, [role='alert']").first().waitFor({ timeout: 30_000 }).catch(() => {});
await settle(p, 800);
checks.offers = { deal: (await dealPanel.innerText()).replace(/\s+/g, " ").slice(0, 200) };
await shot(p, "01-product/05-validated-charging-offers.png", { full: true, feature: "Priced offers under the station cap, with the deal agent's pick" });
await dealPanel.scrollIntoViewIfNeeded();
await shot(p, "05-ai-agentic-commerce/02-deal-agent-recommendation-fallback.png", { target: dealPanel, feature: "Deal agent recommendation (deterministic fallback, no model call)" });
await p.getByRole("button", { name: "Why is it cheaper?" }).first().click();
const why = p.locator('[id^="why-"]:not([hidden])').first();
await why.locator("ul li").first().waitFor();
const offerCard = why.locator("xpath=ancestor::div[contains(@class,'ai-panel')][1]");
await offerCard.scrollIntoViewIfNeeded();
await settle(p, 500);
checks.explanation = { points: await why.locator("ul li").count(), labelPresent: (await p.getByText("How this was generated").count()) > 0 };
await shot(p, "01-product/06-recommended-offer-explanation.png", { target: offerCard, feature: "Why the offer is cheaper (deterministic explanation; every number from the quote)" });

await p.getByRole("button", { name: "Review and approve" }).click();
await p.getByRole("heading", { name: "Approve these exact terms" }).waitFor();
await p.getByRole("checkbox").check();
await settle(p, 500);
await shot(p, "02-paypal/01-offer-consent.png", { feature: "Driver consents to one exact offer (MOCK provider on this server; live uses PayPal Sandbox)" });
await p.getByRole("button", { name: /^Approve \$\d+\.\d{2} with mock provider$/ }).click();
await p.getByRole("button", { name: "Approve (mock)" }).waitFor();
await p.getByRole("button", { name: "Approve (mock)" }).click();
await p.getByText("Authorized, not captured.", { exact: false }).waitFor();
await p.waitForURL(/\/reservations\/[^/?]+$/);
await settle(p, 800);
const drvId = new URL(p.url()).pathname.split("/").pop();
const drv = await reservation(drvId);
checks.authorized = { paymentState: drv.paymentState, proofs: drv.proofs.map((x) => `${x.type}:${x.evidenceSource}`) };
await shot(p, "02-paypal/03-authorization-confirmed.png", { feature: "Authorization confirmed after buyer approval (MOCK provider)" });
const payPanel = p.getByText("Authorized, not captured.", { exact: false }).locator("xpath=ancestor::*[contains(@class,'card') or self::section][1]");
await shot(p, "02-paypal/04-authorized-not-captured.png", { target: (await payPanel.count()) ? payPanel : null, feature: "Held, not captured: capture waits for delivered energy (MOCK provider)" });

// Mobile offers (separate driver).
const mob = await b.newContext({ ...ctxOpts, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const m = watch(await mob.newPage());
await m.goto("/drive");
await fillRequest(m, { night: NIGHT_DRIVE, port: "C" });
await m.getByRole("button", { name: "See offers" }).click();
await m.getByRole("heading", { name: /flexible offer/ }).waitFor();
await settle(m, 1200);
await shot(m, "08-responsive/03-mobile-offers.png", { feature: "Offers on a phone" });

// ---------- 04 Bryntum + recovery (operator form, driver consent) ----------
const r0 = watch(await desk.newPage()); // operator context: bookings for the recovery night are made here
const rid = await book(r0, NIGHT_RECOVERY, "B");
const board = watch(await desk.newPage());
await board.goto(`/operator/schedule?night=${NIGHT_RECOVERY}`);
await board.locator(".b-scheduler").first().waitFor();
await settle(board, 1200);
await shot(board, "04-bryntum-recovery/01-original-schedule.png", { feature: "Bryntum: the committed plan before any disturbance" });

const op = watch(await desk.newPage());
await op.goto("/operator");
await op.getByLabel("Night of").fill(NIGHT_RECOVERY);
await op.getByRole("button", { name: "Load" }).click();
const panel = op.locator("section[aria-labelledby='recovery-title']");
await panel.getByRole("heading", { name: "Recovery engine" }).waitFor();
async function inject(id, type, slot, value) {
  await panel.locator("#rec-session").selectOption({ value: id });
  await panel.locator("#rec-type").selectOption({ value: type });
  await panel.locator("#rec-slot").fill(String(slot));
  if (value !== null && (await panel.locator("#rec-value").count())) await panel.locator("#rec-value").fill(String(value));
  await panel.getByRole("button", { name: "Inject SYNTHETIC disturbance" }).click();
  await panel.getByRole("heading", { name: "Recorded disturbances" }).waitFor();
  for (let i = 0; i < 40; i++) {
    const r = await reservation(id);
    const s = r.recovery?.runs?.[0]?.status;
    if (s && !/^(PENDING|RUNNING)$/.test(s)) return { status: s, runId: r.recovery.runs[0].runId };
    await op.waitForTimeout(750);
  }
  return { status: "TIMEOUT", runId: null };
}
// The charger at port B drops to 2.4 kW from 22:00 (slot 16 of a grid starting 18:00).
const first = await inject(rid, "CHARGER_POWER_REDUCTION", 16, 2400);
await settle(op, 1500);
await panel.scrollIntoViewIfNeeded();
await shot(op, "04-bryntum-recovery/02-charger-power-reduction.png", { target: panel, feature: `Operator records a SYNTHETIC charger power reduction; the run ends ${first.status}` });
checks.recovery = { severeCut: first };

// One booking per driver and night: every further booking uses a fresh driver session.
async function freshBooking(port) {
  const ctx = await b.newContext({ ...ctxOpts, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = watch(await ctx.newPage());
  return { page, id: await book(page, NIGHT_RECOVERY, port) };
}
const reloadOps = async () => {
  await op.reload();
  await op.getByLabel("Night of").fill(NIGHT_RECOVERY);
  await op.getByRole("button", { name: "Load" }).click();
  await panel.getByRole("heading", { name: "Recovery engine" }).waitFor();
};
// A milder cut on port C (4.8 kW from 22:00): recoverable.
let consent = await freshBooking("C");
await reloadOps();
let consentRun = await inject(consent.id, "CHARGER_POWER_REDUCTION", 16, 4800);
checks.recovery.mildCut = consentRun;
if (consentRun.status !== "NEEDS_APPROVAL") {
  await settle(op, 1500);
  await panel.scrollIntoViewIfNeeded();
  const tag = consentRun.status === "COMMITTED" ? "recovered-within-bounds" : consentRun.status === "INFEASIBLE" ? "no-feasible-recovery" : consentRun.status.toLowerCase();
  await shot(op, `04-bryntum-recovery/02b-power-cut-${tag}.png`, { target: panel, feature: `4.8 kW charger limit on port C: run ends ${consentRun.status}${consentRun.status === "COMMITTED" ? " inside the driver's pre-approved bounds, no prompt needed" : ""}` });
  // Show the consent path on an early departure, which always changes the agreed terms.
  consent = await freshBooking("A");
  await reloadOps();
  consentRun = await inject(consent.id, "EARLY_DEPARTURE", 0, 60);
  checks.recovery.earlyDeparture = consentRun;
}
const consentId = consent.id;
const runJson = consentRun.runId ? (await api(`/api/recovery/runs/${encodeURIComponent(consentRun.runId)}`)).run : null;
checks.recovery.consentRun = runJson ? { status: runJson.status, aiUsed: runJson.aiUsed, tools: [...new Set(runJson.trace.map((e) => e.tool))], validated: runJson.trace.filter((e) => e.tool === "validateRecoveryPlan").map((e) => e.outcome), versionBeforeConsent: latestVersion(await reservation(consentId)) } : null;

await board.reload();
await board.locator(".b-scheduler").first().waitFor();
await settle(board, 1500);
await showLowerPorts(board);
await shot(board, "04-bryntum-recovery/03-recovery-proposal.png", { feature: "Bryntum: proposed change in its own hatched lane, not committed" });
const detail = panel.locator("details").filter({ hasText: /Tool trace/ }).first();
if (await detail.count()) await detail.locator("summary").click();
await settle(op, 600);
const runDetail = panel.getByText(/Tool trace/).locator("xpath=ancestor::*[contains(@class,'card') or self::section or self::article][1]");
await shot(op, "04-bryntum-recovery/04-deterministic-validation.png", { target: (await runDetail.count()) ? runDetail : panel, feature: "Run detail: every candidate checked by validateRecoveryPlan before it can be proposed" });
const prov = panel.getByText(/DETERMINISTIC_FALLBACK|MODEL_DECISION/).first();
await shot(op, "05-ai-agentic-commerce/03-recovery-decision-provenance.png", { target: (await runDetail.count()) ? runDetail : panel, feature: `Decision provenance label: ${(await prov.count()) ? (await prov.innerText()).trim() : "n/a"}` });

const driver = consent.page;
await driver.goto(`/reservations/${consentId}`);
const consentHeading = driver.getByRole("heading", { name: "Charging change proposed" });
await consentHeading.waitFor({ timeout: 20_000 });
await settle(driver, 800);
const consentCard = consentHeading.locator("xpath=ancestor::*[contains(@class,'card') or self::section][1]");
await shot(driver, "04-bryntum-recovery/05-driver-consent-required.png", { target: consentCard, feature: "Driver sees what changes, what does not, and must approve before anything is committed" });
await driver.getByRole("button", { name: "Approve change" }).click();
await consentHeading.waitFor({ state: "hidden" });
for (let i = 0; i < 30 && latestVersion(await reservation(consentId)) < 2; i++) await driver.waitForTimeout(700);
await settle(driver, 1000);
checks.recovery.versionAfterConsent = latestVersion(await reservation(consentId));
await shot(driver, "04-bryntum-recovery/06-driver-approved-recovery.png", { feature: "After consent: committed schedule version 2" });
await board.getByRole("status").filter({ hasText: "Schedule updated by recovery" }).waitFor({ timeout: 20_000 }).catch(() => {});
await settle(board, 1200);
checks.recovery.boardUpdatedWithoutReload = (await board.getByRole("status").filter({ hasText: "Schedule updated by recovery" }).count()) > 0;
await showLowerPorts(board);
await shot(board, "04-bryntum-recovery/07-updated-bryntum-schedule.png", { feature: "Bryntum shows the committed recovery without a reload" });
await board.reload();
await board.locator(".b-scheduler").first().waitFor();
await settle(board, 1200);
const table = board.getByRole("table").first();
await table.scrollIntoViewIfNeeded();
checks.recovery.tableAfterReload = (await table.locator("tbody tr").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").slice(0, 140));
await shot(board, "04-bryntum-recovery/08-accessible-schedule-table.png", { target: table.locator("xpath=ancestor::*[contains(@class,'card') or self::section][1]"), feature: "Accessible table with the same schedule, after a reload" });

writeFileSync(path.join(SCRATCH, "capture-local-records.json"), JSON.stringify({ capturedAt: new Date().toISOString(), base: "local isolated MOCK server", records, checks }, null, 2));
await b.close();
console.log(JSON.stringify(checks, null, 1).slice(0, 5000));
