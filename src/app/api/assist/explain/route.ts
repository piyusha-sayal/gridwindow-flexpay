import { NextResponse } from "next/server";
import { z } from "zod";
import { explainOfferWithAi } from "@/server/ai/assistant";
import { ServiceError } from "@/server/deps";
import { assertSameOrigin, driverSession, handler, rateLimit, readJson } from "@/server/http";
import { getRuntime } from "@/server/runtime";
import { getQuoteSet } from "@/server/services/quoteService";

const schema = z.object({ quoteSetId: z.string().min(1).max(64), offerId: z.string().min(1).max(128) }).strict();

/** Explains one of the caller's own offers. Numbers come from the stored quote; model text is grounding-checked. */
export const POST = handler(async (req: Request) => {
  await assertSameOrigin(req);
  rateLimit(req, "assist", 30);
  const { quoteSetId, offerId } = schema.parse(await readJson(req));
  const session = await driverSession(false);
  if (!session) throw new ServiceError("QUOTE_NOT_FOUND", "Quote not found.", 404);
  const { deps, llm } = await getRuntime();
  const { quote } = await getQuoteSet(deps, session, quoteSetId);
  const offer = quote.offers.find((o) => o.offerId === offerId);
  if (!offer) throw new ServiceError("OFFER_NOT_FOUND", "Offer not found.", 404);
  return NextResponse.json(await explainOfferWithAi(llm, quote, offer));
});
