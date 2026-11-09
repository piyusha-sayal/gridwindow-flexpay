import { NextResponse } from "next/server";
import { driverSession, handler } from "@/server/http";
import { getRuntime } from "@/server/runtime";
import { listSessionReservations } from "@/server/services/sessionService";

/** Lists only the calling browser session's reservations; no session cookie means an empty list. */
export const GET = handler(async () => {
  const session = await driverSession(false);
  if (!session) return NextResponse.json({ reservations: [] });
  const { deps } = await getRuntime();
  return NextResponse.json({ reservations: await listSessionReservations(deps, session) });
});
