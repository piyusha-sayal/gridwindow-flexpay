import { NextResponse } from "next/server";
import { ServiceError } from "@/server/deps";
import { driverSession, handler, isOperator, rateLimit } from "@/server/http";
import { getRuntime } from "@/server/runtime";
import { getRecoveryRunView } from "@/server/services/recoveryRuns";

/** The owning driver or an operator reads one recovery run, including its sanitized trace. Others get 404. */
export const GET = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  rateLimit(req, "recovery-read", 60);
  const { id } = await ctx.params;
  const { deps } = await getRuntime();
  if (await isOperator()) return NextResponse.json({ run: await getRecoveryRunView(deps, id, { operator: true }) });
  const session = await driverSession(false);
  if (!session) throw new ServiceError("NOT_FOUND", "Recovery not found.", 404);
  return NextResponse.json({ run: await getRecoveryRunView(deps, id, { driverSession: session }) });
});
