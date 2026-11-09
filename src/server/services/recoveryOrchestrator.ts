/**
 * Autonomous recovery for one recorded disturbance. A model (optional) chooses among server-validated candidates
 * through a bounded tool set; a deterministic path finishes whatever the model did not decide. Every decision is
 * re-checked by the validators and every write is fenced by a lease, so a crashed or stalled worker can be resumed
 * safely and a duplicate worker cannot double-commit.
 */
import { z } from "zod";
import { formatLocalTime, slotStartMs } from "@/domain/time";
import { snapshotSession, type AgreedSession, type PlanningContext } from "@/domain/recovery";
import type { QuoteSet } from "@/domain/quotes";
import type { LlmResult, StructuredLlm } from "@/server/ai/llm";
import { ServiceError, type AppDeps } from "../deps";
import { committedPlans, effectivePowerOf, getReservation, type ReservationRow } from "../repo";
import { agreedSession, commitScheduleVersion, currentVersion, findEvent, isActiveSession, nightContext, PROPOSAL_TTL_MS, type DisruptionRow } from "./scheduleService";
import { appendTraceFenced, appendTraceUnfenced, findRunRow, findRunRowById, patchRun, saveOutcomeFenced, toRunView, transitionRun, type CandidateRecord, type RecoveryOutcome, type RecoveryRunView, type RunTraceEntry } from "./recoveryRuns";
import { deterministicExplanation, type NarrativeKind } from "./recoveryNarrative";
import { RECOVERY_SYSTEM, STEP_SCHEMA, buildRecoveryPrompt, type TranscriptItem } from "./recoveryPrompt";
import { allowedToolNames, dispatchTool, narrativeFacts, newRunState, parseModelCall, pickDeterministic, sanitizeForTrace, summarizeCandidate, type RunState, type ToolOutcome } from "./recoveryTools";

export const MAX_TOOL_STEPS = 8;
export const MAX_ATTEMPTS = 3;
export const LEASE_MS = 60_000;
/** Wall-clock budget for the whole model loop; the deterministic path needs no budget. */
export const LOOP_BUDGET_MS = 45_000;
const STEP_MAX_TOKENS = 512;

export interface OrchestratorOptions {
  /** Overrides the model-loop budget (tests use small values). */
  timeoutMs?: number;
}

/** Thrown when another worker took the run over; the current worker stops without writing. */
class LeaseLostError extends Error {}

const TIMED_OUT = Symbol("timed-out");

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
}

interface Claim {
  runId: string;
  lease: Date;
  seq: number;
  attempt: number;
}

/** Creates the run for an event, or takes over a stuck one. Returns the stored view when someone else holds it. */
async function claim(deps: AppDeps, eventId: string): Promise<{ claim: Claim } | { view: RecoveryRunView }> {
  const now = deps.now();
  const lease = new Date(now + LEASE_MS);
  const newRunId = deps.newId("rrun");
  const inserted = await deps.db.query<{ id: string }>(
    `insert into recovery_runs (id, disruption_event_id, status, lease_until, attempts) values ($1, $2, 'RUNNING', $3::timestamptz, 1)
     on conflict (disruption_event_id) do nothing returning id`,
    [newRunId, eventId, lease.toISOString()],
  );
  if (inserted.length === 1) return { claim: { runId: newRunId, lease, seq: 1, attempt: 1 } };

  const row = (await findRunRow(deps.db, eventId))!;
  const heldByLiveWorker = row.lease_until !== null && row.lease_until.getTime() > now;
  if (row.status !== "RUNNING" || heldByLiveWorker) return { view: toRunView(row, eventId, now) };
  if (row.attempts >= MAX_ATTEMPTS) {
    const entry = lifecycleEntry(row.trace.length + 1, now, "RETRY_LIMIT", `gave up after ${row.attempts} attempts`);
    await transitionRun(deps.db, row.id, "RUNNING", "FAILED", row.lease_until, { appendTrace: [entry] });
    return { view: toRunView((await findRunRowById(deps.db, row.id))!, eventId, now) };
  }
  // Compare-and-set on the expired lease: exactly one resumer wins the takeover.
  const taken = await deps.db.query<{ id: string }>(
    `update recovery_runs set attempts = attempts + 1, lease_until = $3::timestamptz, updated_at = now()
     where id = $1 and status = 'RUNNING' and lease_until is not distinct from $2::timestamptz returning id`,
    [row.id, row.lease_until ? row.lease_until.toISOString() : null, lease.toISOString()],
  );
  if (taken.length === 0) return { view: toRunView((await findRunRowById(deps.db, row.id))!, eventId, now) };
  return { claim: { runId: row.id, lease, seq: row.trace.length + 1, attempt: row.attempts + 1 } };
}

