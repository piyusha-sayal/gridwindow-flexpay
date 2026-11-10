/** Pure parts of the Gemini model-access check (metadata only, no generation). Kept apart so they can be tested offline. */
import { resolveLiveModel } from "./recoveryLiveFlow";

export const METADATA_APPROVAL_FLAG = "--approve-metadata-call";

export interface AccessCheckResult {
  available: boolean;
  supportsGenerateContent: boolean;
  inputTokenLimit?: number;
  diagnostic?: { category?: string; errorName?: string; httpStatus?: number; providerStatus?: string };
}

export function planAccessCheck(argv: readonly string[], defaultModel: string): { approved: boolean; model: string } {
  return { approved: argv.includes(METADATA_APPROVAL_FLAG), model: resolveLiveModel(argv, undefined, undefined, defaultModel) };
}

/** Sanitized evidence: model id, outcome, HTTP/provider status and latency. Never a key, a URL with a key, or message text. */
export function summarizeAccess(model: string, result: AccessCheckResult, latencyMs: number, ranAt: string) {
  const d = result.diagnostic;
  return {
    ranAt,
    kind: "MODEL_ACCESS_METADATA_ONLY",
    requestsSent: 1,
    generationRequests: 0,
    model,
    available: result.available,
    supportsGenerateContent: result.supportsGenerateContent,
    inputTokenLimit: result.inputTokenLimit ?? null,
    diagnostic: d ? { category: d.category ?? null, errorName: d.errorName ?? null, httpStatus: d.httpStatus ?? null, providerStatus: d.providerStatus ?? null } : null,
    latencyMs,
    verdict: result.available && result.supportsGenerateContent ? "PASS" : "FAIL",
  };
}
