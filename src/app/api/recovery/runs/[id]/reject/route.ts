import { NextResponse } from "next/server";
import { ServiceError } from "@/server/deps";
import { assertSameOrigin, driverSession, handler, rateLimit } from "@/server/http";
import { getRuntime } from "@/server/runtime";
import { rejectRecoveryRun } from "@/server/services/scheduleService";

/** Driver declines a pending proposal of their own reservation. No schedule changes. */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await assertSameOrigin(req);
  rateLimit(req, "recovery-decide", 20);
  const { id } = await ctx.params;
  const session = await driverSession(false);
  if (!session) throw new ServiceError("NOT_FOUND", "Recovery not found.", 404);
  const { deps } = await getRuntime();
  return NextResponse.json({ run: await rejectRecoveryRun(deps, id, session) });
});
