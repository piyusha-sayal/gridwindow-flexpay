import { NextResponse } from "next/server";
import { handler, rateLimit } from "@/server/http";
import { getRuntime } from "@/server/runtime";
import { handlePayPalWebhook, MAX_WEBHOOK_BYTES } from "@/server/services/webhookService";

const HEADER_NAMES = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];

/** Raw body is read as text and passed unaltered to signature verification. */
export const POST = handler(async (req: Request) => {
  rateLimit(req, "webhook", 120);
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_WEBHOOK_BYTES) return NextResponse.json({ result: "INVALID" }, { status: 413 });
  const raw = await req.text();
  const headers = Object.fromEntries(HEADER_NAMES.map((h) => [h, req.headers.get(h)]));
  const { deps } = await getRuntime();
  const outcome = await handlePayPalWebhook(deps, headers, raw);
  return NextResponse.json({ result: outcome.result }, { status: outcome.status });
});
