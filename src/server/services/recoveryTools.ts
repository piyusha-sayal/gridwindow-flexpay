/**
 * The bounded tool set the recovery planner may call. Handlers are pure: they read the run state and return an
 * effect. Only the orchestrator writes (commit, approval request, explanation), so a tool can never touch payments
 * or persist a schedule itself. Unknown tools, extra or mistyped arguments, out-of-phase calls and unlisted candidate
 * ids are refused with a code that goes into the run trace.
 */
import { z } from "zod";
import { portCapAt, type DisturbanceType } from "@/domain/disturbance";
import { recoverSession, revalidateSchedule, type AgreedSession, type ChargingStateSnapshot, type PlanningContext } from "@/domain/recovery";
import type { ConsentDecision } from "@/domain/recoveryConsent";
import type { OfferKind } from "@/domain/quotes";
import { formatLocalTime, slotStartMs } from "@/domain/time";
import { formatKWh, formatUsd } from "@/domain/units";
import { checkExplanation, type NarrativeFacts } from "./recoveryNarrative";

type Consent = ConsentDecision["decision"];

export interface RunCandidate {
  /** Server-assigned id ("c1", "c2", ...). The model can only refer to candidates by this id. */
  id: string;
  preference: OfferKind;
  /** Full-night per-slot plan. Held by the server; never returned to the model or accepted from it. */
  powerW: number[];
  priceCents: number;
  energyCostCents: number;
  finishMs: number | null;
  peakW: number;
  operatorImprovementCents: number;
  consent: Consent;
  reasons: string[];
  validation: "UNCHECKED" | "VALID" | "INVALID";
  invalidReason: string | null;
}

export interface RunState {
  ctx: PlanningContext;
  session: AgreedSession;
  snap: ChargingStateSnapshot;
  eventType: DisturbanceType;
  /** Schedule version the commit must still match (compare-and-set). */
  version: number;
  candidates: RunCandidate[] | null;
  rejected: { preference: OfferKind; reason: string }[];
  infeasibleReason: string | null;
  chosenId: string | null;
  decision: "COMMITTED" | "NEEDS_APPROVAL" | null;
}

export type ToolEffect = { kind: "COMMIT" } | { kind: "NEEDS_APPROVAL" } | { kind: "EXPLAIN"; text: string };

export type ToolOutcome = { ok: true; detail: string; data?: Record<string, unknown>; effect?: ToolEffect } | { ok: false; code: string; detail: string };

