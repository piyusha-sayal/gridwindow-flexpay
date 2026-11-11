/**
 * Scenario C checklist: maps one recorded disturbance's persisted run and payment state to the steps the operator
 * is shown. Display only. Every status comes from the run record or the reservation; nothing is assumed.
 */
import type { PaymentState } from "@/domain/paymentState";
import type { RecoveryReceiptRun } from "@/server/services/recoveryReceipt";
import type { RecoveryRunView } from "@/server/services/recoveryRuns";
import { runProvenance, SIMULATED_EVENT_LABEL } from "@/server/services/recoveryProvenance";

export interface ScenarioStep {
  id: "event" | "agent" | "validation" | "schedule" | "consent" | "financial" | "receipt";
  title: string;
  /**
   * done: recorded; pending: not produced yet; stopped: ended without this step's result (a failed run, or a payment
   * that failed, was declined or was cancelled); none: this path does not produce a step result.
   */
  status: "done" | "pending" | "stopped" | "none";
  detail: string;
}

export interface ScenarioStepInput {
  eventId: string;
  /** Provenance column of the stored disturbance (SYNTHETIC for every recorded disturbance); null when unknown. */
  eventProvenance: string | null;
  run: RecoveryRunView | null;
  /** The reservation's consent record for this run, kept with the schedule version it wrote; null when none was written. */
  consent: RecoveryReceiptRun["consent"];
  paymentState: PaymentState;
  /** Types of the reservation's payment proofs. A proof is recorded only from a provider response. */
  proofTypes: readonly string[];
  providerMode: string;
}

/** Settled outcomes. Each counts only once the provider's proof of the same type is recorded. */
const SETTLED_PAYMENT_STATES = new Set<PaymentState>(["CAPTURED", "VOIDED"]);

/** Payments that ended without settling. Nothing was collected (the NOT_REALIZED economics, less VOIDED). */
const ENDED_UNSETTLED: Partial<Record<PaymentState, string>> = {
  CAPTURE_DECLINED: "capture declined by the provider, nothing collected",
  FAILED: "payment failed, nothing collected",
  CANCELLED: "payment cancelled, nothing collected",
};

/** Why an open payment is not settled yet. */
const OPEN_PAYMENT_NOTE: Partial<Record<PaymentState, string>> = {
  QUOTE_ACCEPTED: "no order yet",
  ORDER_CREATED: "waiting for buyer approval",
  BUYER_APPROVED: "authorization not confirmed yet",
  AUTHORIZED: "funds held, not captured",
  CAPTURE_PENDING: "capture not confirmed by the provider",
  NEEDS_RECONCILIATION: "being checked against the provider",
};

/** Labels the provider from the reservation's own mode, so a mock run is never presented as PayPal. */
export function providerLabel(providerMode: string): string {
  return providerMode === "MOCK" ? "MOCK provider (simulated, not PayPal)" : "PayPal Sandbox (test money)";
}

/** SIMULATED_EVENT only when the stored disturbance says so; any other provenance is shown as unknown. */
function eventDetail(input: ScenarioStepInput): string {
  const label = input.eventProvenance === "SYNTHETIC" ? SIMULATED_EVENT_LABEL : "event source not recorded";
  return `${label} · event ${input.eventId}`;
}

/** A RUNNING record has no decision yet, so its provenance is shown only once the run has ended. */
function agentStep(run: RecoveryRunView | null): ScenarioStep {
  const base = { id: "agent", title: "Agent run" } as const;
  if (!run) return { ...base, status: "pending", detail: "No run recorded yet." };
  const entries = `${run.trace.length} trace entries`;
  if (run.status === "RUNNING") return { ...base, status: "pending", detail: `Run in progress, no decision recorded yet (${entries} so far)` };
  const provenance = runProvenance(run);
  if (run.status === "FAILED") return { ...base, status: "stopped", detail: `Run failed · ${provenance.decisionLabel} (${entries})` };
  return { ...base, status: "done", detail: `${provenance.decisionLabel} · ${provenance.reason} (${entries})` };
}

/** The outcome saved while a run is still RUNNING is provisional (its commit can still fail), so it waits for the run to end. */
function validationStep(run: RecoveryRunView | null): ScenarioStep {
  const base = { id: "validation", title: "Deterministic validation" } as const;
  if (!run || run.status === "RUNNING") return { ...base, status: "pending", detail: "Validation has not finished." };
  const outcome = run.outcome;
  if (outcome?.kind === "FAILED") return { ...base, status: "stopped", detail: outcome.reason };
  if (!outcome) {
    return run.status === "FAILED"
      ? { ...base, status: "stopped", detail: "The run failed before a validated result was recorded." }
      : { ...base, status: "pending", detail: "No validated result recorded yet." };
  }
  return { ...base, status: "done", detail: outcome.reason };
}

/** Schedule version this run wrote: on the run for an automatic commit, on the reservation for a driver approval. */
function writtenVersion(input: ScenarioStepInput): number | null {
  const onRun = input.run?.outcome?.versionCommitted ?? null;
  if (onRun !== null) return onRun;
  return input.consent?.method === "DRIVER_APPROVED" ? input.consent.version : null;
}

