import { NextResponse } from "next/server";
import { z } from "zod";
import { isMockGateway } from "@/payments/mockGateway";
import { ServiceError } from "@/server/deps";
import { assertSameOrigin, handler, rateLimit, readJson, requireOperator } from "@/server/http";
import { getReservation } from "@/server/repo";
import { getRuntime } from "@/server/runtime";
import { recoverReservation } from "@/server/services/recoveryService";
import { reservationView } from "@/server/services/viewService";

const schema = z.object({ status: z.enum(["COMPLETED", "DECLINED"]) }).strict();

/**
 * MOCK only, operator only: the provider finishes a PENDING capture, then the app reconciles
 * from provider state exactly as it would after a verified PayPal webhook.
 */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await assertSameOrigin(req);
  await requireOperator();
  rateLimit(req, "operator-mock-capture", 20);
  const { id } = await ctx.params;
  const { status } = schema.parse(await readJson(req));
  const { deps } = await getRuntime();
  if (!isMockGateway(deps.gateway)) throw new ServiceError("MOCK_ONLY", "Only available in MOCK mode.", 409);
  const r = await getReservation(deps.db, id);
  if (!r?.paypal_capture_id || r.payment_state !== "CAPTURE_PENDING") throw new ServiceError("NOT_PENDING", "Reservation has no pending capture.", 409);
  await deps.gateway.resolvePendingCapture(r.paypal_capture_id, status);
  await recoverReservation(deps, id, "OPERATOR");
  return NextResponse.json({ reservation: await reservationView(deps, id, { operator: true }) });
});
