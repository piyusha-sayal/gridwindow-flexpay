import { NextResponse } from "next/server";
import { ServiceError } from "@/server/deps";
import { driverSession } from "@/server/http";
import { getRuntime } from "@/server/runtime";
import { handleCheckoutCancel } from "@/server/services/checkoutService";

export async function GET(req: Request): Promise<Response> {
  const { deps } = await getRuntime();
  const url = new URL(req.url);
  const rid = url.searchParams.get("rid") ?? "";
  try {
    const session = await driverSession(false);
    if (!session) throw new ServiceError("CHECKOUT_STATE_INVALID", "Checkout session could not be verified.", 403);
    await handleCheckoutCancel(deps, session, rid, url.searchParams.get("state") ?? "");
    return NextResponse.redirect(new URL(`/reservations/${encodeURIComponent(rid)}`, deps.baseUrl), 303);
  } catch (err) {
    const code = err instanceof ServiceError ? err.code : "INTERNAL";
    return NextResponse.redirect(new URL(`/drive?error=${encodeURIComponent(code)}`, deps.baseUrl), 303);
  }
}
