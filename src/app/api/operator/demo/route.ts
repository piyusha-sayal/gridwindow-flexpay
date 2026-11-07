import { NextResponse } from "next/server";
import { z } from "zod";
import { ServiceError } from "@/server/deps";
import { assertSameOrigin, handler, rateLimit, readJson, requireOperator } from "@/server/http";
import { getRuntime } from "@/server/runtime";
import { demoToolsAllowed, resetDemoData, seedDemoNight } from "@/server/services/demoService";

const schema = z.discriminatedUnion("action", [
  // Destructive: the caller must send the explicit confirmation the UI collects.
  z.object({ action: z.literal("reset"), confirm: z.literal("RESET") }).strict(),
  z.object({ action: z.literal("seed"), nightOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
]);

/** Dev-only demo reset/seed: requires DEMO_TOOLS=true, MOCK provider, embedded DB, operator session and same origin. */
export const POST = handler(async (req: Request) => {
  await assertSameOrigin(req);
  const { env, deps } = await getRuntime();
  if (!demoToolsAllowed(env)) throw new ServiceError("NOT_FOUND", "Not available.", 404);
  await requireOperator();
  rateLimit(req, "operator-demo", 10);
  const body = schema.parse(await readJson(req));
  if (body.action === "reset") {
    await resetDemoData(deps);
    return NextResponse.json({ reset: true });
  }
  return NextResponse.json({ seeded: await seedDemoNight(deps, body.nightOf) });
});