export const TOOL_NAMES = [
  "readStationState",
  "readActiveCommitments",
  "inspectDisruption",
  "requestRecoveryCandidates",
  "validateRecoveryPlan",
  "proposeRecovery",
  "commitPermittedRecovery",
  "requestDriverApproval",
  "explainRecoveryOutcome",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

const CANDIDATE_ID = /^c\d{1,2}$/;
const candidateArgs = z.object({ candidateId: z.string().regex(CANDIDATE_ID) }).strict();
const noArgs = z.object({}).strict();
const explainArgs = z.object({ text: z.string().min(1).max(600) }).strict();

const EVENT_LABELS: Record<DisturbanceType, string> = {
  CHARGER_POWER_REDUCTION: "A charger power limit",
  SITE_CAP_REDUCTION: "A site power limit",
  EARLY_DEPARTURE: "An earlier departure",
  CHARGER_FAILURE: "A charger failure",
};

const TRACE_STRING_LIMIT = 80;
const TRACE_FANOUT = 12;

export function newRunState(input: { ctx: PlanningContext; session: AgreedSession; snap: ChargingStateSnapshot; version: number; eventType: DisturbanceType }): RunState {
  return { ...input, candidates: null, rejected: [], infeasibleReason: null, chosenId: null, decision: null };
}

/** Parses the model's step text. Arguments travel as JSON text so the step schema stays provider-neutral. */
export function parseModelCall(step: { tool: string; argsJson: string }): { ok: true; tool: string; args: unknown } | { ok: false; tool: string; code: "INVALID_ARGS" } {
  let args: unknown;
  try {
    args = JSON.parse(step.argsJson);
  } catch {
    return { ok: false, tool: step.tool, code: "INVALID_ARGS" };
  }
  if (typeof args !== "object" || args === null || Array.isArray(args)) return { ok: false, tool: step.tool, code: "INVALID_ARGS" };
  return { ok: true, tool: step.tool, args };
}

function chosenOf(state: RunState): RunCandidate | null {
  return state.candidates?.find((c) => c.id === state.chosenId) ?? null;
}

/** Tools that may be called in the current phase. Explanation is only reachable after a decision. */
export function allowedToolNames(state: RunState): ToolName[] {
  if (state.decision) return ["explainRecoveryOutcome"];
  const reading: ToolName[] = ["readStationState", "readActiveCommitments", "inspectDisruption", "requestRecoveryCandidates"];
  if (!state.candidates) return reading;
  return [...reading, "validateRecoveryPlan", "proposeRecovery", "commitPermittedRecovery", "requestDriverApproval"];
}

function fail(code: string, detail: string): ToolOutcome {
  return { ok: false, code, detail };
}

function portLabelOf(state: RunState): string {
  return state.ctx.station.ports.find((p) => p.id === state.session.portId)?.label ?? state.session.portId;
}

function effectiveAtMs(state: RunState): number {
  return slotStartMs(state.ctx.grid, state.snap.effectiveSlot);
}

/** Display facts for explanations. Backend-computed strings only. */
export function narrativeFacts(state: RunState): NarrativeFacts {
  const tz = state.ctx.station.timeZone;
  return {
    eventKind: state.eventType,
    eventLabel: EVENT_LABELS[state.eventType],
    chargerLabel: portLabelOf(state),
    effectiveAt: formatLocalTime(effectiveAtMs(state), tz),
    agreedDeparture: formatLocalTime(state.session.agreedDepartMs, tz),
    effectiveDeparture: formatLocalTime(state.snap.departMs, tz),
    price: formatUsd(state.session.amountCents),
    remainingEnergy: formatKWh(state.snap.remainingBatteryWh),
  };
}

/** What the model may see about a candidate: ids, prices, finish time and consent. Never the power profile. */
export function summarizeCandidate(c: RunCandidate, tz: string): Record<string, unknown> {
  return {
    id: c.id,
    preference: c.preference,
    priceCents: c.priceCents,
    energyCostCents: c.energyCostCents,
    finishAt: c.finishMs === null ? null : formatLocalTime(c.finishMs, tz),
    consent: c.consent,
    validation: c.validation,
    reasons: c.reasons,
  };
}

function updateCandidate(state: RunState, id: string, patch: Partial<RunCandidate>): void {
  state.candidates = state.candidates!.map((c) => (c.id === id ? { ...c, ...patch } : c));
}

const handlers = {
  readStationState(state: RunState): ToolOutcome {
    const eff = state.snap.effectiveSlot;
    const port = state.ctx.station.ports.find((p) => p.id === state.session.portId);
    return {
      ok: true,
      detail: "station limits read",
      data: {
        timeZone: state.ctx.station.timeZone,
        stationCapW: state.ctx.station.stationCapW,
        chargerLabel: portLabelOf(state),
        chargerRatedW: port?.maxPowerW ?? 0,
        chargerLimitFromEffectiveTimeW: port ? portCapAt(state.ctx.station, state.ctx.envelope, port.id, eff) : 0,
        siteCapFromEffectiveTimeW: state.ctx.envelope.siteCapW[eff] ?? state.ctx.station.stationCapW,
      },
    };
  },

  readActiveCommitments(state: RunState): ToolOutcome {
    const labels = state.ctx.others.map((p) => state.ctx.station.ports.find((port) => port.id === p.portId)?.label ?? p.portId);
    return { ok: true, detail: "other committed sessions read", data: { otherActiveSessions: state.ctx.others.length, chargersInUse: labels } };
  },

  inspectDisruption(state: RunState): ToolOutcome {
    const tz = state.ctx.station.timeZone;
    return {
      ok: true,
      detail: "disturbance read",
      data: {
        type: state.eventType,
        provenance: "SYNTHETIC",
        effectiveAt: formatLocalTime(effectiveAtMs(state), tz),
        agreedDeparture: formatLocalTime(state.session.agreedDepartMs, tz),
        effectiveDeparture: formatLocalTime(state.snap.departMs, tz),
        remainingEnergy: formatKWh(state.snap.remainingBatteryWh),
      },
    };
  },

  requestRecoveryCandidates(state: RunState): ToolOutcome {
    if (state.candidates || state.infeasibleReason) {
      return { ok: true, detail: "candidates already listed", data: { candidates: (state.candidates ?? []).map((c) => summarizeCandidate(c, state.ctx.station.timeZone)) } };
    }
    const result = recoverSession(state.ctx, state.session, state.snap);
    state.rejected = result.rejected.map((r) => ({ preference: r.preference, reason: r.reason }));
    if (!result.ok) {
      state.infeasibleReason = result.message;
      return { ok: true, detail: `no feasible schedule: ${result.binding}`, data: { feasible: false, binding: result.binding, rejected: state.rejected } };
    }
    state.candidates = result.candidates.map((c, i) => ({
      id: `c${i + 1}`,
      preference: c.preference,
      powerW: c.powerW,
      priceCents: c.priceCents,
      energyCostCents: c.energyCostCents,
      finishMs: c.chargeEndMs,
      peakW: Math.max(0, ...c.powerW),
      operatorImprovementCents: c.operatorImprovementCents,
      consent: c.consent.decision,
      reasons: c.consent.reasons,
      validation: "UNCHECKED",
      invalidReason: null,
    }));
    const listed = state.candidates.map((c) => summarizeCandidate(c, state.ctx.station.timeZone));
    return { ok: true, detail: `${listed.length} feasible candidate(s)`, data: { feasible: true, candidates: listed, rejected: state.rejected } };
  },

  validateRecoveryPlan(state: RunState, args: z.infer<typeof candidateArgs>): ToolOutcome {
    const cand = state.candidates!.find((c) => c.id === args.candidateId);
    if (!cand) return fail("UNKNOWN_CANDIDATE", "That candidate was not listed by the server.");
    const verdict = revalidateSchedule(state.ctx, state.session, state.snap, cand.powerW, cand.preference);
    if ("reason" in verdict) {
      updateCandidate(state, cand.id, { validation: "INVALID", invalidReason: verdict.reason, consent: "NOT_ALLOWED" });
    } else {
      const fresh = verdict.candidate;
      updateCandidate(state, cand.id, {
        validation: "VALID",
        invalidReason: null,
        consent: fresh.consent.decision,
        reasons: fresh.consent.reasons,
        energyCostCents: fresh.energyCostCents,
        operatorImprovementCents: fresh.operatorImprovementCents,
        priceCents: fresh.priceCents,
        finishMs: fresh.chargeEndMs,
      });
    }
    const after = state.candidates!.find((c) => c.id === cand.id)!;
    return { ok: true, detail: after.validation === "VALID" ? `validated, consent ${after.consent}` : `invalid: ${after.invalidReason}`, data: summarizeCandidate(after, state.ctx.station.timeZone) };
  },

  proposeRecovery(state: RunState, args: z.infer<typeof candidateArgs>): ToolOutcome {
    const cand = state.candidates!.find((c) => c.id === args.candidateId);
    if (!cand) return fail("UNKNOWN_CANDIDATE", "That candidate was not listed by the server.");
    if (cand.validation !== "VALID") return fail("NOT_VALIDATED", "Only a candidate that passed validation can be proposed.");
    if (cand.consent === "NOT_ALLOWED") return fail("NOT_PROPOSABLE", "The agreed terms do not allow this candidate.");
    state.chosenId = cand.id;
    return { ok: true, detail: `proposed ${cand.id} (${cand.consent})`, data: { candidateId: cand.id, consent: cand.consent } };
  },

  commitPermittedRecovery(state: RunState): ToolOutcome {
    const chosen = chosenOf(state);
    if (!chosen) return fail("NOT_PROPOSED", "Propose a validated candidate first.");
    if (chosen.consent !== "AUTO_COMMIT") return fail("NOT_AUTO_PERMITTED", "This change needs driver approval; use requestDriverApproval.");
    return { ok: true, detail: `commit ${chosen.id} within agreed terms`, effect: { kind: "COMMIT" } };
  },

  requestDriverApproval(state: RunState): ToolOutcome {
    const chosen = chosenOf(state);
    if (!chosen) return fail("NOT_PROPOSED", "Propose a validated candidate first.");
    if (chosen.consent === "AUTO_COMMIT") return fail("NOT_NEEDED", "This change is within the agreed terms; use commitPermittedRecovery.");
    if (chosen.consent !== "NEEDS_DRIVER_APPROVAL") return fail("NOT_PROPOSABLE", "The agreed terms do not allow this candidate.");
    return { ok: true, detail: `driver approval requested for ${chosen.id}`, effect: { kind: "NEEDS_APPROVAL" } };
  },

  explainRecoveryOutcome(state: RunState, args: z.infer<typeof explainArgs>): ToolOutcome {
    const issues = checkExplanation(args.text, narrativeFacts(state));
    if (issues.length > 0) return fail("UNGROUNDED_TEXT", `Rejected text: ${issues.map((i) => i.kind).join(", ")}.`);
    return { ok: true, detail: "explanation accepted", effect: { kind: "EXPLAIN", text: args.text } };
  },
};

const specs: Record<ToolName, z.ZodType> = {
  readStationState: noArgs,
  readActiveCommitments: noArgs,
  inspectDisruption: noArgs,
  requestRecoveryCandidates: noArgs,
  validateRecoveryPlan: candidateArgs,
  proposeRecovery: candidateArgs,
  commitPermittedRecovery: noArgs,
  requestDriverApproval: noArgs,
  explainRecoveryOutcome: explainArgs,
};

/** Runs one tool call after name, phase and argument checks. Pure with respect to the database. */
export function dispatchTool(state: RunState, toolName: string, rawArgs: unknown): ToolOutcome {
  if (!(TOOL_NAMES as readonly string[]).includes(toolName)) return fail("UNKNOWN_TOOL", "No such tool.");
  const name = toolName as ToolName;
  if (!allowedToolNames(state).includes(name)) return fail("NOT_ALLOWED_NOW", "This tool is not available at this step.");
  const parsed = specs[name].safeParse(rawArgs);
  if (!parsed.success) return fail("INVALID_ARGS", "Arguments do not match this tool.");
  const handler = handlers[name] as (state: RunState, args: unknown) => ToolOutcome;
  return handler(state, parsed.data);
}

/** The deterministic choice: auto-permitted first, then lowest price, earliest finish, then gentlest (lowest peak power). */
export function pickDeterministic(state: RunState): string | null {
  const eligible = (state.candidates ?? []).filter((c) => c.validation === "VALID" && c.consent !== "NOT_ALLOWED");
  const ranked = [...eligible].sort(
    (a, b) =>
      Number(a.consent !== "AUTO_COMMIT") - Number(b.consent !== "AUTO_COMMIT") ||
      a.priceCents - b.priceCents ||
      (a.finishMs ?? Number.POSITIVE_INFINITY) - (b.finishMs ?? Number.POSITIVE_INFINITY) ||
      a.peakW - b.peakW ||
      a.id.localeCompare(b.id),
  );
  return ranked[0]?.id ?? null;
}

/** Trace-safe copy of model input: control characters removed, strings and nesting bounded. */
export function sanitizeForTrace(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, TRACE_STRING_LIMIT);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || value === null) return value;
  if (depth >= 2) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, TRACE_FANOUT).map((v) => sanitizeForTrace(v, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, TRACE_FANOUT).map(([k, v]) => [sanitizeForTrace(k) as string, sanitizeForTrace(v, depth + 1)]));
  }
  return null;
}
