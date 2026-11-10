/**
 * PayPal webhook intake: verify signature on the exact raw body, de-duplicate by event id,
 * correlate to a reservation via IDs we already stored, then reconcile against the API.
 * Webhook payload content is never trusted as financial truth by itself.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { WebhookHeaders } from "@/payments/gateway";
import type { AppDeps } from "../deps";
import { appendEvent } from "../repo";
import { recoverReservation } from "./recoveryService";

export const MAX_WEBHOOK_BYTES = 64 * 1024;

const eventSchema = z.object({
  id: z.string().min(1).max(128),
  event_type: z.string().min(1).max(128),
  resource: z
    .object({
      id: z.string().max(128).optional(),
      supplementary_data: z.object({ related_ids: z.record(z.string(), z.string()).optional() }).optional(),
    })
    .passthrough()
    .optional(),
});

export interface WebhookOutcome {
  status: number;
  result: "REJECTED" | "INVALID" | "DUPLICATE" | "UNCORRELATED" | "PROCESSED" | "RETRY_LATER";
}

export async function handlePayPalWebhook(deps: AppDeps, headers: WebhookHeaders, rawBody: string): Promise<WebhookOutcome> {
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) return { status: 413, result: "INVALID" };
  const verified = await deps.gateway.verifyWebhook(headers, rawBody);
  if (!verified) {
    // No DB write for unauthenticated input (append-only tables must not be attacker-growable),
    // and a forged event must not be able to "reserve" a real event id in the inbox.
    console.warn("[gridwindow] rejected unverified webhook", (headers["paypal-transmission-id"] ?? "").slice(0, 64));
    return { status: 401, result: "REJECTED" };
  }
  let parsed: z.infer<typeof eventSchema>;
  try {
    parsed = eventSchema.parse(JSON.parse(rawBody));
  } catch {
    return { status: 400, result: "INVALID" };
  }
  const resourceId = parsed.resource?.id ?? null;
  const related = Object.values(parsed.resource?.supplementary_data?.related_ids ?? {});
  const candidateIds = [resourceId, ...related].filter((x): x is string => typeof x === "string" && x.length > 0);
  const match = candidateIds.length
    ? await deps.db.query<{ id: string }>(
        "select id from reservations where paypal_order_id = any($1::text[]) or paypal_authorization_id = any($1::text[]) or paypal_capture_id = any($1::text[]) limit 1",
        [candidateIds],
      )
    : [];
  const rid = match[0]?.id ?? null;

  const inserted = await deps.db.query<{ event_id: string }>(
    "insert into webhook_inbox (event_id, event_type, resource_id, reservation_id, raw_sha256) values ($1,$2,$3,$4,$5) on conflict (event_id) do nothing returning event_id",
    [parsed.id, parsed.event_type, resourceId, rid, createHash("sha256").update(rawBody).digest("hex")],
  );
  const inbox = await deps.db.query<{ processed_at: Date | null }>("select processed_at from webhook_inbox where event_id = $1", [parsed.id]);
  // Only events we finished handling are duplicates; a retry of an unprocessed event is reprocessed.
  if (inbox[0]?.processed_at) return { status: 200, result: "DUPLICATE" };
  // Only the delivery that created the inbox row records verification, so concurrent duplicates do not multiply it.
  if (inserted.length > 0) await appendEvent(deps.db, rid, "WEBHOOK_VERIFIED", "PAYPAL_WEBHOOK", { eventId: parsed.id, eventType: parsed.event_type });
  if (rid) {
    const { providerReachable } = await recoverReservation(deps, rid, "PAYPAL_WEBHOOK");
    // 503 makes PayPal redeliver later; the inbox row stays unprocessed.
    if (!providerReachable) return { status: 503, result: "RETRY_LATER" };
  }
  await deps.db.query("update webhook_inbox set processed_at = now() where event_id = $1", [parsed.id]);
  if (!rid) return { status: 200, result: "UNCORRELATED" };
  return { status: 200, result: "PROCESSED" };
}
