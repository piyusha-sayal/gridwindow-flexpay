import { NextResponse } from "next/server";
import { assertSameOrigin, handler, rateLimit, readJson, requireOperator } from "@/server/http";
import { getRuntime } from "@/server/runtime";
import { recordDisruption } from "@/server/services/scheduleService";

/** Operator-only: record a disturbance (idempotent by eventId). Recording starts autonomous recovery, which only proposes or applies validated changes. */
export const POST = handler(async (req: Request) => {
  await assertSameOrigin(req);
  await requireOperator();
  rateLimit(req, "recovery-event", 30);
  const { deps } = await getRuntime();
  const { event, created } = await recordDisruption(deps, await readJson(req));
  return NextResponse.json({ event, created }, { status: created ? 201 : 200 });
});