function lifecycleEntry(seq: number, nowMs: number, tool: string, detail: string, outcome: RunTraceEntry["outcome"] = "INFO"): RunTraceEntry {
  return { seq, at: new Date(nowMs).toISOString(), tool, actor: "DETERMINISTIC", input: {}, outcome, detail };
}

function chosenOf(state: RunState) {
  return state.candidates?.find((c) => c.id === state.chosenId) ?? null;
}

/** Candidate records for the receipt: feasible candidates with their consent, plus every rejection with its reason. */
function candidateRecords(state: RunState): CandidateRecord[] {
  const tz = state.ctx.station.timeZone;
  const feasible: CandidateRecord[] = (state.candidates ?? []).map((c) => {
    const usable = c.validation === "VALID" && c.consent !== "NOT_ALLOWED";
    return {
      id: c.id,
      preference: c.preference,
      status: usable ? "PROPOSED" : "REJECTED",
      consent: c.validation === "VALID" ? c.consent : null,
      reason: c.invalidReason ?? (c.consent === "AUTO_COMMIT" ? null : c.reasons.join("; ") || null),
      chosen: c.id === state.chosenId,
      priceCents: c.priceCents,
      energyCostCents: c.energyCostCents,
      finishAt: c.finishMs === null ? null : formatLocalTime(c.finishMs, tz),
    };
  });
  const rejected: CandidateRecord[] = state.rejected.map((r) => ({
    id: null,
    preference: r.preference,
    status: "REJECTED",
    consent: null,
    reason: r.reason,
    chosen: false,
    priceCents: null,
    energyCostCents: null,
    finishAt: null,
  }));
  return [...feasible, ...rejected];
}

function buildOutcome(state: RunState, kind: RecoveryOutcome["kind"], reason: string, versionCommitted: number | null): RecoveryOutcome {
  return {
    kind,
    reason,
    effectiveSlot: state.snap.effectiveSlot,
    effectiveAt: formatLocalTime(slotStartMs(state.ctx.grid, state.snap.effectiveSlot), state.ctx.station.timeZone),
    candidates: candidateRecords(state),
    versionCommitted,
  };
}

/** Planning context and agreed session for one reservation: the inputs every recovery and settlement check shares. */
export async function planningFor(deps: AppDeps, r: ReservationRow): Promise<{ ctx: PlanningContext; session: AgreedSession }> {
  const quoteRows = await deps.db.query<{ payload: QuoteSet }>("select payload from quote_sets where id = $1", [r.quote_set_id]);
  const { scenario, envelope } = await nightContext(deps.db, deps.station, r.night_of);
  const others = await committedPlans(deps.db, deps.station.id, r.night_of, r.id);
  const session = agreedSession(r, quoteRows[0]!.payload, await effectivePowerOf(deps.db, r));
  const ctx: PlanningContext = {
    station: deps.station,
    grid: scenario.grid,
    tariff: scenario.tariff,
    touMc: scenario.touMc,
    forecastBaseLoadW: scenario.forecastBaseLoadW,
    actualBaseLoadW: scenario.actualBaseLoadW,
    economics: deps.economics,
    envelope,
    others,
  };
  return { ctx, session };
}

async function loadRunState(deps: AppDeps, event: DisruptionRow): Promise<RunState | null> {
  const r = await getReservation(deps.db, event.reservation_id);
  if (!r || !(await isActiveSession(deps.db, r))) return null;
  const { ctx, session } = await planningFor(deps, r);
  const snap = snapshotSession(ctx, session, event.effective_slot);
  return newRunState({ ctx, session, snap, version: await currentVersion(deps.db, r.id), eventType: event.type });
}

/** One attempt at one run. Holds the lease until the run reaches a terminal status. */
class RunWorker {
  private lease: Date | null;
  private seq: number;
  private aiUsed = false;
  private explanation: { text: string; source: "MODEL" | "DETERMINISTIC" } | null = null;
  private readonly deadline: number;
  private readonly attempt: number;
  private readonly resumed: boolean;
  private state: RunState | null = null;
  private committedVersion: number | null = null;

