/**
 * Failover model at the trust boundary (MOCK provider, PGlite, scripted models): when the primary model is down the
 * fallback model gets the same bounded prompt and the same tool validators, can never reach the payment gateway, cannot
 * change prices or payment state, and its provider is recorded honestly. Offline: no live model call.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { DEMO_STATION } from "@/domain/station";
import { SLOT_MS } from "@/domain/units";
import { FailoverLlm } from "@/server/ai/failoverLlm";
import type { LlmResult, ModelProvider, StructuredLlm } from "@/server/ai/llm";
import { getReservation } from "@/server/repo";
import { acceptOffer, handleCheckoutReturn } from "@/server/services/checkoutService";
import { orchestrateRecovery } from "@/server/services/recoveryOrchestrator";
import { recordedModelProvider } from "@/server/services/recoveryProvenance";
import { createQuote, scenarioFor } from "@/server/services/quoteService";
import { operatorDashboard } from "@/server/services/viewService";
import { ScriptedLlm, ok } from "../unit/scriptedLlm";
import { makeApp, NIGHT, request, resetApp, type TestApp } from "./helpers";

const DRIVER = "drv_failover_1";
let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});
beforeEach(async () => {
  await resetApp(app);
  app.deps.llm = null;
  app.deps.awaitRecovery = true;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterAll(async () => {
  await app.db.close();
});

const grid = scenarioFor(DEMO_STATION, NIGHT).grid;
const slotAt = (iso: string) => (Date.parse(iso) - grid.startMs) / SLOT_MS;
const PLUG_SLOT = slotAt("2026-11-06T03:00:00Z");
const EVENING_SLOT = slotAt("2026-11-06T06:00:00Z");
const EARLY_DEPART_MS = Date.parse("2026-11-06T12:00:00Z");

/** A model that is down for the whole test. */
class DownModel implements StructuredLlm {
  readonly provider: ModelProvider = "gemini";
  readonly model = "gemini-3.8-flash";
  prompts: string[] = [];
  async generate<S extends z.ZodType>(req: { user: string }): Promise<LlmResult<z.infer<S>>> {
    this.prompts.push(req.user);
    return { ok: false, reason: "UNAVAILABLE" };
  }
}

/** Scripted tool calls presented as the OpenRouter adapter, so provenance can be asserted. */
function asOpenRouter(...calls: [string, Record<string, unknown>?][]): StructuredLlm & { scripted: ScriptedLlm } {
  const queue = calls.map(([tool, args = {}]) => ({ tool, argsJson: JSON.stringify(args) }));
  const scripted = new ScriptedLlm(() => ok(queue.shift() ?? { tool: "noop", argsJson: "{}" }));
  return {
    provider: "openrouter",
    model: "anthropic/claude-haiku-5.5",
    scripted,
    generate: (req) => scripted.generate(req),
  };
}

