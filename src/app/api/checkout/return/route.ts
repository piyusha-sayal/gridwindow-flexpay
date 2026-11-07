import { NextResponse } from "next/server";
import { ServiceError } from "@/server/deps";
import { driverSession, rateLimit } from "@/server/http";
import { getRuntime } from "@/server/runtime";
import { handleCheckoutReturn } from "@/server/services/checkoutService";

/** Provider redirect target after buyer approval. Verified by state token + session + order id. */
export async function GET(req: Request): Promise<Response> {
  const { deps } = await getRuntime();
  const url = new URL(req.url);
  const rid = url.searchParams.get("rid") ?? "";
  try {
    rateLimit(req, "return", 20);
    const session = await driverSession(false);
    if (!session) throw new ServiceError("CHECKOUT_STATE_INVALID", "Checkout session could not be verified.", 403);
    await handleCheckoutReturn(deps, session, rid, url.searchParams.get("state") ?? "", url.searchParams.get("token") ?? "");
    return NextResponse.redirect(new URL(`/reservations/${encodeURIComponent(rid)}`, deps.baseUrl), 303);
  } catch (err) {
    const code = err instanceof ServiceError ? err.code : "INTERNAL";
    if (!(err instanceof ServiceError)) console.error("[gridwindow] checkout return failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.redirect(new URL(`/drive?error=${encodeURIComponent(code)}`, deps.baseUrl), 303);
  }
}