  constructor(
    private readonly deps: AppDeps,
    private readonly event: DisruptionRow,
    private readonly runId: string,
    claimed: Claim,
    private readonly llm: StructuredLlm | null,
    budgetMs: number,
  ) {
    this.lease = claimed.lease;
    this.seq = claimed.seq;
    this.deadline = Date.now() + budgetMs;
    this.attempt = claimed.attempt;
    this.resumed = claimed.attempt > 1;
  }

  /** Appends one trace entry. While the lease is held the append is fenced and renews the lease. */
  private async log(tool: string, actor: RunTraceEntry["actor"], input: unknown, outcome: RunTraceEntry["outcome"], detail: string): Promise<void> {
    const entry: RunTraceEntry = { seq: this.seq++, at: new Date(this.deps.now()).toISOString(), tool, actor, input: sanitizeForTrace(input), outcome, detail };
    await this.append([entry]);
  }

  private async append(entries: RunTraceEntry[]): Promise<void> {
    if (!this.lease) {
      await appendTraceUnfenced(this.deps.db, this.runId, entries);
      return;
    }
    const next = new Date(this.deps.now() + LEASE_MS);
    if (!(await appendTraceFenced(this.deps.db, this.runId, this.lease, entries, next))) throw new LeaseLostError();
    this.lease = next;
  }

  async execute(): Promise<RecoveryRunView> {
    try {
      await this.log("orchestrator", "DETERMINISTIC", { attempt: this.attempt }, "INFO", this.resumed ? `resumed on attempt ${this.attempt}` : "started");
      const state = await loadRunState(this.deps, this.event);
      if (!state) return await this.finish("FAILED", "The session is not an active scheduled session.");
      this.state = state;
      if (this.llm) await this.modelLoop(state);
      else await this.log("orchestrator", "DETERMINISTIC", {}, "INFO", "no model configured; deterministic path");
      await this.completeDeterministically(state);
      if (state.decision) return await this.finish(state.decision, null);
      return await this.finish("INFEASIBLE", state.infeasibleReason ?? "No schedule passed the independent checks.");
    } catch (err) {
      if (err instanceof LeaseLostError) return this.current();
      if (err instanceof ServiceError) return await this.failWith(err.message);
      throw err; // unexpected: the lease expires and the sweep resumes the run (bounded by MAX_ATTEMPTS)
    }
  }

  private async current(): Promise<RecoveryRunView> {
    return toRunView((await findRunRowById(this.deps.db, this.runId))!, this.event.event_id, this.deps.now());
  }

  private async failWith(message: string): Promise<RecoveryRunView> {
    if (this.lease) {
      const entry = lifecycleEntry(this.seq++, this.deps.now(), "orchestrator", message, "FAILED");
      const outcome = this.state ? buildOutcome(this.state, "FAILED", message, null) : undefined;
      await transitionRun(this.deps.db, this.runId, "RUNNING", "FAILED", this.lease, { appendTrace: [entry], outcome, explanation: { text: message, source: "DETERMINISTIC" }, aiUsed: this.aiUsed });
    }
    return this.current();
  }

  /** Bounded model loop. Any model failure ends the loop; deterministic completion takes over from the current state. */
  private async modelLoop(state: RunState): Promise<void> {
    const transcript: TranscriptItem[] = [];
    for (let step = 1; step <= MAX_TOOL_STEPS; step++) {
      const remaining = this.deadline - Date.now();
      if (remaining <= 0) return this.skipModel("TIMEOUT");
      await this.renewLeaseOnly();
      const res = await withTimeout(this.callModel(state, transcript, MAX_TOOL_STEPS - step), remaining);
      if (res === TIMED_OUT) return this.skipModel("TIMEOUT");
      if (!res.ok) return this.skipModel(res.reason);
      const parsed = STEP_SCHEMA.safeParse(res.value);
      if (!parsed.success) return this.skipModel("INVALID_OUTPUT");
      const call = parseModelCall(parsed.data);
      if (!call.ok) {
        await this.log(call.tool, "GEMINI", {}, "REJECTED", call.code);
        transcript.push({ step, tool: call.tool, outcome: "REJECTED", detail: call.code });
        if (state.decision) return;
        continue;
      }
      const out = dispatchTool(state, call.tool, call.args);
      if (!out.ok) {
        await this.log(call.tool, "GEMINI", call.args, "REJECTED", `${out.code}: ${out.detail}`);
        transcript.push({ step, tool: call.tool, outcome: "REJECTED", detail: out.code });
        if (state.decision) return;
        continue;
      }
      await this.applyEffect(state, out);
      await this.log(call.tool, "GEMINI", call.args, "OK", out.detail);
      this.aiUsed = true;
      transcript.push({ step, tool: call.tool, outcome: "OK", detail: out.detail, data: out.data });
      if (state.infeasibleReason || this.explanation) return;
    }
    await this.log("orchestrator", "DETERMINISTIC", {}, "INFO", "model step limit reached");
  }

