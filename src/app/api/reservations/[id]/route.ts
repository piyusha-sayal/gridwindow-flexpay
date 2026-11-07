import { NextResponse } from "next/server";
import { ServiceError } from "@/server/deps";
import { driverSession, handler, isOperator } from "@/server/http";
import { getRuntime } from "@/server/runtime";
import { reservationView } from "@/server/services/viewService";

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { deps } = await getRuntime();
  if (await isOperator()) return NextResponse.json({ reservation: await reservationView(deps, id, { operator: true }) });
  const session = await driverSession(false);
  if (!session) throw new ServiceError("NOT_FOUND", "Reservation not found.", 404);
  return NextResponse.json({ reservation: await reservationView(deps, id, { driverSession: session }) });
});
