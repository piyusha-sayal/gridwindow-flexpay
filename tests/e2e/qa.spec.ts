/**
 * QA certification: keyboard-only journeys (desktop), geometric layout checks and a full axe report
 * (every impact level) per viewport. Findings are written to artifacts/qa/ for review.
 */
import { mkdir, writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { OPERATOR_PASSPHRASE, OPERATOR_STATE } from "./constants";
import { settleAnimations } from "./settle";

test.describe.configure({ mode: "serial" });
test.use({ storageState: OPERATOR_STATE });

const nightAt = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

interface Focused {
  tag: string;
  id: string;
  name: string;
  visible: boolean;
}

/** Describes document.activeElement, including whether it shows a visible focus indicator. */
function focused(page: Page): Promise<Focused> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { tag: "body", id: "", name: "", visible: false };
    const ring = (e: Element) => {
      const cs = getComputedStyle(e);
      return (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none";
    };
    // Visually hidden radios (segmented control) draw their ring on the wrapping label.
    const visible = ring(el) || (!!el.closest("label") && ring(el.closest("label")!));
    const name = (el.getAttribute("aria-label") ?? el.textContent ?? (el as HTMLInputElement).value ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
    return { tag: el.tagName.toLowerCase(), id: el.id, name, visible };
  });
}

