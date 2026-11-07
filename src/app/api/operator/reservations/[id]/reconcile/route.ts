import { NextResponse } from "next/server";
import { ServiceError } from "@/server/deps";
import { assertSameOrigin, handler, rateLimit, requireOperator } from "@/server/http";
import { getReservation } from "@/server/repo";
import { getRuntime } from "@/server/runtime";
import { recoverReservation } from "@/server/services/recoveryService";
import { reservationView } from "@/server/services/viewService";

export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await assertSameOrigin(req);
  await requireOperator();
  rateLimit(req, "operator-reconcile", 20);
  const { id } = await ctx.params;
  const { deps } = await getRuntime();
  if (!(await getReservation(deps.db, id))) throw new ServiceError("NOT_FOUND", "Reservation not found.", 404);
  await recoverReservation(deps, id, "OPERATOR");
  return NextResponse.json({ reservation: await reservationView(deps, id, { operator: true }) });
});
