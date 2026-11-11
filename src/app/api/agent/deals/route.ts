import { NextResponse } from "next/server";
import { dealRequestSchema, recommendDealForDriver } from "@/server/ai/dealAgent";
import { ServiceError } from "@/server/deps";
import { assertSameOrigin, driverSession, handler, rateLimit, readJson } from "@/server/http";
import { getRuntime } from "@/server/runtime";

/**
 * Read-only Flex Deal Agent: evaluates the caller's own stored quote against their goals and explains
 * the result. It writes nothing: no acceptance, terms, prices, payments or capacity change.
 */
export const POST = handler(async (req: Request) => {
  await assertSameOrigin(req);
  rateLimit(req, "assist", 30);
  const input = dealRequestSchema.parse(await readJson(req));
  const session = await driverSession(false);
  if (!session) throw new ServiceError("QUOTE_NOT_FOUND", "Quote not found.", 404);
  const { deps, llm } = await getRuntime();
  return NextResponse.json(await recommendDealForDriver(deps, llm, session, input));
});
