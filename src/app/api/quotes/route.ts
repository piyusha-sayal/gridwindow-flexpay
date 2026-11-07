import { NextResponse } from "next/server";
import { assertSameOrigin, driverSession, handler, rateLimit, readJson } from "@/server/http";
import { getRuntime } from "@/server/runtime";
import { createQuote, quoteRequestSchema } from "@/server/services/quoteService";

export const POST = handler(async (req: Request) => {
  await assertSameOrigin(req);
  rateLimit(req, "quotes", 30);
  const input = quoteRequestSchema.parse(await readJson(req));
  const { deps } = await getRuntime();
  const session = (await driverSession())!;
  return NextResponse.json({ quote: await createQuote(deps, session, input) });
});
