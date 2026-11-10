import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { OPERATOR_STATE } from "./constants";

/**
 * Independent QA evidence run: one real recovery event from a booked charge to a persisted, validated, approved
 * schedule change visible in Bryntum, with screenshots and the structured trace written to artifacts/qa/evidence.
 * MOCK payment provider, SYNTHETIC energy, no model credentials: the recovery decision is DETERMINISTIC_FALLBACK
 * and is labelled as such. It is never reported as a live Gemini decision.
 */
const ORIGIN = "http://localhost:3107";
const OUT = "artifacts/qa/evidence";
const NIGHT = new Date(Date.now() + 41 * 86_400_000).toISOString().slice(0, 10);
const EVENT_ID = "qa-evidence-evt-0001";

interface Snapshot {
  id: string;
  departMs: number;
  recovery: { versions: { version: number; source?: string }[]; runs: { runId: string; status: string }[] } | null;
}

async function book(page: Page): Promise<string> {
  await page.goto("/drive");
  await expect(page.getByRole("heading", { name: "What does your car need tonight?" })).toBeVisible();
  await page.getByRole("radio", { name: /^Port B/ }).check();
  await page.getByLabel("Night of").fill(NIGHT);
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

async function snapshot(request: APIRequestContext, id: string): Promise<Snapshot> {
  const res = await request.get(`/api/reservations/${encodeURIComponent(id)}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { reservation: Snapshot }).reservation;
}

const latest = (s: Snapshot) => Math.max(...(s.recovery?.versions.map((v) => v.version) ?? [1]));

test.describe("recovery evidence run", () => {
  test.use({ storageState: OPERATOR_STATE, viewport: { width: 1440, height: 1000 } });
  test.setTimeout(180_000);

  test("booked charge -> disturbance -> durable run -> validated proposal -> consent -> committed version -> Bryntum, persisted", async ({ page, request }) => {
    mkdirSync(OUT, { recursive: true });
    const shot = (name: string, p: Page = page) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

    const id = await book(page);
    const before = await snapshot(request, id);
    expect(latest(before)).toBe(1);

    // 1. Original schedule in Bryntum.
    const board = await page.context().newPage();
    await board.goto(`/operator/schedule?night=${NIGHT}`);
    await expect(board.locator(".b-scheduler").first()).toBeVisible();
    await expect(board.getByText(/Port B/).first()).toBeVisible();
    await board.waitForTimeout(800);
    await shot("01-original-schedule", board);

    // 2. A charger event is recorded (synthetic). The open board must pick it up without a reload.
    const inject = await request.post("/api/recovery/events", {
      data: { eventId: EVENT_ID, reservationId: id, type: "EARLY_DEPARTURE", params: { departMs: before.departMs - 3_600_000 }, effectiveSlot: 0 },
      headers: { Origin: ORIGIN },
    });
    expect(inject.status()).toBe(201);
    const eventBody = (await inject.json()) as { event: { eventId: string; type: string; createdBy: string } };
    await expect(board.getByText(/SYNTHETIC/).first()).toBeVisible({ timeout: 15_000 });
    await board.waitForTimeout(800);
    await shot("02-disruption-detected-bryntum", board);

    // 3. The durable run proposes a change that needs the driver's consent.
    await expect.poll(async () => (await snapshot(request, id)).recovery?.runs[0]?.status, { timeout: 30_000 }).toBe("NEEDS_APPROVAL");
    const runId = (await snapshot(request, id)).recovery!.runs.find((r) => r.status === "NEEDS_APPROVAL")!.runId;
    const runRes = await request.get(`/api/recovery/runs/${encodeURIComponent(runId)}`);
    expect(runRes.ok()).toBe(true);
    const run = ((await runRes.json()) as { run: { runId: string; eventId: string; status: string; aiUsed: boolean; trace: { tool?: string; kind?: string }[]; proposal: unknown; proposalVersion: number | null; expiresAt: string | null; explanation: { source: string } | null } }).run;
    expect(run.eventId).toBe(EVENT_ID);
    expect(run.proposal).not.toBeNull();
    expect(latest(await snapshot(request, id))).toBe(1); // nothing committed before consent

    await page.reload();
    await expect(page.getByRole("heading", { name: "Charging change proposed" })).toBeVisible();
    await shot("03-agent-recommendation-needs-consent");
    await board.reload();
    await expect(board.locator(".b-scheduler").first()).toBeVisible();
    await shot("03b-bryntum-pending-proposal-lane", board);

    // 4. Driver consents; the exact proposal version is committed.
    await page.getByRole("button", { name: "Approve change" }).click();
    await expect(page.getByRole("heading", { name: "Charging change proposed" })).toBeHidden();
    await expect.poll(async () => latest(await snapshot(request, id)), { timeout: 20_000 }).toBe(2);
    await shot("04-validated-recovery-committed");

    // 5. Bryntum shows the new version without a manual reload, then 6. it persists across reload.
    await expect(board.getByRole("status").filter({ hasText: "Schedule updated by recovery" })).toBeVisible({ timeout: 15_000 });
    await board.waitForTimeout(800);
    await shot("05-updated-bryntum-schedule", board);
    await board.reload();
    await expect(board.locator(".b-scheduler").first()).toBeVisible();
    await board.waitForTimeout(800);
    await shot("06-persisted-after-reload", board);
    const rows = await board.getByRole("table").locator("tbody tr").allInnerTexts();
    expect(rows.join(" ")).toMatch(/v2/);

    const after = await snapshot(request, id);
    const finalRun = ((await (await request.get(`/api/recovery/runs/${encodeURIComponent(runId)}`)).json()) as { run: { status: string; outcome: unknown } }).run;
    const decisionSource = run.aiUsed ? "MOCK_OR_REAL_GEMINI_UNVERIFIED" : "DETERMINISTIC_FALLBACK";
    expect(decisionSource).toBe("DETERMINISTIC_FALLBACK"); // this run has no model credentials by construction

    writeFileSync(
      `${OUT}/recovery-trace.json`,
      JSON.stringify(
        {
          label: "SYNTHETIC",
          decisionSource,
          reservationId: id,
          night: NIGHT,
          eventId: eventBody.event.eventId,
          eventType: eventBody.event.type,
          eventCreatedBy: eventBody.event.createdBy,
          runId,
          runStatusBeforeConsent: run.status,
          aiUsed: run.aiUsed,
          toolTrace: run.trace,
          proposal: run.proposal,
          proposalVersion: run.proposalVersion,
          proposalExpiresAt: run.expiresAt,
          consent: "driver approved the exact proposal version",
          runStatusAfterConsent: finalRun.status,
          outcome: finalRun.outcome,
          committedVersions: after.recovery?.versions,
          committedVersionNumber: latest(after),
        },
        null,
        2,
      ),
    );
  });
});

test.describe("recovery evidence run: charger slows down (consent requested when the change needs it)", () => {
  test.use({ storageState: OPERATOR_STATE, viewport: { width: 1440, height: 1000 } });
  test.setTimeout(180_000);

  test("charger power cut -> validated recovery committed without a prompt -> Bryntum updates -> synthetic delivery -> FlexReceipt", async ({ page, request }) => {
    mkdirSync(OUT, { recursive: true });
    const shot = (name: string, p: Page = page) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    const night = new Date(Date.now() + 43 * 86_400_000).toISOString().slice(0, 10);
    const eventId = "qa-evidence-evt-0002";

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
    const id = new URL(page.url()).pathname.split("/").pop()!;
    await shot("10-charging-promise-accepted");

    const board = await page.context().newPage();
    await board.goto(`/operator/schedule?night=${night}`);
    await expect(board.locator(".b-scheduler").first()).toBeVisible();
    await board.waitForTimeout(800);
    await shot("11-before-charger-slows", board);

    // The charger slows from 22:00 (slot 16 of a grid that starts at 18:00) to 4.8 kW.
    const inject = await request.post("/api/recovery/events", { data: { eventId, reservationId: id, type: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 4_800 }, effectiveSlot: 16 }, headers: { Origin: ORIGIN } });
    expect(inject.status()).toBe(201);
    await expect.poll(async () => (await snapshot(request, id)).recovery?.runs[0]?.status ?? "NONE", { timeout: 30_000 }).not.toMatch(/^(NONE|PENDING|RUNNING)$/);
    const snap = await snapshot(request, id);
    const runId = snap.recovery!.runs[0]!.runId;
    test.info().annotations.push({ type: "run-status", description: snap.recovery!.runs[0]!.status });
    const run = ((await (await request.get(`/api/recovery/runs/${encodeURIComponent(runId)}`)).json()) as { run: { status: string; aiUsed: boolean; trace: unknown[]; outcome: { kind?: string; consent?: unknown } | null } }).run;
    expect(run.aiUsed).toBe(false); // no model credentials in this run: DETERMINISTIC_FALLBACK
    // The power cut moves energy, so the engine asks for consent unless the change stays inside pre-approved bounds.
    expect(["COMMITTED", "NEEDS_APPROVAL"]).toContain(run.status);
    if (run.status === "NEEDS_APPROVAL") {
      expect(latest(await snapshot(request, id))).toBe(1); // nothing committed before consent
      await page.reload();
      await expect(page.getByRole("heading", { name: "Charging change proposed" })).toBeVisible();
      await shot("12a-consent-requested-before-commit");
      await page.getByRole("button", { name: "Approve change" }).click();
      await expect(page.getByRole("heading", { name: "Charging change proposed" })).toBeHidden();
    }
    await expect.poll(async () => latest(await snapshot(request, id)), { timeout: 20_000 }).toBe(2);

    await expect(board.getByRole("status").filter({ hasText: "Schedule updated by recovery" })).toBeVisible({ timeout: 15_000 });
    await board.waitForTimeout(800);
    await shot("12-bryntum-after-charger-slows-recovered", board);

    await page.reload();
    await shot("13-driver-sees-committed-recovery");
    await page.getByRole("button", { name: "Run the synthetic overnight charge" }).click();
    await expect(page.getByRole("heading", { name: "FlexReceipt" })).toBeVisible();
    await page.waitForTimeout(8_000); // the charging panel counts up slowly; let it finish before the evidence shot
    await shot("14-flexreceipt");
    const after = (await (await request.get(`/api/reservations/${encodeURIComponent(id)}`)).json()) as { reservation: { paymentState: string; serviceState: string } };

    writeFileSync(
      `${OUT}/recovery-trace-power-cut.json`,
      JSON.stringify({ label: "SYNTHETIC", decisionSource: "DETERMINISTIC_FALLBACK", reservationId: id, eventId, eventType: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 4800, effectiveSlot: 16 }, runId, runStatus: run.status, consent: run.outcome, toolTrace: run.trace, committedVersion: latest(snap), serviceState: after.reservation.serviceState, paymentState: after.reservation.paymentState }, null, 2),
    );
    expect(after.reservation.serviceState).toBe("DELIVERED");
    expect(after.reservation.paymentState).toBe("CAPTURED");
  });
});
