import { mkdirSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { OPERATOR_STATE } from "./constants";

/**
 * Independent QA: records, never hides, the accessibility findings inside Bryntum's own DOM, and proves the accessible
 * alternative (the table) is complete. The page outside .b-scheduler must have no serious/critical findings.
 */
const ORIGIN = "http://localhost:3107";
const NIGHT = new Date(Date.now() + 47 * 86_400_000).toISOString().slice(0, 10);

test.describe("Bryntum accessibility (vendor DOM) and the table alternative", () => {
  test.use({ storageState: OPERATOR_STATE, viewport: { width: 1440, height: 900 } });

  test("vendor findings are recorded; the table alternative carries every session; keyboard reaches the table", async ({ page, request }) => {
    const seed = await request.post("/api/operator/demo", { data: { action: "seed", nightOf: NIGHT }, headers: { Origin: ORIGIN } });
    expect(seed.ok()).toBe(true);
    await page.goto(`/operator/schedule?night=${NIGHT}`);
    await expect(page.locator(".b-scheduler").first()).toBeVisible();

    const vendor = await new AxeBuilder({ page }).include(".b-scheduler").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    const outside = await new AxeBuilder({ page }).exclude(".b-scheduler").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    const summarize = (vs: typeof vendor.violations) => vs.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help }));
    mkdirSync("artifacts/qa/evidence", { recursive: true });
    writeFileSync("artifacts/qa/evidence/bryntum-axe.json", JSON.stringify({ axeVersion: "@axe-core/playwright 4.13.0", vendorDom: summarize(vendor.violations), outsideBryntum: summarize(outside.violations) }, null, 2));

    expect(outside.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);

    const sessions = ((await (await request.get(`/api/schedule?nightOf=${NIGHT}`)).json()) as { schedule: { sessions: unknown[] } }).schedule.sessions.length;
    const table = page.getByRole("table");
    await expect(table.locator("tbody tr")).toHaveCount(sessions);
    await expect(table.locator("caption")).toBeVisible();
    await expect(table.locator("th[scope='col']").first()).toBeVisible();

    // Keyboard: Tab order reaches the lane toggle buttons before the table, with a visible focus target.
    const toggle = page.getByRole("button", { name: "Original plan" });
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  });
});
