import { mkdirSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { OPERATOR_STATE } from "./constants";
import { settleAnimations } from "./settle";

/**
 * Automated certification sweep (MOCK payments, synthetic data, throwaway database). For every page at three viewports:
 * console errors, uncaught exceptions, failed network requests, horizontal overflow, clipped text and axe (WCAG 2.2 AA).
 * Vendor Bryntum markup is reported separately from application markup. Evidence is written to docs/evidence/certification.
 */
const OUT = "docs/evidence/certification";
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

interface PageResult {
  route: string;
  viewport: string;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  overflowPx: number;
  clipped: string[];
  axeApp: string[];
  axeVendor: string[];
}
const results: PageResult[] = [];

function nightAt(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Collects problems until `stop()` is called. Navigation-aborted prefetches (ERR_ABORTED) are not defects. */
function watch(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const onConsole = (m: import("@playwright/test").ConsoleMessage) => {
    if (m.type() === "error") consoleErrors.push(`${m.text().slice(0, 160)} @ ${m.location().url.slice(0, 80)}`);
  };
  const onPageError = (e: Error) => pageErrors.push(String(e).slice(0, 200));
  const onResponse = (r: import("@playwright/test").Response) => {
    if (r.status() >= 400 && !r.url().endsWith("favicon.ico")) failedRequests.push(`${r.status()} ${new URL(r.url()).pathname} (from ${page.url().replace(/^https?:\/\/[^/]+/, "")})`);
  };
  const onFailed = (r: import("@playwright/test").Request) => {
    const err = r.failure()?.errorText ?? "";
    if (!/ERR_ABORTED/.test(err)) failedRequests.push(`FAILED ${new URL(r.url()).pathname} ${err}`);
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);
  page.on("requestfailed", onFailed);
  const stop = () => {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("response", onResponse);
    page.off("requestfailed", onFailed);
  };
  return { consoleErrors, pageErrors, failedRequests, stop };
}

/** Visible elements whose text is cut off by their own box (single-line ellipsis excluded; those are deliberate). */
async function clippedText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *:not(script):not(style)"))) {
      if (el.closest(".b-scheduler, .b-grid")) continue;
      // Visually hidden text (.sr-only) is clipped to 1px on purpose and stays in the accessibility tree.
      if (el.closest(".sr-only")) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || !el.offsetParent) continue;
      if (cs.overflowX !== "hidden" && cs.overflowX !== "clip") continue;
      if (cs.textOverflow === "ellipsis" || cs.whiteSpace === "nowrap") continue;
      if (el.children.length === 0 && el.textContent?.trim() && el.scrollWidth > el.clientWidth + 2) out.push(`${el.tagName.toLowerCase()}: ${el.textContent.trim().slice(0, 50)}`);
    }
    return out.slice(0, 10);
  });
}