async function scheduled(session: string): Promise<string> {
  const quote = await createQuote(app.deps, session, request({}));
  const offer = quote.offers.find((o) => o.kind === "flex_gentle")!;
  const accepted = await acceptOffer(app.deps, session, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
  const r = (await getReservation(app.db, accepted.reservationId))!;
  const order = await app.mock.approve(r.paypal_order_id!);
  const state = new URL(order.returnUrl).searchParams.get("state")!;
  await handleCheckoutReturn(app.deps, session, accepted.reservationId, state, r.paypal_order_id!);
  return accepted.reservationId;
}

async function insertDisturbance(rid: string, eventId: string, type: string, params: Record<string, number>, effectiveSlot: number): Promise<void> {
  await app.db.query("insert into disruption_events (id, event_id, reservation_id, type, params, effective_slot, created_by) values ($1, $2, $3, $4, $5, $6, 'TEST')", [
    `dis_${eventId}`,
    eventId,
    rid,
    type,
    JSON.stringify(params),
    effectiveSlot,
  ]);
}

const rejected = (trace: { actor: string; outcome: string; detail: string }[]) => trace.filter((t) => t.actor === "GEMINI" && t.outcome === "REJECTED").map((t) => t.detail);

describe("Gemini down, fallback model answering", () => {
  it("payment and settlement tool names from the fallback are refused, the gateway is never called, price and payment state are unchanged", async () => {
    const rid = await scheduled(DRIVER);
    await insertDisturbance(rid, "evt_fo_0001", "CHARGER_POWER_REDUCTION", { maxPowerW: 7_200 }, EVENING_SLOT);
    const before = (await getReservation(app.db, rid))!;
    const gatewayBefore = app.gateway.calls.length;
    const fallback = asOpenRouter(
      ["captureAuthorization"],
      ["voidAuthorization"],
      ["createOrder"],
      ["refundPayment"],
      ["requestRecoveryCandidates"],
      ["validateRecoveryPlan", { candidateId: "c1" }],
      ["proposeRecovery", { candidateId: "c1" }],
      ["commitPermittedRecovery"],
    );
    app.deps.llm = new FailoverLlm(new DownModel(), fallback);

    const run = await orchestrateRecovery(app.deps, "evt_fo_0001");

    expect(rejected(run.trace).join(" | ").match(/UNKNOWN_TOOL/g)).toHaveLength(4);
    expect(run.status).toBe("COMMITTED");
    expect(app.gateway.calls.length).toBe(gatewayBefore);
    const after = (await getReservation(app.db, rid))!;
    expect(after.payment_state).toBe(before.payment_state);
    expect(after.amount_cents).toBe(before.amount_cents);
    expect(after.paypal_capture_id).toBeNull();
    // The label names the provider that actually answered, not the one that was configured first.
    expect(recordedModelProvider(run.trace)).toBe("openrouter");
  });

  it("the fallback cannot commit a change that needs the driver: human approval is preserved", async () => {
    const rid = await scheduled(DRIVER);
    await insertDisturbance(rid, "evt_fo_0002", "EARLY_DEPARTURE", { departMs: EARLY_DEPART_MS }, PLUG_SLOT);
    app.deps.llm = new FailoverLlm(new DownModel(), asOpenRouter(["requestRecoveryCandidates"], ["validateRecoveryPlan", { candidateId: "c1" }], ["proposeRecovery", { candidateId: "c1" }], ["commitPermittedRecovery"]));
    const run = await orchestrateRecovery(app.deps, "evt_fo_0002");
    expect(run.status).toBe("NEEDS_APPROVAL");
    expect(rejected(run.trace).join(" | ")).toMatch(/NOT_AUTO_PERMITTED|NOT_PROPOSED/);
  });

  it("the fallback receives the same bounded prompt as the primary, with no payment identifiers", async () => {
    const rid = await scheduled(DRIVER);
    await insertDisturbance(rid, "evt_fo_0003", "CHARGER_POWER_REDUCTION", { maxPowerW: 7_200 }, EVENING_SLOT);
    const primary = new DownModel();
    const fallback = asOpenRouter(["readStationState"]);
    app.deps.llm = new FailoverLlm(primary, fallback);
    await orchestrateRecovery(app.deps, "evt_fo_0003");
    const first = fallback.scripted.calls[0]!;
    expect(first.user).toBe(primary.prompts[0]);
    expect(first.user).not.toMatch(/powerW|paypal|PAY-|driver|drv_|authorization|capture|order/i);
  });

  it("both models down: the run finishes through the deterministic path and the dashboard shows AI as unavailable", async () => {
    const rid = await scheduled(DRIVER);
    await insertDisturbance(rid, "evt_fo_0004", "CHARGER_POWER_REDUCTION", { maxPowerW: 7_200 }, EVENING_SLOT);
    const gatewayBefore = app.gateway.calls.length;
    const fallbackDown: StructuredLlm = { provider: "openrouter", model: "anthropic/claude-haiku-5.5", generate: async () => ({ ok: false, reason: "UNAVAILABLE" }) };
    app.deps.llm = new FailoverLlm(new DownModel(), fallbackDown);
    const run = await orchestrateRecovery(app.deps, "evt_fo_0004");
    expect(["COMMITTED", "NEEDS_APPROVAL", "INFEASIBLE"]).toContain(run.status);
    expect(app.gateway.calls.length).toBe(gatewayBefore);
    expect((await operatorDashboard(app.deps, NIGHT)).ai).toEqual({ state: "DOWN", label: "AI unavailable: labelled deterministic explanations" });
  });
});