/** Presses Tab until `match` holds, asserting every stop has a visible focus indicator. */
async function tabUntil(page: Page, match: (f: Focused) => boolean, max = 80): Promise<Focused[]> {
  const path: Focused[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const f = await focused(page);
    path.push(f);
    expect(f.visible, `focus indicator missing on <${f.tag} id="${f.id}"> "${f.name}"`).toBe(true);
    if (match(f)) return path;
  }
  throw new Error(`never reached target; last stops: ${path.slice(-5).map((f) => `${f.tag}#${f.id}:${f.name}`).join(" | ")}`);
}

test.describe("keyboard-only journeys", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "keyboard journeys run on desktop"));

  test("driver: request → offers → explanation → terms → mock checkout → reservation → FlexReceipt", async ({ page }) => {
    await page.goto("/drive");
    await expect(page.getByLabel("Energy into battery (kWh)")).toBeVisible();

    const first = await tabUntil(page, () => true, 1);
    expect(first[0]!.name).toBe("Skip to content");

    await tabUntil(page, (f) => f.id === "nl");
    await page.keyboard.type("Need 30 kWh by 7am, at most $20, port A");
    await page.keyboard.press("Tab");
    expect((await focused(page)).name).toBe("Fill form");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Deterministic fallback \(no AI\)/)).toBeAttached();

    // A future night, so the run never depends on wall-clock time (after midnight the default night's
    // window may already have started and the approval-deadline guard would correctly refuse it).
    await page.getByLabel("Night of").fill(nightAt(25));
    await page.getByLabel("Plug in").fill("19:00"); // explicit: the default follows the wall clock
    await page.getByLabel("Ready by (next morning)").fill("07:00");
    await page.getByRole("button", { name: "Fill form" }).focus();
    const toNight = await tabUntil(page, (f) => f.id === "night");
    // Logical tab order through the form, top-left to bottom-right.
    const path = [...toNight, ...(await tabUntil(page, (f) => f.name.startsWith("See offers")))];
    const order = ["kwh", "plugin", "depart", "night", "port-port_a", "cap"].map((id) => path.findIndex((f) => f.id === id));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: /flexible offer|cannot be met/ })).toBeVisible();

    // Radio group: arrow keys move the selection between offers.
    await tabUntil(page, (f) => f.id.startsWith("offer-"));
    const radios = page.locator('input[name="offer"]');
    const before = await radios.evaluateAll((els) => els.findIndex((e) => (e as HTMLInputElement).checked));
    await page.keyboard.press("ArrowDown");
    const after = await radios.evaluateAll((els) => els.findIndex((e) => (e as HTMLInputElement).checked));
    expect(after).not.toBe(before);

    await tabUntil(page, (f) => f.name.startsWith("Why is it cheaper?"));
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Deterministic fallback \(no AI\)/).first()).toBeAttached();

    await tabUntil(page, (f) => f.name === "Review and approve");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Approve these exact terms" })).toBeVisible();

    await tabUntil(page, (f) => f.id === "consent");
    await page.keyboard.press("Space");
    await expect(page.getByRole("checkbox")).toBeChecked();
    await tabUntil(page, (f) => f.name.startsWith("Approve $"));
    await page.keyboard.press("Enter");

    await expect(page.getByText("MOCK PAYMENT PROVIDER: this is not PayPal")).toBeVisible();
    await tabUntil(page, (f) => f.name === "Approve (mock)");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Authorized, not captured.", { exact: false })).toBeVisible();

    await tabUntil(page, (f) => f.name === "Run the synthetic overnight charge");
    await page.keyboard.press("Enter");
    const receipt = page.getByRole("region", { name: "FlexReceipt" });
    await expect(receipt.getByText(/^Paid \$\d+\.\d{2}, capture confirmed by provider$/)).toBeVisible();

    await tabUntil(page, (f) => f.id === "ask");
    await page.keyboard.type("When was I charged?");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Payment: CAPTURED via MOCK provider/)).toBeVisible();
  });

  test("driver: invalid input moves focus to the first invalid field with an announced error", async ({ page }) => {
    await page.goto("/drive");
    await expect(page.getByLabel("Energy into battery (kWh)")).toBeVisible();
    await tabUntil(page, (f) => f.id === "kwh");
    await page.keyboard.press("Control+A");
    await page.keyboard.type("500");
    await tabUntil(page, (f) => f.name.startsWith("See offers"));
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await focused(page)).id).toBe("kwh");
    const kwh = page.getByLabel("Energy into battery (kWh)");
    await expect(kwh).toHaveAttribute("aria-invalid", "true");
    await expect(kwh).toHaveAccessibleDescription(/Enter between 0\.01 and 120 kWh\./);
  });

  test.describe("operator", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("operator: sign-in, demo seed, timeline → details (focus in/out), permitted action, reset confirmation", async ({ page }) => {
      await page.goto("/operator");
      await expect(page.getByLabel("Passphrase")).toBeVisible();
      await tabUntil(page, (f) => f.id === "pass");
      await page.keyboard.type(OPERATOR_PASSPHRASE);
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { level: 1, name: / at Harbor Lane/ })).toBeVisible();

      // A future night, so seeding never depends on wall-clock time (see the driver journey).
      const night = nightAt(26);
      await page.getByLabel("Night of").fill(night);
      await page.getByRole("button", { name: "Load" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: `Seed background drivers for ${night}` })).toBeVisible();

      await tabUntil(page, (f) => f.name.startsWith("Seed background drivers"));
      await page.keyboard.press("Enter");
      await expect(page.getByText(/Seeded 2 background reservation/)).toBeVisible();

      // Destructive reset: confirmation receives focus on the safe choice; Escape cancels back to the trigger.
      await tabUntil(page, (f) => f.name === "Reset demo data…");
      await page.keyboard.press("Enter");
      await expect.poll(async () => (await focused(page)).name).toBe("Keep data");
      await page.keyboard.press("Escape");
      await expect.poll(async () => (await focused(page)).name).toBe("Reset demo data…");

      // Timeline: each parked vehicle is a focusable button that opens details.
      await tabUntil(page, (f) => f.name.startsWith("Reservation res_"));
      const opener = await focused(page);
      await page.keyboard.press("Enter");
      await expect.poll(async () => (await focused(page)).id).toBe("detail-title");
      await expect(page.getByText("Event trail")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByText("Event trail")).toHaveCount(0);
      await expect.poll(async () => (await focused(page)).name).toBe(opener.name);

      // Permitted action from the table.
      const captured = page.locator("tbody code", { hasText: /^CAPTURED$/ });
      const before = await captured.count();
      await tabUntil(page, (f) => f.name === "Deliver");
      await page.keyboard.press("Enter");
      await expect(captured).toHaveCount(before + 1);
    });
  });
});

interface LayoutIssue {
  page: string;
  issue: string;
}

