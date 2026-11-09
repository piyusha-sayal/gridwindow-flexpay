import { NextResponse } from "next/server";
import { z } from "zod";
import { driverSession, handler, isOperator } from "@/server/http";
import { ServiceError } from "@/server/deps";
import { getRuntime } from "@/server/runtime";
import { driverDefaultNightOf } from "@/server/services/quoteService";
import { driverScheduleView, scheduleView } from "@/server/services/scheduleView";

const night = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** GET /api/schedule?nightOf=YYYY-MM-DD: the operator sees the whole night, a driver only their own sessions. */
export const GET = handler(async (req: Request) => {
  const { deps } = await getRuntime();
  const param = new URL(req.url).searchParams.get("nightOf");
  const nightOf = param ? night.parse(param) : driverDefaultNightOf(deps.station, deps.now());
  if (await isOperator()) return NextResponse.json({ schedule: await scheduleView(deps, nightOf) });
  const session = await driverSession(false);
  if (!session) throw new ServiceError("UNAUTHORIZED", "Sign in to see your schedule.", 401);
  return NextResponse.json({ schedule: await driverScheduleView(deps, nightOf, session) });
});
