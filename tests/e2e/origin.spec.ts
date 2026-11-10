import { expect, test } from "@playwright/test";

/**
 * Regression: the wizard returned "Request origin not allowed." when the app was opened on 127.0.0.1 while
 * APP_BASE_URL (playwright.config.ts) is http://localhost:3107. Runs the production build in MOCK mode.
 */
const LOOPBACK_IP = "http://127.0.0.1:3107";
const night = () => new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);
const body = () => ({ portId: "port_a", nightOf: night(), plugInLocal: "19:00", departLocal: "07:00", targetBatteryKWh: 20, spendCapCents: 2000 });

test.describe("See offers across loopback origins", () => {
  for (const base of ["http://localhost:3107", LOOPBACK_IP]) {
    test(`wizard advances from Step 01 to Step 02 when opened at ${base}`, async ({ page }) => {
      await page.goto(`${base}/drive`);
      await page.getByRole("radio", { name: /^Port A/ }).check();
      await page.getByLabel("Night of").fill(night());
      await page.getByLabel("Plug in").fill("19:00");
      await page.getByLabel("Ready by (next morning)").fill("07:00");
      await page.getByLabel("Energy into battery (kWh)").fill("20");
      await page.getByLabel("Budget (USD)").fill("20.00");
      await page.getByRole("button", { name: "See offers" }).click();
      await expect(page.getByText("Request origin not allowed.")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: /flexible offer|cannot be met/ })).toBeVisible();
    });
  }
});

test.describe("origin protection is preserved", () => {
  test("a foreign Origin, a missing Origin and a different loopback port are refused with 403 BAD_ORIGIN", async ({ request }) => {
    for (const origin of ["https://evil.example", "http://127.0.0.1:3999", undefined]) {
      const res = await request.post(`${LOOPBACK_IP}/api/quotes`, { data: body(), headers: origin ? { Origin: origin } : {} });
      expect(res.status(), String(origin)).toBe(403);
      expect((await res.json()).error.code).toBe("BAD_ORIGIN");
    }
  });

  test("an allowed loopback Origin is accepted by the offers endpoint", async ({ request }) => {
    const res = await request.post(`${LOOPBACK_IP}/api/quotes`, { data: body(), headers: { Origin: LOOPBACK_IP } });
    expect(res.status()).toBe(200);
  });

  test("a CORS preflight from a foreign origin gets no allow headers (no CORS is configured)", async ({ request }) => {
    const res = await request.fetch(`${LOOPBACK_IP}/api/quotes`, { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
    expect(res.headers()["access-control-allow-origin"]).toBeUndefined();
  });
});
