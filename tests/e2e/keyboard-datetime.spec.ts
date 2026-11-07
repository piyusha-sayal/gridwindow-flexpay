/**
 * Keyboard certification for the native segmented date and time inputs (desktop Chromium).
 * Chromium orders the date segments by the OS locale, so the test probes the order first.
 * Values are typed and adjusted with the keyboard only; the request actually sent to the server is
 * checked, so a field that looks right but never reaches React state fails here.
 */
import { expect, test, type Page } from "@playwright/test";
import { OPERATOR_STATE } from "./constants";

test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "segmented native inputs are certified on desktop Chromium"));

const isoAt = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const digits = (iso: string, dayFirst: boolean) =>
  dayFirst ? `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}` : `${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(0, 4)}`;

/** Types 01-02-2026 into the focused date field and reports whether the field is day-first. */
async function probeDayFirst(page: Page): Promise<boolean> {
  await page.keyboard.type("01022026");
  const value = await page.locator("#night").inputValue();
  expect(["2026-01-02", "2026-02-01"]).toContain(value);
  return value === "2026-02-01";
}

async function tabTo(page: Page, id: string) {
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    if ((await page.evaluate(() => document.activeElement?.id)) === id) return;
  }
  throw new Error(`Tab never reached #${id}`);
}

test("date and time fields accept typed values, arrow-key changes and reach the quote request", async ({ page }) => {
  await page.goto("/drive");
  const night = page.locator("#night");
  const plugin = page.locator("#plugin");
  const depart = page.locator("#depart");
  await expect(night).toBeVisible();

  const target = isoAt(4);
  await tabTo(page, "night");
  const dayFirst = await probeDayFirst(page);
  // Typing again from the first segment overwrites the whole date.
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.type(digits(target, dayFirst));
  await expect(night).toHaveValue(target);
  // Arrow keys change the active segment and reverse cleanly.
  await page.keyboard.press("ArrowUp");
  await expect(night).not.toHaveValue(target);
  await page.keyboard.press("ArrowDown");
  await expect(night).toHaveValue(target);

  await tabTo(page, "plugin");
  // 12-hour fields take the trailing "P"; 24-hour fields ignore it, then 19:45 is typed directly.
  await page.keyboard.type("0745P");
  const twelveHour = (await plugin.inputValue()) === "19:45";
  if (!twelveHour) {
    await expect(plugin).toHaveValue("07:45");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.type("1945");
  }
  await expect(plugin).toHaveValue("19:45");
  await page.keyboard.press("ArrowUp");
  await expect(plugin).not.toHaveValue("19:45");
  await page.keyboard.press("ArrowDown");
  await expect(plugin).toHaveValue("19:45");

  await tabTo(page, "depart");
  await page.keyboard.type(twelveHour ? "0630A" : "0630");
  await expect(depart).toHaveValue("06:30");

  await tabTo(page, "cap");
  const sent = page.waitForRequest((r) => r.url().endsWith("/api/quotes") && r.method() === "POST");
  await page.keyboard.press("Enter");
  const body = (await sent).postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({ nightOf: target, plugInLocal: "19:45", departLocal: "06:30" });
  await expect(page.getByRole("heading", { name: /flexible offer|cannot be met/ })).toBeVisible();
});

test("a partially cleared date is rejected with focus on the field and a linked error", async ({ page }) => {
  await page.goto("/drive");
  const night = page.locator("#night");
  await tabTo(page, "night");
  await page.keyboard.press("Backspace"); // clears the active segment → the input's value becomes ""
  await expect(night).toHaveValue("");
  await tabTo(page, "cap");
  await page.keyboard.press("Enter");
  await expect(night).toBeFocused();
  await expect(night).toHaveAttribute("aria-invalid", "true");
  const describedBy = (await night.getAttribute("aria-describedby")) ?? "";
  expect(describedBy.split(" ").some((id) => id.endsWith("error") || id.includes("err"))).toBe(true);
});

test.describe("operator", () => {
  test.use({ storageState: OPERATOR_STATE });

  test("night picker: typed date and Enter load that night's dashboard", async ({ page }) => {
    await page.goto("/operator");
    const night = page.locator("#night");
    await expect(night).not.toHaveValue("");
    await night.focus();
    const dayFirst = await probeDayFirst(page);
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    const target = isoAt(9);
    await page.keyboard.type(digits(target, dayFirst));
    await expect(night).toHaveValue(target);
    const loaded = page.waitForResponse((r) => r.url().includes(`/api/operator/dashboard?night=${target}`) && r.ok());
    await page.keyboard.press("Enter"); // submits the Load form from inside the field
    await loaded;
    await expect(night).toHaveValue(target);
  });
});
