/**
 * Gemini implementation of the narrow model boundary (see llm.ts). Same contract as AnthropicLlm:
 * one schema-validated JSON object in, text-only out, no tools, no function calling, no grounding
 * with search, no state access. Every failure maps to an LlmFailure and ends in the deterministic fallback.
 */
import { ApiError, GoogleGenAI, ThinkingLevel, type GenerateContentParameters, type GenerateContentResponse } from "@google/genai";
import { z } from "zod";
import { classifyHttpStatus, providerStatusWord, type LlmDiagnostic, type LlmFailure, type LlmResult, type ModelProvider, type StructuredLlm } from "./llm";

/**
 * Stable Flash model that Google's pricing page lists as free of charge on the Gemini Developer API
 * (read 2026-11-05). It was not confirmed with a live models.list call: that needs a separately authorized request.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
const TIMEOUT_MS = 20_000;
/** Gemini counts thinking tokens against the output limit; headroom keeps a short answer from being cut off. */
const THINKING_HEADROOM_TOKENS = 1_024;
/** Finish reasons meaning the provider declined to answer (anything else except STOP is a truncated or unusable output). */
const REFUSAL_FINISH_REASONS = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_SAFETY"]);

export type GeminiGenerate = (params: GenerateContentParameters) => Promise<GenerateContentResponse>;

export interface GeminiTransport {
  /** Replaces the real SDK call in offline tests. */
  generate?: GeminiGenerate;
  timeoutMs?: number;
}

export class GeminiLlm implements StructuredLlm {
  readonly provider: ModelProvider = "gemini";
  private readonly generateContent: GeminiGenerate;
  private readonly timeoutMs: number;

  constructor(
    apiKey: string,
    readonly model: string = DEFAULT_GEMINI_MODEL,
    transport: GeminiTransport = {},
  ) {
    this.timeoutMs = transport.timeoutMs ?? TIMEOUT_MS;
    if (transport.generate) {
      this.generateContent = transport.generate;
    } else {
      const client = new GoogleGenAI({ apiKey, httpOptions: { timeout: this.timeoutMs, retryOptions: { attempts: 1 } } });
      this.generateContent = (params) => client.models.generateContent(params);
    }
  }

  async generate<S extends z.ZodType>(req: { system: string; user: string; schema: S; maxTokens: number }): Promise<LlmResult<z.infer<S>>> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"TIMEOUT">((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve("TIMEOUT");
      }, this.timeoutMs);
    });
    let res: GenerateContentResponse;
    try {
      const outcome = await Promise.race([
        this.generateContent({
          model: this.model,
          contents: req.user,
          config: {
            systemInstruction: req.system,
            responseMimeType: "application/json",
            responseJsonSchema: z.toJSONSchema(req.schema),
            maxOutputTokens: req.maxTokens + THINKING_HEADROOM_TOKENS,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            abortSignal: controller.signal,
          },
        }),
        timedOut,
      ]);
      if (outcome === "TIMEOUT") return this.fail("TIMEOUT");
      res = outcome;
    } catch (err) {
      return this.fail(controller.signal.aborted ? "TIMEOUT" : classifyFailure(err).reason, controller.signal.aborted ? { category: "TIMEOUT" } : classifyFailure(err).diagnostic);
    } finally {
      clearTimeout(timer);
    }
    return parseGemini(res, req.schema, this.model);
  }

  private fail(reason: LlmFailure, diagnostic?: LlmDiagnostic): LlmResult<never> {
    const d = diagnostic;
    console.warn(`[gridwindow] model call failed: ${reason} (gemini)${d?.httpStatus ? ` http=${d.httpStatus}` : ""}${d?.providerStatus ? ` status=${d.providerStatus}` : ""}${d?.errorName ? ` error=${d.errorName}` : ""}`);
    return { ok: false, reason, ...(d ? { diagnostic: d } : {}) };
  }

  /**
   * Metadata-only check (models.get, no generation, no tokens) that the model exists for this key's project and
   * supports generateContent. It cannot tell whether the project is on the free tier or has quota: a zero free
   * quota only shows up as HTTP 429 on a real generation call.
   */
  static async checkModelAccess(apiKey: string, model: string = DEFAULT_GEMINI_MODEL): Promise<{ available: boolean; supportsGenerateContent: boolean; inputTokenLimit?: number; diagnostic?: LlmDiagnostic }> {
    try {
      const m = await new GoogleGenAI({ apiKey, httpOptions: { timeout: TIMEOUT_MS, retryOptions: { attempts: 1 } } }).models.get({ model });
      const actions = m.supportedActions ?? [];
      return { available: true, supportsGenerateContent: actions.includes("generateContent"), ...(m.inputTokenLimit ? { inputTokenLimit: m.inputTokenLimit } : {}) };
    } catch (err) {
      return { available: false, supportsGenerateContent: false, diagnostic: classifyFailure(err).diagnostic };
    }
  }
}

/**
 * @google/genai ships separate ESM and CJS builds, each with its own ApiError class, so `instanceof` is false when the
 * client and this adapter were loaded through different builds and the HTTP status would be lost. Match the shape too.
 */
function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError || (err instanceof Error && err.name === "ApiError" && typeof (err as { status?: unknown }).status === "number");
}

/** Sanitized: the error class, HTTP status and provider status word only; never the message, which may echo request content. */
export function classifyFailure(err: unknown): { reason: LlmFailure; diagnostic: LlmDiagnostic } {
  if (isApiError(err)) {
    const reason = classifyHttpStatus(err.status);
    const providerStatus = providerStatusWord(err.message);
    return { reason, diagnostic: { category: reason, errorName: err.name, httpStatus: err.status, ...(providerStatus ? { providerStatus } : {}) } };
  }
  const network = err instanceof TypeError || (err instanceof Error && /fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|socket/i.test(err.message));
  return { reason: "UNAVAILABLE", diagnostic: { category: network ? "NETWORK" : "CLIENT_ERROR", errorName: err instanceof Error ? err.name : "UNKNOWN" } };
}

/** Interprets a completed response; blocked, truncated or non-JSON output is never repaired. */
function parseGemini<S extends z.ZodType>(res: GenerateContentResponse, schema: S, requestedModel: string): LlmResult<z.infer<S>> {
  const u = res.usageMetadata;
  const usage = u ? { inputTokens: u.promptTokenCount ?? 0, outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) } : undefined;
  if (res.promptFeedback?.blockReason) return { ok: false, reason: "REFUSED", usage };
  const finish = res.candidates?.[0]?.finishReason ? String(res.candidates[0].finishReason) : null;
  if (finish && REFUSAL_FINISH_REASONS.has(finish)) return { ok: false, reason: "REFUSED", usage };
  const text = res.text;
  if (finish !== "STOP" || !text) return { ok: false, reason: "INVALID_OUTPUT", usage };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: "INVALID_OUTPUT", usage };
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? { ok: true, value: parsed.data, model: res.modelVersion ?? requestedModel, usage } : { ok: false, reason: "SCHEMA_MISMATCH", usage };
}
