/**
 * OpenRouter implementation of the narrow model boundary (see llm.ts). Same contract as GeminiLlm: one schema-validated
 * JSON object in, text-only out, no tools, no function calling, no state access. Every failure maps to an LlmFailure and
 * ends in the deterministic fallback. Chat Completions request shape, provider routing and error codes follow
 * https://openrouter.ai/docs/features/structured-outputs, /docs/guides/routing/provider-selection and /docs/api-reference/errors
 * (read 2026-11-10). The adapter has not been exercised against the live service.
 */
import { z } from "zod";
import { classifyHttpStatus, type LlmDiagnostic, type LlmFailure, type LlmResult, type LlmUsage, type ModelProvider, type StructuredLlm } from "./llm";

/**
 * Selected from the public catalog (2026-11-10): lists response_format + structured_outputs, 1M context, several independent
 * endpoints (Anthropic, Azure, Bedrock, Google), $0.10 / $0.50 per million tokens. The Amazon Nova models are on OpenRouter
 * (served by Amazon Bedrock) but advertise no response_format or structured_outputs, so they cannot honour the strict schema.
 */
export const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-haiku-5.5";
export const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 8_000;
/** Reasoning-capable models count thinking against max_tokens; headroom keeps a short answer from being cut off. */
const OUTPUT_HEADROOM_TOKENS = 1_024;
const JSON_ONLY = "Respond with exactly one JSON object that matches the response schema. No prose, no code fences.";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface OpenRouterTransport {
  fetch?: FetchLike;
  timeoutMs?: number;
}

const responseSchema = z.object({
  model: z.string().optional(),
  error: z.object({ code: z.union([z.number(), z.string()]).optional() }).passthrough().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({ content: z.string().nullable().optional(), refusal: z.string().nullable().optional() }).passthrough().optional(),
      }),
    )
    .optional(),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() }).passthrough().optional(),
});

/** OpenRouter-specific mapping: 402 means the account is out of credits; every other status follows the shared table. */
export function classifyOpenRouterStatus(status: number | undefined): LlmFailure {
  return status === 402 ? "QUOTA_EXHAUSTED" : classifyHttpStatus(status);
}

export class OpenRouterLlm implements StructuredLlm {
  readonly provider: ModelProvider = "openrouter";
  private readonly doFetch: FetchLike;
  private readonly timeoutMs: number;

  constructor(
    private readonly apiKey: string,
    readonly model: string = DEFAULT_OPENROUTER_MODEL,
    transport: OpenRouterTransport = {},
  ) {
    this.timeoutMs = transport.timeoutMs ?? TIMEOUT_MS;
    this.doFetch = transport.fetch ?? ((url, init) => fetch(url, init));
  }

  async generate<S extends z.ZodType>(req: { system: string; user: string; schema: S; maxTokens: number }): Promise<LlmResult<z.infer<S>>> {
    const schema = z.toJSONSchema(req.schema) as Record<string, unknown>;
    delete schema.$schema;
    const body = JSON.stringify({
      model: this.model,
      messages: [
        { role: "system", content: `${req.system}\n\n${JSON_ONLY}` },
        { role: "user", content: req.user },
      ],
      max_tokens: req.maxTokens + OUTPUT_HEADROOM_TOKENS,
      response_format: { type: "json_schema", json_schema: { name: "response", strict: true, schema } },
      // Only endpoints that honour every parameter above, and none that may retain or train on the prompt.
      provider: { require_parameters: true, data_collection: "deny" },
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let status: number;
    let text: string;
    try {
      const res = await this.doFetch(OPENROUTER_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", "X-Title": "GridWindow FlexPay" },
        body,
        signal: controller.signal,
      });
      status = res.status;
      text = await res.text();
    } catch (err) {
      if (controller.signal.aborted) return this.fail("TIMEOUT", { category: "TIMEOUT" });
      const network = err instanceof TypeError || (err instanceof Error && /fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|socket/i.test(err.message));
      return this.fail("UNAVAILABLE", { category: network ? "NETWORK" : "CLIENT_ERROR", errorName: err instanceof Error ? err.name : "UNKNOWN" });
    } finally {
      clearTimeout(timer);
    }
    return this.interpret(status, text, req.schema);
  }

  private interpret<S extends z.ZodType>(status: number, text: string, schema: S): LlmResult<z.infer<S>> {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return status >= 400 ? this.fail(classifyOpenRouterStatus(status), { category: classifyOpenRouterStatus(status), httpStatus: status }) : { ok: false, reason: "INVALID_OUTPUT" };
    }
    const body = responseSchema.safeParse(json);
    if (!body.success) return status >= 400 ? this.fail(classifyOpenRouterStatus(status), { category: classifyOpenRouterStatus(status), httpStatus: status }) : { ok: false, reason: "INVALID_OUTPUT" };
    const data = body.data;
    // OpenRouter reports mid-generation provider errors inside a 200 response; the status is then in error.code.
    const code = typeof data.error?.code === "number" ? data.error.code : status >= 400 ? status : undefined;
    if (data.error || status >= 400) {
      const reason = classifyOpenRouterStatus(code);
      return this.fail(reason, { category: reason, errorName: "OpenRouterError", ...(code ? { httpStatus: code } : {}) });
    }
    const usage: LlmUsage | undefined = data.usage ? { inputTokens: data.usage.prompt_tokens ?? 0, outputTokens: data.usage.completion_tokens ?? 0 } : undefined;
    const choice = data.choices?.[0];
    // A refusal is the model's decision, not an outage: it is reported as such and never routed around.
    if (choice?.finish_reason === "content_filter" || choice?.message?.refusal) return { ok: false, reason: "REFUSED", ...(usage ? { usage } : {}) };
    const content = choice?.message?.content;
    if (choice?.finish_reason !== "stop" || !content) return { ok: false, reason: "INVALID_OUTPUT", ...(usage ? { usage } : {}) };
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      return { ok: false, reason: "INVALID_OUTPUT", ...(usage ? { usage } : {}) };
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) return { ok: false, reason: "SCHEMA_MISMATCH", ...(usage ? { usage } : {}) };
    return { ok: true, value: parsed.data, model: data.model ?? this.model, provider: this.provider, ...(usage ? { usage } : {}) };
  }

  /** Logs the error class and status only; never the key, the prompt, the model text or the provider's message. */
  private fail(reason: LlmFailure, diagnostic: LlmDiagnostic): LlmResult<never> {
    console.warn(`[gridwindow] model call failed: ${reason} (openrouter)${diagnostic.httpStatus ? ` http=${diagnostic.httpStatus}` : ""}${diagnostic.errorName ? ` error=${diagnostic.errorName}` : ""}`);
    return { ok: false, reason, diagnostic };
  }
}
