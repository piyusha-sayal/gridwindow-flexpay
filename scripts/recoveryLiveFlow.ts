/**
 * Pure helpers for scripts/recovery-live.ts: env allowlisting, trace digests and the bounded-tool verdict.
 * No I/O, no model calls, so they can be unit tested offline.
 */
import { createHash } from "node:crypto";
import { TOOL_NAMES } from "../src/server/services/recoveryTools";

/** The only keys the live script takes from .env.local. Everything else in the file (database URLs included) is ignored. */
export const LIVE_ENV_KEYS = ["GEMINI_API_KEY", "GEMINI_MODEL"] as const;

const MODEL_SKIP_PREFIX = "model not used for this step: ";

export interface TraceEntryLike {
  seq: number;
  tool: string;
  actor: "GEMINI" | "DETERMINISTIC";
  input: unknown;
  outcome: "OK" | "REJECTED" | "FAILED" | "INFO";
  detail: string;
}

export interface TraceStepSummary {
  seq: number;
  actor: TraceEntryLike["actor"];
  tool: string;
  outcome: TraceEntryLike["outcome"];
  /** Server-generated code and detail; never model text. */
  detail: string;
  argsDigest: string;
}

/** Reads only allowlisted KEY=VALUE lines. */
export function pickLiveEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq);
    if ((LIVE_ENV_KEYS as readonly string[]).includes(key)) out[key] = line.slice(eq + 1).trim();
  }
  return out;
}

/** Short, stable digest of the sanitized arguments, so a trace can show what was sent without showing the text. */
export function argsDigest(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input) ?? "null").digest("hex").slice(0, 16);
}

export function summarizeTrace(entries: readonly TraceEntryLike[]): TraceStepSummary[] {
  return entries.map((e) => ({ seq: e.seq, actor: e.actor, tool: e.tool, outcome: e.outcome, detail: e.detail.slice(0, 160), argsDigest: argsDigest(e.input) }));
}

export function modelSteps(entries: readonly TraceEntryLike[]): TraceEntryLike[] {
  return entries.filter((e) => e.actor === "GEMINI");
}

/** Reasons the model was not consulted for a step (timeout, refusal, budget, invalid output, and so on). */
export function skippedModelReasons(entries: readonly TraceEntryLike[]): string[] {
  return entries.filter((e) => e.tool === "orchestrator" && e.detail.startsWith(MODEL_SKIP_PREFIX)).map((e) => e.detail.slice(MODEL_SKIP_PREFIX.length));
}

export type BoundedVerdict = "PASS" | "FAIL" | "BLOCKED";

/**
 * Model may only name tools from the server's tool set, and no payment call may occur. BLOCKED means the model
 * produced no step at all, so nothing was tested.
 */
export function boundedToolVerdict(entries: readonly TraceEntryLike[], paymentCalls: number): { verdict: BoundedVerdict; toolsNamed: string[]; outsideToolSet: string[] } {
  const toolsNamed = modelSteps(entries).map((e) => e.tool);
  const outsideToolSet = toolsNamed.filter((t) => !(TOOL_NAMES as readonly string[]).includes(t));
  const verdict: BoundedVerdict = toolsNamed.length === 0 ? "BLOCKED" : outsideToolSet.length > 0 || paymentCalls > 0 ? "FAIL" : "PASS";
  return { verdict, toolsNamed, outsideToolSet };
}

export const DEFAULT_LIVE_MAX_REQUESTS = 6;

/** `--max-requests=N` can only lower the default cap; a missing, non-integer or non-positive value keeps the default. */
export function resolveRequestCap(argv: readonly string[], defaultCap: number = DEFAULT_LIVE_MAX_REQUESTS): number {
  const raw = argv.find((a) => a.startsWith("--max-requests="))?.slice("--max-requests=".length);
  const n = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, defaultCap) : defaultCap;
}

/** Model id for the live call: an explicit `--model=<id>` wins over the env file, the process env, then the default. */
export function resolveLiveModel(argv: readonly string[], fileModel: string | undefined, processModel: string | undefined, defaultModel: string): string {
  const flag = argv.find((a) => a.startsWith("--model="))?.slice("--model=".length).trim();
  return flag || fileModel?.trim() || processModel?.trim() || defaultModel;
}

const DECISION_TOOL_NAMES = ["proposeRecovery", "commitPermittedRecovery", "requestDriverApproval"];
const TERMINAL_RUN_STATUSES = ["COMMITTED", "NEEDS_APPROVAL", "INFEASIBLE"];

export interface FallbackVerdict {
  verdict: "PASS" | "FAIL" | "NOT TESTED";
  note: string;
}

/**
 * Did the system fall back correctly after a provider failure? Judged from the persisted run, not from `aiUsed`:
 * `aiUsed` means a model step took part (for example a successful readStationState), which is genuine and is kept.
 * The fallback is correct when the run reached a terminal status, the trace records why the model was skipped, and,
 * for a run that decided, a decision step exists. Who made the final decision is reported separately (`decision`,
 * from runProvenance): a model that chose and then failed on a later step is still a MODEL_DECISION.
 */
export function fallbackVerdict(input: {
  failedCalls: number;
  status: string | null;
  trace: readonly TraceEntryLike[];
  decision: "MODEL_DECISION" | "DETERMINISTIC_FALLBACK";
}): FallbackVerdict {
  const modelSuccessTools = modelSteps(input.trace).filter((e) => e.outcome === "OK").map((e) => e.tool);
  const skipped = skippedModelReasons(input.trace);
  const facts = `failed provider calls: ${input.failedCalls}; model participation: ${modelSuccessTools.length} successful step(s) [${modelSuccessTools.join(", ") || "none"}]; final decision source: ${input.decision}; model skipped: ${skipped.join(", ") || "not recorded"}`;
  if (input.failedCalls === 0) return { verdict: "NOT TESTED", note: `no provider call failed; ${facts}` };
  if (input.status === null || !TERMINAL_RUN_STATUSES.includes(input.status)) return { verdict: "FAIL", note: `run did not reach a terminal status (${input.status ?? "none"}); ${facts}` };
  if (skipped.length === 0) return { verdict: "FAIL", note: `the trace does not record why the model was skipped; ${facts}` };
  const decided = input.status !== "INFEASIBLE";
  if (decided && !input.trace.some((e) => DECISION_TOOL_NAMES.includes(e.tool) && e.outcome === "OK")) return { verdict: "FAIL", note: `terminal without a decision step; ${facts}` };
  return { verdict: "PASS", note: facts };
}
