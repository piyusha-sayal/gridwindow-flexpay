/**
 * MOCK-only operator tooling: scripted pending/declined captures and the demo seed/reset.
 * Proves the app's state handling for these provider answers, not PayPal behavior.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AppDeps } from "@/server/deps";
import { getReservation } from "@/server/repo";
import { resetDemoData, seedDemoNight } from "@/server/services/demoService";
import { recoverReservation } from "@/server/services/recoveryService";
import { runSimulation } from "@/server/services/settlementService";
import { operatorDashboard, reservationView } from "@/server/services/viewService";
import { makeApp, NIGHT, resetApp, type TestApp } from "./helpers";

let app: TestApp;
let deps: AppDeps;

beforeAll(async () => {
  app = await makeApp();
  deps = { ...app.deps, gateway: app.mock };
});
afterAll(async () => app.db.close());
beforeEach(async () => resetApp(app));

describe("demo seed and reset", () => {
  it("seeds background reservations through the real checkout path and resets them", async () => {
    const ids = await seedDemoNight(deps, NIGHT);
    expect(ids.length).toBe(2);
    for (const id of ids) {
      const r = (await getReservation(app.db, id))!;
      expect(r.payment_state).toBe("AUTHORIZED");
      expect(r.slots_committed).toBe(true);
    }
    const d = await operatorDashboard(deps, NIGHT);
    expect(d.sessions.map((s) => s.portId).sort()).toEqual(["port_b", "port_c"]);
    expect(d.sessions.every((s) => s.baselinePowerW.length > 0 && s.discountCents > 0)).toBe(true);
    await resetDemoData(deps);
    expect((await operatorDashboard(deps, NIGHT)).sessions).toEqual([]);
  });
});

describe("scripted MOCK capture outcomes", () => {
  async function authorizedId(): Promise<string> {
    return (await seedDemoNight(deps, NIGHT))[0]!;
  }

  it("PENDING capture shows no payment success until the provider completes it", async () => {
    const id = await authorizedId();
    const r = (await getReservation(app.db, id))!;
    await app.mock.scriptCaptureOutcome(r.paypal_authorization_id!, "PENDING");
    expect((await runSimulation(deps, id, { kind: "OPERATOR" })).payment_state).toBe("CAPTURE_PENDING");
    let view = await reservationView(deps, id, { operator: true });
    expect(view.proofs.some((p) => p.type === "CAPTURED")).toBe(false);

    await app.mock.resolvePendingCapture((await getReservation(app.db, id))!.paypal_capture_id!, "COMPLETED");
    await recoverReservation(deps, id, "OPERATOR");
    view = await reservationView(deps, id, { operator: true });
    expect(view.paymentState).toBe("CAPTURED");
    expect(view.proofs.some((p) => p.type === "CAPTURED")).toBe(true);
  });

  it("DECLINED capture is terminal, releases capacity and is never retried", async () => {
    const id = await authorizedId();
    const r = (await getReservation(app.db, id))!;
    await app.mock.scriptCaptureOutcome(r.paypal_authorization_id!, "DECLINED");
    const after = await runSimulation(deps, id, { kind: "OPERATOR" });
    expect(after.payment_state).toBe("CAPTURE_DECLINED");
    expect(after.slots_committed).toBe(false);
    await recoverReservation(deps, id, "OPERATOR");
    const captures = await app.db.query("select id from mock_provider_objects where kind = 'capture'");
    expect(captures.length).toBe(1);
    expect((await getReservation(app.db, id))!.payment_state).toBe("CAPTURE_DECLINED");
  });
});