  private callModel(state: RunState, transcript: readonly TranscriptItem[], stepsLeft: number): Promise<LlmResult<z.infer<typeof STEP_SCHEMA>>> {
    const prompt = buildRecoveryPrompt(
      {
        allowedTools: allowedToolNames(state),
        stepsLeft,
        candidates: (state.candidates ?? []).map((c) => summarizeCandidate(c, state.ctx.station.timeZone)),
        decided: state.decision !== null,
      },
      transcript.slice(-MAX_TOOL_STEPS),
    );
    return this.llm!
      .generate({ system: RECOVERY_SYSTEM, user: prompt, schema: STEP_SCHEMA, maxTokens: STEP_MAX_TOKENS })
      .catch((): LlmResult<z.infer<typeof STEP_SCHEMA>> => ({ ok: false, reason: "UNAVAILABLE" }));
  }

  private async renewLeaseOnly(): Promise<void> {
    await this.append([]);
  }

  private async skipModel(reason: string): Promise<void> {
    await this.log("orchestrator", "DETERMINISTIC", {}, "INFO", `model not used for this step: ${reason}`);
  }

  /** Runs the remaining decisions through the same validated tools, in order, with actor DETERMINISTIC. */
  private async completeDeterministically(state: RunState): Promise<void> {
    if (state.infeasibleReason) return;
    await this.runDeterministic(state, "requestRecoveryCandidates", {});
    if (state.infeasibleReason || !state.candidates) return;
    for (const c of state.candidates.filter((x) => x.validation === "UNCHECKED")) await this.runDeterministic(state, "validateRecoveryPlan", { candidateId: c.id });
    if (!state.chosenId) {
      const id = pickDeterministic(state);
      if (id) await this.runDeterministic(state, "proposeRecovery", { candidateId: id });
    }
    const chosen = chosenOf(state);
    if (state.decision || !chosen) return;
    const tool = chosen.consent === "AUTO_COMMIT" ? "commitPermittedRecovery" : "requestDriverApproval";
    await this.runDeterministic(state, tool, {});
  }

  private async runDeterministic(state: RunState, tool: string, args: Record<string, unknown>): Promise<void> {
    const out = dispatchTool(state, tool, args);
    if (!out.ok) {
      await this.log(tool, "DETERMINISTIC", args, "REJECTED", `${out.code}: ${out.detail}`);
      return;
    }
    await this.applyEffect(state, out);
    await this.log(tool, "DETERMINISTIC", args, "OK", out.detail);
  }

  /** Executes a tool's effect. Writes happen only here, after the validators have accepted the decision. */
  private async applyEffect(state: RunState, out: Extract<ToolOutcome, { ok: true }>): Promise<void> {
    const effect = out.effect;
    if (!effect) return;
    if (effect.kind === "EXPLAIN") {
      this.explanation = { text: effect.text, source: "MODEL" };
      return;
    }
    if (effect.kind === "COMMIT") return this.commit(state);
    return this.requestApproval(state);
  }

  private async commit(state: RunState): Promise<void> {
    const chosen = chosenOf(state)!;
    const reason = `Recovery for ${state.eventType}: ${chosen.preference} applied within the agreed terms`;
    const pending = buildOutcome(state, "COMMITTED", deterministicExplanation("COMMITTED", narrativeFacts(state)), null);
    const lease = this.lease;
    if (!lease || !(await this.saveOutcomeFenced(pending))) throw new LeaseLostError();
    const commit = await commitScheduleVersion(this.deps, state.session.reservationId, state.version, chosen.powerW, reason, this.runId, state.snap.effectiveSlot, {
      attempt: this.attempt,
      lease,
    }).catch((err: unknown) => {
      if (err instanceof ServiceError && err.code === "LEASE_LOST") throw new LeaseLostError();
      throw err;
    });
    this.lease = null;
    state.decision = "COMMITTED";
    this.committedVersion = commit.version;
  }

