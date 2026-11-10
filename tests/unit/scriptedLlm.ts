import type { z } from "zod";
import type { LlmResult, StructuredLlm } from "@/server/ai/llm";

/** Test double: returns a scripted result and records what the assistant sent. */
export class ScriptedLlm implements StructuredLlm {
  readonly provider = "test-fixture" as const;
  readonly model = "test-double";
  calls: { system: string; user: string }[] = [];
  constructor(private readonly reply: (user: string) => LlmResult<unknown>) {}
  async generate<S extends z.ZodType>(req: { system: string; user: string; schema: S }): Promise<LlmResult<z.infer<S>>> {
    this.calls.push({ system: req.system, user: req.user });
    const out = this.reply(req.user);
    if (!out.ok) return out;
    const parsed = req.schema.safeParse(out.value);
    return parsed.success ? { ok: true, value: parsed.data, model: this.model } : { ok: false, reason: "SCHEMA_MISMATCH" };
  }
}

export const ok = (value: unknown): LlmResult<unknown> => ({ ok: true, value, model: "test-double" });
