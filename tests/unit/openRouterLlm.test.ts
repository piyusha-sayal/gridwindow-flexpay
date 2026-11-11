/** OpenRouter adapter, offline: every request goes to a stubbed fetch. No network, no key. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_OPENROUTER_MODEL, OPENROUTER_ENDPOINT, OpenRouterLlm, supportsResponseFormat, type FetchLike } from "@/server/ai/openRouterLlm";

const API_KEY = "sk-or-test-key-should-never-appear";
const SECRET_PROMPT = "PROMPT-CONTENT-THAT-MUST-NOT-LEAK";
const schema = z.object({ summary: z.string() });
const req = { system: "sys", user: SECRET_PROMPT, schema, maxTokens: 100 };

type Reply = { status: number; body: unknown };
function stub(...replies: Reply[]): { fetch: FetchLike; calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] } {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    return { ok: r.status < 400, status: r.status, text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)) };
  };
  return { fetch, calls };
}
const success = (content: unknown, extra: Record<string, unknown> = {}): Reply => ({
  status: 200,
  body: { model: "anthropic/claude-haiku-5.5-20260101", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 120, completion_tokens: 30 }, ...extra },
});

afterEach(() => vi.restoreAllMocks());

describe("OpenRouterLlm request", () => {
  it("sends one schema-constrained, tool-free request to the documented endpoint, with a data-collection opt-out", async () => {
    const s = stub(success({ summary: "ok" }));
    await new OpenRouterLlm(API_KEY, undefined, { fetch: s.fetch }).generate(req);
    expect(s.calls).toHaveLength(1);
    const c = s.calls[0]!;
    expect(c.url).toBe(OPENROUTER_ENDPOINT);
    expect(c.headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(c.body.model).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(c.body.max_tokens).toBe(100 + 1024);
    expect(c.body.provider).toEqual({ require_parameters: true, data_collection: "deny" });
    const rf = c.body.response_format as { type: string; json_schema: { strict: boolean; schema: Record<string, unknown> } };
    expect(rf.type).toBe("json_schema");
    expect(rf.json_schema.strict).toBe(true);
    expect(rf.json_schema.schema.$schema).toBeUndefined();
    // Same contract as the Gemini adapter: text only, no tools, no function calling; only parameters every endpoint must honour.
    for (const forbidden of ["tools", "tool_choice", "functions", "plugins", "temperature", "reasoning"]) expect(c.body).not.toHaveProperty(forbidden);
    const messages = c.body.messages as { role: string; content: string }[];
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(messages[0]!.content).toContain("exactly one JSON object");
    expect(JSON.stringify(c.body)).not.toContain(API_KEY);
  });

  it("omits response_format for Amazon Nova (not in its published parameters) and states the schema in the prompt instead", async () => {
    expect(supportsResponseFormat("amazon/nova-2-lite-v1")).toBe(false);
    expect(supportsResponseFormat(DEFAULT_OPENROUTER_MODEL)).toBe(true);
    const s = stub(success({ summary: "ok" }));
    const res = await new OpenRouterLlm(API_KEY, "amazon/nova-2-lite-v1", { fetch: s.fetch }).generate(req);
    expect(res).toMatchObject({ ok: true, value: { summary: "ok" }, provider: "openrouter" });
    const c = s.calls[0]!;
    for (const unsupported of ["response_format", "structured_outputs", "tools", "tool_choice", "functions"]) expect(c.body).not.toHaveProperty(unsupported);
    expect(c.body.provider).toEqual({ require_parameters: true, data_collection: "deny" });
    const system = (c.body.messages as { content: string }[])[0]!.content;
    expect(system).toContain("exactly one JSON object");
    expect(system).toContain('"summary"');
    expect(system).not.toContain("$schema");
  });

  it("still rejects, never repairs, a Nova answer that breaks the schema or wraps JSON in prose", async () => {
    const nova = (reply: Reply) => new OpenRouterLlm(API_KEY, "amazon/nova-2-lite-v1", { fetch: stub(reply).fetch }).generate(req);
    expect(await nova(success({ nope: 1 }))).toMatchObject({ ok: false, reason: "SCHEMA_MISMATCH" });
    const fenced = { status: 200, body: { choices: [{ finish_reason: "stop", message: { content: '```json\n{"summary":"x"}\n```' } }] } };
    expect(await nova(fenced)).toMatchObject({ ok: false, reason: "INVALID_OUTPUT" });
  });

  it("uses a configured model id", async () => {
    const s = stub(success({ summary: "ok" }));
    await new OpenRouterLlm(API_KEY, "vendor/some-model", { fetch: s.fetch }).generate(req);
    expect(s.calls[0]!.body.model).toBe("vendor/some-model");
  });
});

describe("OpenRouterLlm response", () => {
  it("returns schema-validated output tagged with the serving provider, the served model and usage", async () => {
    const res = await new OpenRouterLlm(API_KEY, undefined, { fetch: stub(success({ summary: "hello" })).fetch }).generate(req);
    expect(res).toEqual({ ok: true, value: { summary: "hello" }, model: "anthropic/claude-haiku-5.5-20260101", provider: "openrouter", usage: { inputTokens: 120, outputTokens: 30 } });
  });

  it.each([
    [400, "REQUEST_REJECTED"],
    [401, "AUTH_FAILED"],
    [402, "QUOTA_EXHAUSTED"],
    [403, "AUTH_FAILED"],
    [404, "REQUEST_REJECTED"],
    [429, "QUOTA_EXHAUSTED"],
    [502, "UNAVAILABLE"],
    [503, "UNAVAILABLE"],
  ])("HTTP %i is %s with a sanitized diagnostic and exactly one request (no retry)", async (status, reason) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const s = stub({ status, body: { error: { code: status, message: `leaks ${SECRET_PROMPT} ${API_KEY}`, metadata: { raw: SECRET_PROMPT } } } });
    const res = await new OpenRouterLlm(API_KEY, undefined, { fetch: s.fetch }).generate(req);
    expect(res).toMatchObject({ ok: false, reason, diagnostic: { category: reason, httpStatus: status } });
    expect(s.calls).toHaveLength(1);
    const logged = JSON.stringify(warn.mock.calls) + JSON.stringify(res);
    expect(logged).not.toContain(API_KEY);
    expect(logged).not.toContain(SECRET_PROMPT);
  });

  it("reads a provider error carried inside a 200 response", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = await new OpenRouterLlm(API_KEY, undefined, { fetch: stub({ status: 200, body: { error: { code: 502, message: "upstream" } } }).fetch }).generate(req);
    expect(res).toMatchObject({ ok: false, reason: "UNAVAILABLE", diagnostic: { httpStatus: 502 } });
  });

  it("reports a content filter or refusal as REFUSED, not as an outage", async () => {
    const filtered = { status: 200, body: { choices: [{ finish_reason: "content_filter", message: { content: null } }] } };
    const refused = { status: 200, body: { choices: [{ finish_reason: "stop", message: { content: null, refusal: "I can't help with that" } }] } };
    expect(await new OpenRouterLlm(API_KEY, undefined, { fetch: stub(filtered).fetch }).generate(req)).toMatchObject({ ok: false, reason: "REFUSED" });
    expect(await new OpenRouterLlm(API_KEY, undefined, { fetch: stub(refused).fetch }).generate(req)).toMatchObject({ ok: false, reason: "REFUSED" });
  });

  it("separates truncated, non-JSON and schema-violating output; nothing is repaired", async () => {
    const truncated = { status: 200, body: { choices: [{ finish_reason: "length", message: { content: '{"summary":"par' } }] } };
    const notJson = { status: 200, body: { choices: [{ finish_reason: "stop", message: { content: "sure! here you go" } }] } };
    const wrongShape = success({ nope: 1 });
    const empty = { status: 200, body: { choices: [] } };
    for (const [reply, reason] of [[truncated, "INVALID_OUTPUT"], [notJson, "INVALID_OUTPUT"], [wrongShape, "SCHEMA_MISMATCH"], [empty, "INVALID_OUTPUT"]] as const) {
      expect(await new OpenRouterLlm(API_KEY, undefined, { fetch: stub(reply).fetch }).generate(req)).toMatchObject({ ok: false, reason });
    }
  });

  it("maps a network failure to UNAVAILABLE and a hung request to TIMEOUT even though fetch only ends on abort", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const down: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await new OpenRouterLlm(API_KEY, undefined, { fetch: down }).generate(req)).toMatchObject({ ok: false, reason: "UNAVAILABLE", diagnostic: { category: "NETWORK" } });
    const hung: FetchLike = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    expect(await new OpenRouterLlm(API_KEY, undefined, { fetch: hung, timeoutMs: 30 }).generate(req)).toMatchObject({ ok: false, reason: "TIMEOUT" });
  });

  it("does not log the key or the prompt on any failure path", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const down: FetchLike = async () => {
      throw new Error(`socket hang up for ${API_KEY} ${SECRET_PROMPT}`);
    };
    const res = await new OpenRouterLlm(API_KEY, undefined, { fetch: down }).generate(req);
    expect(res.ok).toBe(false);
    expect(JSON.stringify(warn.mock.calls) + JSON.stringify(res)).not.toMatch(new RegExp(`${API_KEY}|${SECRET_PROMPT}`));
  });
});
