import { NextResponse } from "next/server";
import { z } from "zod";
import { answerReservationQuestion } from "@/server/ai/assistant";
import { ServiceError } from "@/server/deps";
import { assertSameOrigin, driverSession, handler, isOperator, rateLimit, readJson } from "@/server/http";
import { getRuntime } from "@/server/runtime";
import { reservationView } from "@/server/services/viewService";

const schema = z.object({ reservationId: z.string().min(1).max(64), question: z.string().trim().min(1).max(500) }).strict();

/** Read-only Q&A about the caller's own reservation. The model has no tools and cannot act. */
export const POST = handler(async (req: Request) => {
  await assertSameOrigin(req);
  rateLimit(req, "assist", 30);
  const { reservationId, question } = schema.parse(await readJson(req));
  const { deps, llm } = await getRuntime();
  const session = await driverSession(false);
  const operator = await isOperator();
  if (!session && !operator) throw new ServiceError("NOT_FOUND", "Reservation not found.", 404);
  const view = await reservationView(deps, reservationId, operator ? { operator: true } : { driverSession: session! });
  return NextResponse.json(await answerReservationQuestion(llm, view, question));
});
