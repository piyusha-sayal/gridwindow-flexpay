/**
 * The real AnthropicLlm adapter against a local fake transport: no network, no paid calls.
 * Proves failure mapping (timeout, outage, invalid output) and the shape of what is sent.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AnthropicLlm } from "@/server/ai/llm";

const schema = z.object({ answer: z.string().max(200) });
const req = { system: "sys", user: "<request>hi</request>", schema, maxTokens: 300 };

function message(text: string, stopReason = "end_turn"): Response {
  const body = {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function fakeFetch(respond: (body: Record<string, unknown>) => Response | Promise<Response>) {
  const sent: Record<string, unknown>[] = [];
  const fn = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    sent.push(body);
    return respond(body);
  }) as typeof fetch;
  return { fn, sent };
}

describe("AnthropicLlm adapter (offline)", () => {
  it("returns schema-validated output and sends no tools", async () => {
    const t = fakeFetch(() => message(JSON.stringify({ answer: "ok" })));
    const llm = new AnthropicLlm("test-key", undefined, { fetch: t.fn });
    expect(await llm.generate(req)).toEqual({ ok: true, value: { answer: "ok" }, model: "claude-opus-5-5", usage: { inputTokens: 1, outputTokens: 1 } });
    expect(t.sent[0]).toMatchObject({ model: "claude-opus-5-5", max_tokens: 300, system: "sys" });
    expect(t.sent[0]).not.toHaveProperty("tools");
    expect(JSON.stringify(t.sent[0])).not.toContain("test-key");
  });

  it("maps provider outage to UNAVAILABLE after one bounded retry", async () => {
    const t = fakeFetch(() => new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "x" } }), { status: 503 }));
    const llm = new AnthropicLlm("test-key", undefined, { fetch: t.fn });
    expect(await llm.generate(req)).toMatchObject({ ok: false, reason: "UNAVAILABLE", diagnostic: { category: "UNAVAILABLE", httpStatus: 503 } });
    expect(t.sent.length).toBe(2);
  });

  it("maps a hung request to TIMEOUT via the client timeout", async () => {
    const hang = ((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as typeof fetch;
    const llm = new AnthropicLlm("test-key", undefined, { fetch: hang, timeoutMs: 50 });
    expect(await llm.generate(req)).toMatchObject({ ok: false, reason: "TIMEOUT" });
  });

  it("maps a network failure to UNAVAILABLE, not TIMEOUT", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const llm = new AnthropicLlm("test-key", undefined, { fetch: down });
    expect(await llm.generate(req)).toMatchObject({ ok: false, reason: "UNAVAILABLE" });
  });

  it("separates malformed or truncated output from schema mismatches", async () => {
    const cases: [Response, string][] = [
      [message("not json at all"), "INVALID_OUTPUT"],
      [message(""), "INVALID_OUTPUT"],
      [message('{"answer": "cut of', "max_tokens"), "INVALID_OUTPUT"],
      [message(JSON.stringify({ answer: "x".repeat(500) })), "SCHEMA_MISMATCH"],
      [message(JSON.stringify({ other: 1 })), "SCHEMA_MISMATCH"],
    ];
    for (const [response, reason] of cases) {
      const llm = new AnthropicLlm("test-key", undefined, { fetch: fakeFetch(() => response).fn });
      expect(await llm.generate(req), reason).toEqual({ ok: false, reason, usage: { inputTokens: 1, outputTokens: 1 } });
    }
  });

  it("reports an explicit refusal as REFUSED even when refusal text is present", async () => {
    for (const text of ["I can't help with that.", ""]) {
      const llm = new AnthropicLlm("test-key", undefined, { fetch: fakeFetch(() => message(text, "refusal")).fn });
      expect(await llm.generate(req)).toEqual({ ok: false, reason: "REFUSED", usage: { inputTokens: 1, outputTokens: 1 } });
    }
  });

  it("sends the schema as a JSON-schema output format", async () => {
    const t = fakeFetch(() => message(JSON.stringify({ answer: "ok" })));
    await new AnthropicLlm("test-key", undefined, { fetch: t.fn }).generate(req);
    expect(t.sent[0]).toMatchObject({ output_config: { effort: "low", format: { type: "json_schema" } } });
  });
});