async function sweep(page: Page, route: string, vp: (typeof VIEWPORTS)[number], ready: () => Promise<void>): Promise<PageResult> {
  const w = watch(page);
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.goto(route);
  await ready();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await settleAnimations(page);
  const overflowPx = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const isVendor = (n: { target: unknown; html?: string }) => /[.#]b-|bryntum/i.test(JSON.stringify(n.target)) || /(class|id)="[^"]*b-/.test(n.html ?? "");
  const axeApp = serious.filter((v) => v.nodes.some((n) => !isVendor(n))).map((v) => `${v.impact}:${v.id} ${JSON.stringify(v.nodes.filter((n) => !isVendor(n)).map((n) => n.target).slice(0, 2))}`);
  const axeVendor = serious.filter((v) => v.nodes.every(isVendor)).map((v) => `${v.impact}:${v.id}`);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home"}-${vp.name}.png` });
  w.stop();
  const r: PageResult = { route, viewport: vp.name, consoleErrors: w.consoleErrors, pageErrors: w.pageErrors, failedRequests: w.failedRequests, overflowPx, clipped: await clippedText(page), axeApp, axeVendor };
  results.push(r);
  return r;
}

const PUBLIC_ROUTES: { route: string; ready: (p: Page) => Promise<void> }[] = [
  { route: "/", ready: async (p) => void (await expect(p.getByRole("heading").first()).toBeVisible()) },
  { route: "/drive", ready: async (p) => void (await expect(p.getByRole("heading", { name: "What does your car need tonight?" })).toBeVisible()) },
  { route: "/how-it-works", ready: async (p) => void (await expect(p.getByRole("heading").first()).toBeVisible()) },
  { route: "/impact-lab", ready: async (p) => void (await expect(p.getByRole("heading").first()).toBeVisible()) },
  { route: "/rewards", ready: async (p) => void (await expect(p.getByRole("heading").first()).toBeVisible()) },
];

test.describe("page sweep: public pages at desktop, tablet and mobile", () => {
  test.setTimeout(240_000);
  test("no console errors, exceptions, failed requests, overflow, clipped text or serious axe findings", async ({ page }) => {
    for (const vp of VIEWPORTS) for (const p of PUBLIC_ROUTES) await sweep(page, p.route, vp, () => p.ready(page));
    const bad = results.filter((r) => r.consoleErrors.length || r.pageErrors.length || r.failedRequests.length || r.overflowPx > 0 || r.clipped.length || r.axeApp.length);
    expect(bad, JSON.stringify(bad, null, 1)).toEqual([]);
  });
});

test.describe("page sweep: operator pages", () => {
  test.use({ storageState: OPERATOR_STATE });
  test.setTimeout(240_000);
  test("operator console and schedule: application markup clean; Bryntum vendor findings reported separately", async ({ page, request }) => {
    const night = nightAt(70);
    const seeded = await request.post("/api/operator/demo", { data: { action: "seed", nightOf: night }, headers: { Origin: "http://localhost:3107" } });
    expect(seeded.ok()).toBe(true);
    for (const vp of VIEWPORTS) {
      await sweep(page, "/operator", vp, async () => void (await expect(page.getByRole("heading").first()).toBeVisible()));
      await sweep(page, `/operator/schedule?night=${night}`, vp, async () => void (await expect(page.locator(".b-scheduler").first()).toBeVisible()));
    }
    const ops = results.filter((r) => r.route.startsWith("/operator"));
    const bad = ops.filter((r) => r.consoleErrors.length || r.pageErrors.length || r.failedRequests.length || r.overflowPx > 0 || r.clipped.length || r.axeApp.length);
    expect(bad, JSON.stringify(bad, null, 1)).toEqual([]);
  });
});

async function bookViaWizard(page: Page, night: string): Promise<string> {
  await page.goto("/drive");
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

async function snapshot(request: Pick<Page, "request">["request"], id: string): Promise<{ paymentState: string; amountCents?: number; serviceState?: string }> {
  const res = await request.get(`/api/reservations/${encodeURIComponent(id)}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { reservation: { paymentState: string; amountCents?: number; serviceState?: string } }).reservation;
}

test.describe("driver journey with console and network monitoring (mock payments)", () => {
  test.setTimeout(180_000);
  test("quote, approve, authorize, progress, charge, FlexReceipt; every page of the journey is clean", async ({ page }) => {
    const w = watch(page);
    const id = await bookViaWizard(page, nightAt(63));
    await page.screenshot({ path: `${OUT}/journey-1-authorized.png` });
    expect((await snapshot(page.request, id)).paymentState).toBe("AUTHORIZED");

    await page.getByRole("button", { name: "Run the synthetic overnight charge" }).click();
    await expect(page.getByRole("heading", { name: "FlexReceipt" })).toBeVisible();
    await page.screenshot({ path: `${OUT}/journey-2-flexreceipt.png` });
    const receipt = page.getByRole("region", { name: "FlexReceipt" });
    await expect(receipt.getByText("SYNTHETIC", { exact: false }).first()).toBeVisible();
    const after = await snapshot(page.request, id);
    expect(after.paymentState).toBe("CAPTURED");
    await expect(receipt.getByText(/captur/i).first()).toBeVisible();
    if (after.amountCents) await expect(receipt).toContainText((after.amountCents / 100).toFixed(2));

    for (const link of ["Rewards", "Impact Lab", "How it works"]) {
      const nav = page.getByRole("navigation").getByRole("link", { name: new RegExp(`^${link}`, "i") }).first();
      if (await nav.isVisible().catch(() => false)) {
        await nav.click();
        await expect(page.getByRole("heading").first()).toBeVisible();
      }
    }
    expect({ console: w.consoleErrors, pageErrors: w.pageErrors, failed: w.failedRequests }).toEqual({ console: [], pageErrors: [], failed: [] });
  });
});

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/sweep-results.json`, JSON.stringify({ label: "SYNTHETIC / MOCK", pages: results }, null, 2));
});
