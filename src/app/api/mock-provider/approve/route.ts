import { NextResponse } from "next/server";
import { z } from "zod";
import { isMockGateway } from "@/payments/mockGateway";
import { ServiceError } from "@/server/deps";
import { assertSameOrigin, handler, rateLimit } from "@/server/http";
import { getRuntime } from "@/server/runtime";

const schema = z.object({ token: z.string().regex(/^MOCK-ORDER-[0-9a-f-]{36}$/), decision: z.enum(["approve", "cancel"]) });

/** MOCK provider only: simulates the buyer's decision on a hosted approval page. Disabled in PayPal mode. */
export const POST = handler(async (req: Request) => {
  await assertSameOrigin(req);
  rateLimit(req, "mock-approve", 20);
  const { deps } = await getRuntime();
  if (!isMockGateway(deps.gateway)) throw new ServiceError("NOT_FOUND", "Not available.", 404);
  const form = await req.formData();
  const { token, decision } = schema.parse({ token: form.get("token"), decision: form.get("decision") });
  const order = decision === "approve" ? await deps.gateway.approve(token) : await deps.gateway.peek(token);
  const target = new URL(decision === "approve" ? order.returnUrl : order.cancelUrl);
  target.searchParams.set("token", token);
  return NextResponse.redirect(target, 303);
});
