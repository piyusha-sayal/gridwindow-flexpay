import { NextResponse } from "next/server";
import { ServiceError } from "@/server/deps";
import { assertSameOrigin, driverSession, handler, rateLimit } from "@/server/http";
import { getRuntime } from "@/server/runtime";
import { runSimulation } from "@/server/services/settlementService";
import { reservationView } from "@/server/services/viewService";

/** Driver may run the nominal (fault-free) synthetic night for their own reservation only. */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await assertSameOrigin(req);
  rateLimit(req, "simulate", 10);
  const { id } = await ctx.params;
  const session = await driverSession(false);
  if (!session) throw new ServiceError("NOT_FOUND", "Reservation not found.", 404);
  const { deps } = await getRuntime();
  await runSimulation(deps, id, { kind: "DRIVER", session });
  return NextResponse.json({ reservation: await reservationView(deps, id, { driverSession: session }) });
});