/** Geometric checks that do not need image review: horizontal scroll, off-viewport elements, clipped text, tiny targets. */
async function layoutIssues(page: Page, name: string): Promise<LayoutIssue[]> {
  const issues = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrolls horizontally (${document.documentElement.scrollWidth}px > ${vw}px)`);
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
      const label = `<${el.tagName.toLowerCase()} class="${(el.getAttribute("class") ?? "").slice(0, 40)}"> "${(el.textContent ?? "").trim().slice(0, 30)}"`;
      if (r.width > 0 && r.right > vw + 1) out.push(`extends past viewport by ${Math.round(r.right - vw)}px: ${label}`);
      if (el.children.length === 0 && (cs.overflowX === "hidden" || cs.textOverflow === "ellipsis") && el.scrollWidth > el.clientWidth + 1 && (el.textContent ?? "").trim()) {
        out.push(`clipped text: ${label}`);
      }
      if (el.matches("button, input:not([type=radio]):not([type=checkbox]), select, a.btn") && r.width > 0 && (r.width < 24 || r.height < 24)) {
        out.push(`target smaller than 24×24 (${Math.round(r.width)}×${Math.round(r.height)}): ${label}`);
      }
    }
    return Array.from(new Set(out));
  });
  return issues.map((issue) => ({ page: name, issue }));
}

test("layout and full axe report per viewport (all impacts)", async ({ page }, info: TestInfo) => {
  test.setTimeout(120_000);
  const night = nightAt({ desktop: 21, tablet: 22, mobile: 23 }[info.project.name] ?? 24);
  const layout: LayoutIssue[] = [];
  const axe: { page: string; id: string; impact: string | null | undefined; help: string; nodes: number; targets: string[] }[] = [];
  const audit = async (name: string) => {
    await settleAnimations(page);
    layout.push(...(await layoutIssues(page, name)));
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
    for (const v of r.violations) axe.push({ page: name, id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) });
  };

  await page.goto("/");
  await audit("home");
  await page.goto("/drive");
  await page.getByLabel("Energy into battery (kWh)").fill("500");
  await page.getByRole("button", { name: "See offers" }).click();
  await expect(page.getByText("Enter between 0.01 and 120 kWh.")).toBeVisible();
  await audit("drive-validation-errors");
  await page.getByLabel("Energy into battery (kWh)").fill("30");
  await page.getByLabel("Night of").fill(night);
  await page.getByLabel("Plug in").fill("19:00"); // explicit: the default follows the wall clock
  await page.getByLabel("Ready by (next morning)").fill("07:00");
  await page.getByRole("button", { name: "See offers" }).click();
  await expect(page.getByRole("heading", { name: /flexible offer|cannot be met/ })).toBeVisible();
  await page.getByRole("button", { name: "Why is it cheaper?" }).first().click();
  await expect(page.getByText(/Deterministic fallback/).first()).toBeAttached();
  await audit("drive-offers-terms");
  await page.getByRole("button", { name: "Review and approve" }).click();
  await audit("drive-approve-terms");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /^Approve \$/ }).click();
  await expect(page.getByRole("button", { name: "Approve (mock)" })).toBeVisible();
  await audit("mock-checkout");
  await page.getByRole("button", { name: "Approve (mock)" }).click();
  await expect(page.getByText("Authorized, not captured.", { exact: false })).toBeVisible();
  await audit("reservation-authorized");
  await page.getByRole("button", { name: "Run the synthetic overnight charge" }).click();
  await expect(page.getByRole("region", { name: "FlexReceipt" })).toBeVisible();
  await audit("reservation-receipt");
  await page.goto("/operator");
  await page.getByLabel("Night of").fill(night);
  await page.getByRole("button", { name: "Load" }).click();
  // Desktop shows a table row, narrow screens a card; whichever is displayed must show the capture.
  await expect(page.locator("tbody tr, li").filter({ hasText: "CAPTURED" }).filter({ visible: true })).toHaveCount(1);
  await page.getByRole("button", { name: /^Reservation res_.*parked/ }).first().click();
  await expect(page.getByText("Event trail")).toBeVisible();
  await audit("operator-with-detail");
  await page.goto("/impact-lab");
  await audit("benchmark");

  await mkdir("artifacts/qa", { recursive: true });
  await writeFile(`artifacts/qa/layout-${info.project.name}.json`, JSON.stringify(layout, null, 2) + "\n");
  await writeFile(`artifacts/qa/axe-${info.project.name}.json`, JSON.stringify(axe, null, 2) + "\n");
  expect(layout.map((l) => `${l.page}: ${l.issue}`)).toEqual([]);
  expect(axe.map((a) => `${a.page}: [${a.impact}] ${a.id} ×${a.nodes} ${a.targets.join(", ")}`)).toEqual([]);
});
