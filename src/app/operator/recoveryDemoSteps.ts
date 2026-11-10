/**
 * Scenario C checklist: maps one recorded disturbance's persisted run and payment state to the steps the operator
 * is shown. Display only. Every status comes from the run record or the reservation; nothing is assumed.
 */
import type { PaymentState } from "@/domain/paymentState";
import type { RecoveryRunView } from "@/server/services/recoveryRuns";
import { runProvenance, SIMULATED_EVENT_LABEL } from "@/server/services/recoveryProvenance";

export interface ScenarioStep {
  id: "event" | "agent" | "validation" | "schedule" | "consent" | "financial" | "receipt";
  title: string;
  /** done: recorded; pending: not produced yet; none: this path does not produce a step result. */
  status: "done" | "pending" | "none";
  detail: string;
}

export interface ScenarioStepInput {
  eventId: string;
  /** Provenance column of the stored disturbance (SYNTHETIC for every recorded disturbance); null when unknown. */
  eventProvenance: string | null;
  run: RecoveryRunView | null;
  paymentState: PaymentState;
  providerMode: string;
}

const RECEIPT_PAYMENT_STATES = new Set<PaymentState>(["CAPTURED", "VOIDED"]);

/** Labels the provider from the reservation's own mode, so a mock run is never presented as PayPal. */
export function providerLabel(providerMode: string): string {
  return providerMode === "MOCK" ? "MOCK provider (simulated, not PayPal)" : "PayPal Sandbox (test money)";
}

/** SIMULATED_EVENT only when the stored disturbance says so; any other provenance is shown as unknown. */
function eventDetail(input: ScenarioStepInput): string {
  const label = input.eventProvenance === "SYNTHETIC" ? SIMULATED_EVENT_LABEL : "event source not recorded";
  return `${label} · event ${input.eventId}`;
}

function agentStep(run: RecoveryRunView | null): ScenarioStep {
  if (!run) return { id: "agent", title: "Agent run", status: "pending", detail: "No run recorded yet." };
  const provenance = runProvenance(run);
  return { id: "agent", title: "Agent run", status: "done", detail: `${provenance.decisionLabel} · ${provenance.reason} (${run.trace.length} trace entries)` };
}

function validationStep(run: RecoveryRunView | null): ScenarioStep {
  const outcome = run?.outcome;
  if (!outcome) return { id: "validation", title: "Deterministic validation", status: "pending", detail: "Validation has not finished." };
  return { id: "validation", title: "Deterministic validation", status: "done", detail: outcome.reason };
}

function scheduleStep(run: RecoveryRunView | null): ScenarioStep {
  const outcome = run?.outcome;
  if (!outcome) return { id: "schedule", title: "Schedule", status: "pending", detail: "No schedule result yet." };
  if (outcome.kind === "COMMITTED") {
    return { id: "schedule", title: "Schedule", status: "done", detail: `Schedule version ${outcome.versionCommitted ?? "?"} written` };
  }
  if (outcome.kind === "NEEDS_APPROVAL") return { id: "schedule", title: "Schedule", status: "done", detail: "Proposal only, no version written" };
  return { id: "schedule", title: "Schedule", status: "done", detail: "Infeasible or failed: no version written" };
}

function consentStep(run: RecoveryRunView | null): ScenarioStep {
  const status = run?.status;
  if (!status) return { id: "consent", title: "Consent state", status: "pending", detail: "Not decided yet." };
  if (status === "COMMITTED") return { id: "consent", title: "Consent state", status: "done", detail: "AUTO_COMMIT, within pre-approved bounds" };
  if (status === "NEEDS_APPROVAL") return { id: "consent", title: "Consent state", status: "done", detail: "NEEDS_DRIVER_APPROVAL" };
  if (status === "APPROVED") return { id: "consent", title: "Consent state", status: "done", detail: "DRIVER_APPROVED" };
  if (status === "REJECTED") return { id: "consent", title: "Consent state", status: "done", detail: "Declined by driver" };
  if (status === "EXPIRED") return { id: "consent", title: "Consent state", status: "done", detail: "Proposal expired before a decision" };
  return { id: "consent", title: "Consent state", status: "none", detail: `Run ${status}: no consent step` };
}

function financialStep(input: ScenarioStepInput): ScenarioStep {
  const settled = RECEIPT_PAYMENT_STATES.has(input.paymentState);
  return {
    id: "financial",
    title: "Financial outcome",
    status: "done",
    detail: `${input.paymentState} · ${providerLabel(input.providerMode)}${settled ? "" : " · not settled yet"}`,
  };
}

function receiptStep(input: ScenarioStepInput): ScenarioStep {
  const ready = RECEIPT_PAYMENT_STATES.has(input.paymentState);
  return {
    id: "receipt",
    title: "FlexReceipt",
    status: ready ? "done" : "pending",
    detail: ready ? "Available on the driver's reservation page" : "Appears on the driver's reservation page after settlement",
  };
}

/** The seven Scenario C steps, in the order the demo script walks through them. */
export function buildScenarioSteps(input: ScenarioStepInput): ScenarioStep[] {
  const { run } = input;
  return [
    { id: "event", title: "Disturbance detected", status: "done", detail: eventDetail(input) },
    agentStep(run),
    validationStep(run),
    scheduleStep(run),
    consentStep(run),
    financialStep(input),
    receiptStep(input),
  ];
}