/** COMMITTED is written in the same transaction as the schedule version, so it is the evidence that one exists. */
function scheduleStep(input: ScenarioStepInput): ScenarioStep {
  const { run } = input;
  const base = { id: "schedule", title: "Schedule" } as const;
  if (!run || run.status === "RUNNING") return { ...base, status: "pending", detail: "No schedule result yet." };
  switch (run.status) {
    case "COMMITTED": {
      const version = writtenVersion(input);
      return { ...base, status: "done", detail: version === null ? "Schedule version written" : `Schedule version ${version} written` };
    }
    case "NEEDS_APPROVAL":
      return { ...base, status: "pending", detail: "Proposal only, no version written until the driver approves" };
    case "APPROVED":
      return { ...base, status: "pending", detail: "Driver approved, schedule version not written yet" };
    case "INFEASIBLE":
      return { ...base, status: "none", detail: "Infeasible: no version written" };
    case "REJECTED":
      return { ...base, status: "none", detail: "Declined by driver: no version written" };
    case "EXPIRED":
      return { ...base, status: "none", detail: "Proposal expired: no version written" };
    case "FAILED":
      return { ...base, status: "stopped", detail: "Run failed: no version written" };
  }
}

function consentStep(input: ScenarioStepInput): ScenarioStep {
  const { run } = input;
  const base = { id: "consent", title: "Consent state" } as const;
  if (!run || run.status === "RUNNING") return { ...base, status: "pending", detail: "Not decided yet." };
  switch (run.status) {
    case "COMMITTED": {
      // The reservation's consent record decides; a run read before that record existed uses the receipt's own rule.
      const driverApproved = input.consent ? input.consent.method === "DRIVER_APPROVED" : run.proposal !== null;
      return { ...base, status: "done", detail: driverApproved ? "DRIVER_APPROVED" : "AUTO_COMMIT, within pre-approved bounds" };
    }
    case "NEEDS_APPROVAL":
      return { ...base, status: "pending", detail: "NEEDS_DRIVER_APPROVAL · waiting for the driver's decision" };
    case "APPROVED":
      return { ...base, status: "done", detail: "DRIVER_APPROVED" };
    case "REJECTED":
      return { ...base, status: "done", detail: "Declined by driver" };
    case "EXPIRED":
      return { ...base, status: "done", detail: "Proposal expired before a decision" };
    case "FAILED":
      // Only a driver-approved proposal reaches FAILED with a proposal stored: its commit failed after the approval.
      return run.proposal
        ? { ...base, status: "done", detail: "DRIVER_APPROVED, but the change was not applied (run failed)" }
        : { ...base, status: "none", detail: "Run FAILED: no consent step" };
    case "INFEASIBLE":
      return { ...base, status: "none", detail: "Run INFEASIBLE: no consent step" };
  }
}

/** Done only for a provider-confirmed capture or void. AUTHORIZED is context: the money is held, not settled. */
function financialStep(input: ScenarioStepInput): ScenarioStep {
  const { paymentState: state, proofTypes } = input;
  const base = { id: "financial", title: "Financial outcome" } as const;
  const prefix = `${state} · ${providerLabel(input.providerMode)}`;
  if (SETTLED_PAYMENT_STATES.has(state)) {
    if (!proofTypes.includes(state)) return { ...base, status: "pending", detail: `${prefix} · waiting for the provider proof` };
    return { ...base, status: "done", detail: `${prefix} · ${state === "CAPTURED" ? "capture confirmed by the provider" : "not charged, authorization voided by the provider"}` };
  }
  // Same rule as the FlexReceipt: a provider capture recorded against any other state is under review, never settled.
  if (proofTypes.includes("CAPTURED")) return { ...base, status: "pending", detail: `${prefix} · provider recorded a capture, under review · not settled yet` };
  const ended = ENDED_UNSETTLED[state];
  if (ended) return { ...base, status: "stopped", detail: `${prefix} · ${ended}` };
  return { ...base, status: "pending", detail: `${prefix} · ${OPEN_PAYMENT_NOTE[state] ?? "payment open"} · not settled yet` };
}

/** Same rule as `showReceipt` on the driver's reservation page (ReservationStatus.tsx). */
function receiptShownToDriver(input: ScenarioStepInput): boolean {
  return input.proofTypes.some((t) => t === "CAPTURED" || t === "VOIDED") || input.paymentState === "CAPTURE_PENDING" || input.paymentState === "CAPTURE_DECLINED";
}

/** Follows the financial step, and describes the receipt the driver's page actually shows. */
function receiptStep(input: ScenarioStepInput, financial: ScenarioStep): ScenarioStep {
  const base = { id: "receipt", title: "FlexReceipt" } as const;
  const visible = receiptShownToDriver(input);
  if (financial.status === "done") return { ...base, status: "done", detail: "Available on the driver's reservation page" };
  if (financial.status === "stopped") {
    return { ...base, status: "stopped", detail: visible ? "Shown on the driver's reservation page, stating nothing was collected" : "No receipt: the payment ended without settlement" };
  }
  return { ...base, status: "pending", detail: visible ? "Shown on the driver's reservation page as not final" : "Appears on the driver's reservation page after settlement" };
}

/** The seven Scenario C steps, in the order the demo script walks through them. */
export function buildScenarioSteps(input: ScenarioStepInput): ScenarioStep[] {
  const { run } = input;
  const financial = financialStep(input);
  return [
    { id: "event", title: "Disturbance detected", status: "done", detail: eventDetail(input) },
    agentStep(run),
    validationStep(run),
    scheduleStep(input),
    consentStep(input),
    financial,
    receiptStep(input, financial),
  ];
}
