/**
 * Independent QA evidence for the agentic recovery path, with the decision source labelled per run:
 *   MOCK_GEMINI            a scripted stand-in for the model drives the real orchestrator, tools and validators
 *   DETERMINISTIC_FALLBACK the model is unavailable or hostile; the deterministic path decides
 * REAL_GEMINI is deliberately absent: no live model request is made by this suite.
 * Writes artifacts/qa/evidence/agent-paths.json. MOCK payment provider, SYNTHETIC energy, in-memory PGlite.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO_STATION } from "@/domain/station";
import { SLOT_MS } from "@/domain/units";
import type { LlmResult, StructuredLlm } from "@/server/ai/llm";
import { getReservation } from "@/server/repo";
import { acceptOffer, handleCheckoutReturn } from "@/server/services/checkoutService";
import { createQuote, scenarioFor } from "@/server/services/quoteService";
import { recordDisruption, runRecovery } from "@/server/services/scheduleService";
import { runSimulation } from "@/server/services/settlementService";
import { ScriptedLlm, ok } from "../unit/scriptedLlm";
import { makeApp, NIGHT, request, resetApp, type TestApp } from "./helpers";

let app: TestApp;
const evidence: Record<string, unknown> = {};
const grid = scenarioFor(DEMO_STATION, NIGHT).grid;
const EVENING_SLOT = (Date.parse("2026-11-06T06:00:00Z") - grid.startMs) / SLOT_MS;

beforeAll(async () => {
  app = await makeApp();
});
beforeEach(async () => {
  await resetApp(app);
  app.deps.llm = null;
  app.deps.awaitRecovery = true;
});
afterAll(async () => {
  mkdirSync("artifacts/qa/evidence", { recursive: true });
  writeFileSync("artifacts/qa/evidence/agent-paths.json", JSON.stringify({ label: "SYNTHETIC", REAL_GEMINI: "NOT RUN (needs user approval; earlier live attempt returned HTTP 504)", ...evidence }, null, 2));
  await app.db.close();
});

async function scheduled(session: string): Promise<string> {
  const quote = await createQuote(app.deps, session, request());
  const offer = quote.offers.find((o) => o.kind === "flex_gentle")!;
  const accepted = await acceptOffer(app.deps, session, { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true });
  const r = (await getReservation(app.db, accepted.reservationId))!;
  const order = await app.mock.approve(r.paypal_order_id!);
  await handleCheckoutReturn(app.deps, session, accepted.reservationId, new URL(order.returnUrl).searchParams.get("state")!, r.paypal_order_id!);
  return accepted.reservationId;
}

const script = (...calls: [string, Record<string, unknown>?][]) => {
  const q = calls.map(([tool, args = {}]) => ({ tool, argsJson: JSON.stringify(args) }));
  return new ScriptedLlm(() => ok(q.shift() ?? { tool: "noop", argsJson: "{}" }));
};
const failing = (reason: "TIMEOUT" | "UNAVAILABLE"): StructuredLlm => ({ model: "test-failing", generate: async (): Promise<LlmResult<never>> => ({ ok: false, reason }) }) as StructuredLlm;
const cut = (rid: string, eventId: string) => recordDisruption(app.deps, { eventId, reservationId: rid, type: "CHARGER_POWER_REDUCTION", params: { maxPowerW: 7_200 }, effectiveSlot: EVENING_SLOT });
const paymentCalls = () => app.gateway.calls.filter((c) => /capture|void|authorize|createOrder/i.test(c));

describe("agent recovery paths, labelled by decision source", () => {
  it("MOCK_GEMINI: scripted model calls the server tools, the validators accept, consent is pre-approved bounds, version 2 commits, capture follows delivery", async () => {
    const rid = await scheduled("drv_agent_1");
    app.deps.llm = script(
      ["requestRecoveryCandidates"],
      ["validateRecoveryPlan", { candidateId: "c1" }],
      ["proposeRecovery", { candidateId: "c1" }],
      ["commitPermittedRecovery"],
      ["explainRecoveryOutcome", { text: "The charger limit applies from that time, and the agreed price stays the same." }],
    );
    const { event } = await cut(rid, "qa-agent-mock-0001");
    const run = await runRecovery(app.deps, event.eventId);
    expect(run.status).toBe("COMMITTED");
    expect(run.aiUsed).toBe(true);
    const callsBeforeSettlement = paymentCalls();
    expect(callsBeforeSettlement.filter((c) => c !== "createOrder" && c !== "authorizeOrder" && c !== "getOrder")).toEqual([]);
    const settled = await runSimulation(app.deps, rid, { kind: "OPERATOR" });
    expect(settled.payment_state).toBe("CAPTURED");
    evidence.MOCK_GEMINI = { eventId: event.eventId, runId: run.runId, status: run.status, tools: run.trace.map((t) => `${t.seq}:${t.actor}:${t.tool}:${t.outcome}`), consent: "AUTO_WITHIN_PRE_APPROVED_BOUNDS", finalPayment: settled.payment_state, explanationSource: run.explanation?.source };
    expect(run.trace.some((t) => t.actor === "GEMINI")).toBe(true);
  });

  it("DETERMINISTIC_FALLBACK: a model timeout leaves a labelled deterministic result and the same validated commit", async () => {
    const rid = await scheduled("drv_agent_2");
    app.deps.llm = failing("TIMEOUT");
    const { event } = await cut(rid, "qa-agent-fallback-0001");
    const run = await runRecovery(app.deps, event.eventId);
    expect(run.status).toBe("COMMITTED");
    expect(run.trace.some((t) => t.actor === "GEMINI" && t.outcome === "OK")).toBe(false);
    expect(run.trace.every((t) => t.actor !== "GEMINI" || t.outcome !== "OK")).toBe(true);
    expect(run.trace.some((t) => t.actor === "DETERMINISTIC")).toBe(true);
    evidence.DETERMINISTIC_FALLBACK_after_model_timeout = { eventId: event.eventId, runId: run.runId, status: run.status, aiUsed: run.aiUsed, tools: run.trace.map((t) => `${t.seq}:${t.actor}:${t.tool}:${t.outcome}`) };
    // A fallback decision must never be presented as a model decision.
    expect(run.explanation?.source).not.toBe("MODEL");
  });

  it("hostile model: a payment tool, a hallucinated candidate and extra fields are refused, nothing financial runs, and the deterministic path completes", async () => {
    const rid = await scheduled("drv_agent_3");
    const before = paymentCalls().length;
    app.deps.llm = script(["capturePayment", { amountCents: 99_999 }], ["requestRecoveryCandidates"], ["proposeRecovery", { candidateId: "c999" }], ["validateRecoveryPlan", { candidateId: "c1", powerW: [99999] }]);
    const { event } = await cut(rid, "qa-agent-hostile-0001");
    const run = await runRecovery(app.deps, event.eventId);
    expect(paymentCalls().length).toBe(before);
    expect(run.trace.filter((t) => t.actor === "GEMINI" && t.outcome === "OK").map((t) => t.tool)).not.toContain("capturePayment");
    expect(["COMMITTED", "NEEDS_APPROVAL", "NO_CHANGE", "INFEASIBLE"]).toContain(run.status);
    const r = (await getReservation(app.db, rid))!;
    expect(r.payment_state).toBe("AUTHORIZED");
    evidence.HOSTILE_MODEL_OUTPUT = { eventId: event.eventId, runId: run.runId, status: run.status, refused: run.trace.filter((t) => t.outcome !== "OK" && t.outcome !== "INFO").map((t) => `${t.seq}:${t.tool}:${t.outcome}:${t.detail}`), paymentCallsAdded: paymentCalls().length - before, paymentStateAfter: r.payment_state };
  });
});