  private async requestApproval(state: RunState): Promise<void> {
    const chosen = chosenOf(state)!;
    const proposal = {
      preference: chosen.preference,
      powerW: chosen.powerW,
      energyCostCents: chosen.energyCostCents,
      operatorImprovementCents: chosen.operatorImprovementCents,
      priceCents: chosen.priceCents,
      reasons: chosen.reasons,
    };
    const outcome = buildOutcome(state, "NEEDS_APPROVAL", deterministicExplanation("NEEDS_APPROVAL", narrativeFacts(state)), null);
    const expiresAt = new Date(this.deps.now() + PROPOSAL_TTL_MS);
    const ok = await transitionRun(this.deps.db, this.runId, "RUNNING", "NEEDS_APPROVAL", this.lease, {
      proposal,
      proposalVersion: state.version,
      expiresAt,
      outcome,
      aiUsed: this.aiUsed,
    });
    if (!ok) throw new LeaseLostError();
    this.lease = null;
    state.decision = "NEEDS_APPROVAL";
  }

  private async saveOutcomeFenced(outcome: RecoveryOutcome): Promise<boolean> {
    return this.lease ? saveOutcomeFenced(this.deps.db, this.runId, this.lease, outcome) : false;
  }

  /** Writes the terminal status (unless a commit or approval already did) and the narrative. */
  private async finish(status: "COMMITTED" | "NEEDS_APPROVAL" | "INFEASIBLE" | "FAILED", detail: string | null): Promise<RecoveryRunView> {
    if (status === "FAILED") return this.failWith(detail ?? "Recovery failed.");
    const state = this.state!;
    const kind: NarrativeKind = status === "COMMITTED" ? "COMMITTED" : status === "NEEDS_APPROVAL" ? "NEEDS_APPROVAL" : "INFEASIBLE";
    const text = this.explanation ?? { text: deterministicExplanation(kind, narrativeFacts(state), detail ?? ""), source: "DETERMINISTIC" as const };
    const outcome = buildOutcome(state, status, text.text, this.committedVersion);
    if (status === "INFEASIBLE") {
      const ok = this.lease ? await transitionRun(this.deps.db, this.runId, "RUNNING", "INFEASIBLE", this.lease, { outcome, explanation: text, aiUsed: this.aiUsed }) : false;
      if (!ok) throw new LeaseLostError();
      this.lease = null;
    } else {
      await patchRun(this.deps.db, this.runId, { outcome, explanation: text, aiUsed: this.aiUsed });
    }
    return this.current();
  }
}

/**
 * Runs (or resumes) recovery for one recorded disturbance. A stored run is returned unchanged. A run held by a live
 * worker is returned as it stands; an expired lease is taken over on the next attempt, up to MAX_ATTEMPTS.
 */
export async function orchestrateRecovery(deps: AppDeps, eventId: string, options: OrchestratorOptions = {}): Promise<RecoveryRunView> {
  const event = await findEvent(deps.db, eventId);
  if (!event) throw new ServiceError("NOT_FOUND", "Disturbance not found.", 404);
  const claimed = await claim(deps, eventId);
  if ("view" in claimed) return claimed.view;
  return new RunWorker(deps, event, claimed.claim.runId, claimed.claim, deps.llm ?? null, options.timeoutMs ?? LOOP_BUDGET_MS).execute();
}

/**
 * Restart sweep: expires stale proposals and resumes runs whose worker stopped without finishing (lease expired).
 * One failing run never blocks the others.
 */
export async function resumeStuckRuns(deps: AppDeps, limit = 20): Promise<{ expired: number; resumed: number; failed: number }> {
  const now = new Date(deps.now()).toISOString();
  const expired = await deps.db.query<{ id: string }>(
    "update recovery_runs set status = 'EXPIRED', updated_at = now() where status = 'NEEDS_APPROVAL' and expires_at <= $1::timestamptz returning id",
    [now],
  );
  const stuck = await deps.db.query<{ disruption_event_id: string }>(
    `select disruption_event_id from recovery_runs
     where status = 'RUNNING' and (lease_until is null or lease_until <= $1::timestamptz) order by updated_at limit $2`,
    [now, limit],
  );
  let failed = 0;
  for (const { disruption_event_id: eventId } of stuck) {
    try {
      await orchestrateRecovery(deps, eventId);
    } catch (err) {
      failed += 1;
      console.warn("[gridwindow] recovery resume failed:", err instanceof Error ? err.name : "UNKNOWN");
    }
  }
  return { expired: expired.length, resumed: stuck.length - failed, failed };
}

