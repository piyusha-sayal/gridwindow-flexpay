import { NextResponse } from "next/server";
import { z } from "zod";
import { isMockGateway } from "@/payments/mockGateway";
import { ServiceError } from "@/server/deps";
import { getReservation } from "@/server/repo";
import { assertSameOrigin, handler, rateLimit, readJson, requireOperator } from "@/server/http";
import { getRuntime } from "@/server/runtime";
import { runSimulation } from "@/server/services/settlementService";
import { reservationView } from "@/server/services/viewService";

const schema = z
  .object({
    outage: z
      .object({ fromSlot: z.number().int().min(0).max(200), toSlot: z.number().int().min(1).max(200) })
      .refine((o) => o.toSlot > o.fromSlot, "toSlot must be after fromSlot")
      .optional(),
    /** MOCK only: script the provider's capture answer to exercise pending/declined settlement. */
    mockCaptureOutcome: z.enum(["PENDING", "DECLINED"]).optional(),
  })
  .strict();

/** Operator-only: run the synthetic night, optionally injecting a charger outage. */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await assertSameOrigin(req);
  await requireOperator();
  rateLimit(req, "operator-simulate", 20);
  const { id } = await ctx.params;
  const { outage, mockCaptureOutcome } = schema.parse(await readJson(req));
  const { deps } = await getRuntime();
  if (mockCaptureOutcome) {
    if (!isMockGateway(deps.gateway)) throw new ServiceError("MOCK_ONLY", "Scripted capture outcomes exist only in MOCK mode.", 409);
    const r = await getReservation(deps.db, id);
    if (!r?.paypal_authorization_id) throw new ServiceError("NOT_READY", "Reservation has no authorization yet.", 409);
    await deps.gateway.scriptCaptureOutcome(r.paypal_authorization_id, mockCaptureOutcome);
  }
  await runSimulation(deps, id, { kind: "OPERATOR" }, outage ? { outage } : {});
  return NextResponse.json({ reservation: await reservationView(deps, id, { operator: true }) });
});
