/** Lease fencing for orchestrator commits: only the live worker of the current attempt can write a version. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LEASE_MS } from "@/server/services/recoveryOrchestrator";
import type { ServiceError } from "@/server/deps";
import { getReservation, effectivePowerOf } from "@/server/repo";
import { handleCheckoutReturn, acceptOffer } from "@/server/services/checkoutService";
import { createQuote } from "@/server/services/quoteService";
import { commitScheduleVersion } from "@/server/services/scheduleService";
import { makeApp, request, resetApp, type TestApp } from "./helpers";

const DRIVER = "drv_fence_1";
let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
  app.deps.awaitRecovery = true;
});
beforeEach(async () => {
  await resetApp(app);
});
afterAll(async () => {
  await app.db.close();
});

async function scheduled(session: string): Promise<string> {
  const quote = await createQuote(app.deps, session, request());
  const offer = quote.offers.find((o) => o.kind === "flex_lowest_cost")!;
  const accepted = await acceptOffer(app.deps, session, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
  const r = (await getReservation(app.db, accepted.reservationId))!;
  const order = await app.mock.approve(r.paypal_order_id!);
  const state = new URL(order.returnUrl).searchParams.get("state")!;
  await handleCheckoutReturn(app.deps, session, accepted.reservationId, state, r.paypal_order_id!);
  return accepted.reservationId;
}

/** A disturbance that leaves the agreed plan valid, plus a RUNNING run held by one worker. */
async function runningRun(rid: string, runId: string, eventId: string, attempts: number, leaseUntil: number): Promise<void> {
  await app.db.query(
    "insert into disruption_events (id, event_id, reservation_id, type, params, effective_slot, created_by) values ($1, $2, $3, 'CHARGER_FAILURE', '{}', 60, 'TEST')",
    [`dis_${eventId}`, eventId, rid],
  );
  await app.db.query(
    "insert into recovery_runs (id, disruption_event_id, status, attempts, lease_until) values ($1, $2, 'RUNNING', $3, $4::timestamptz)",
    [runId, eventId, attempts, new Date(leaseUntil).toISOString()],
  );
}

const versionRows = async (rid: string) =>
  app.db.query<{ version: number }>("select version from schedule_versions where reservation_id = $1 order by version", [rid]);
const runStatus = async (runId: string) => (await app.db.query<{ status: string }>("select status from recovery_runs where id = $1", [runId]))[0]!.status;

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code } satisfies Partial<ServiceError>);
}

describe("lease-fenced schedule commits", () => {
  it("a stale worker whose lease was taken over is refused and writes nothing", async () => {
    const rid = await scheduled(DRIVER);
    const plan = [...(await effectivePowerOf(app.db, (await getReservation(app.db, rid))!))];
    // Attempt 1 died; attempt 2 took the run over with a live lease.
    await runningRun(rid, "rrun_stale_1", "evt_stale_0001", 2, app.clock.now + LEASE_MS);
    const staleFence = { attempt: 1, lease: new Date(app.clock.now + LEASE_MS) };

    await expectCode(commitScheduleVersion(app.deps, rid, 1, plan, "stale worker", "rrun_stale_1", 60, staleFence), "LEASE_LOST");
    expect(await versionRows(rid)).toEqual([]);
    expect(await runStatus("rrun_stale_1")).toBe("RUNNING");
  });

  it("a worker whose lease expired without a takeover is refused: fail closed", async () => {
    const rid = await scheduled(DRIVER);
    const plan = [...(await effectivePowerOf(app.db, (await getReservation(app.db, rid))!))];
    const expired = app.clock.now - 1_000;
    await runningRun(rid, "rrun_expired_1", "evt_expired_01", 1, expired);

    await expectCode(commitScheduleVersion(app.deps, rid, 1, plan, "expired lease", "rrun_expired_1", 60, { attempt: 1, lease: new Date(expired) }), "LEASE_LOST");
    expect(await versionRows(rid)).toEqual([]);
  });

  it("two concurrent workers holding the same live lease: exactly one version is written", async () => {
    const rid = await scheduled(DRIVER);
    const plan = [...(await effectivePowerOf(app.db, (await getReservation(app.db, rid))!))];
    const lease = new Date(app.clock.now + LEASE_MS);
    await runningRun(rid, "rrun_race_1", "evt_race_fence1", 1, lease.getTime());
    const fence = { attempt: 1, lease };

    const results = await Promise.allSettled([
      commitScheduleVersion(app.deps, rid, 1, plan, "worker A", "rrun_race_1", 60, fence),
      commitScheduleVersion(app.deps, rid, 1, plan, "worker B", "rrun_race_1", 60, fence),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: expect.stringMatching(/^(LEASE_LOST|VERSION_CONFLICT|RUN_NOT_OPEN)$/) });
    expect(await versionRows(rid)).toEqual([{ version: 2 }]);
    expect(await runStatus("rrun_race_1")).toBe("COMMITTED");
  });

  it("a duplicate commit for the same run and version is rejected and leaves one version row", async () => {
    const rid = await scheduled(DRIVER);
    const plan = [...(await effectivePowerOf(app.db, (await getReservation(app.db, rid))!))];
    const lease = new Date(app.clock.now + LEASE_MS);
    await runningRun(rid, "rrun_dup_1", "evt_dup_fence01", 1, lease.getTime());
    const fence = { attempt: 1, lease };

    await commitScheduleVersion(app.deps, rid, 1, plan, "first", "rrun_dup_1", 60, fence);
    await expectCode(commitScheduleVersion(app.deps, rid, 1, plan, "duplicate", "rrun_dup_1", 60, fence), "LEASE_LOST");
    expect(await versionRows(rid)).toEqual([{ version: 2 }]);
  });
});
