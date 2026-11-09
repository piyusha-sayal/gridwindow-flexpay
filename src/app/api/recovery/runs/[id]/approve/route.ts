import { NextResponse } from "next/server";
import { ServiceError } from "@/server/deps";
import { assertSameOrigin, driverSession, handler, rateLimit } from "@/server/http";
import { getRuntime } from "@/server/runtime";
import { approveRecoveryRun } from "@/server/services/scheduleService";

/** Driver approves the exact proposal version of their own reservation. Expired or foreign proposals are refused. */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await assertSameOrigin(req);
  rateLimit(req, "recovery-decide", 20);
  const { id } = await ctx.params;
  const session = await driverSession(false);
  if (!session) throw new ServiceError("NOT_FOUND", "Recovery not found.", 404);
  const { deps } = await getRuntime();
  return NextResponse.json({ run: await approveRecoveryRun(deps, id, session) });
});
