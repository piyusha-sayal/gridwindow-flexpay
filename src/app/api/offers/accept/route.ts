import { NextResponse } from "next/server";
import { ServiceError } from "@/server/deps";
import { assertSameOrigin, driverSession, handler, rateLimit, readJson } from "@/server/http";
import { getRuntime } from "@/server/runtime";
import { acceptOffer, acceptSchema } from "@/server/services/checkoutService";

export const POST = handler(async (req: Request) => {
  await assertSameOrigin(req);
  rateLimit(req, "accept", 20);
  const input = acceptSchema.parse(await readJson(req));
  const session = await driverSession(false);
  if (!session) throw new ServiceError("QUOTE_NOT_FOUND", "Quote not found.", 404);
  const { deps } = await getRuntime();
  return NextResponse.json(await acceptOffer(deps, session, input));
});
