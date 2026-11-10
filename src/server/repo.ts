/** Data access helpers. All writes that change payment state are conditional (compare-and-set). */
import { assertTransition, type PaymentState, type ProofType, type ServiceState } from "@/domain/paymentState";
import type { SessionPlan } from "@/domain/station";
import type { OfferTerms } from "@/domain/terms";
import type { ProviderMode } from "@/payments/gateway";
import { createHash } from "node:crypto";
import type { DisturbanceRecord, DisturbanceType } from "@/domain/disturbance";
import type { Db, Queryable } from "./db/client";

export interface ReservationRow {
  id: string;
  quote_set_id: string;
  offer_id: string;
  driver_session: string;
  station_id: string;
  night_of: string;
  port_id: string;
  amount_cents: number;
  currency: "USD";
  terms_hash: string;
  terms: OfferTerms;
  payment_state: PaymentState;
  service_state: ServiceState;
  slots_committed: boolean;
  provider_mode: ProviderMode;
  approve_url: string | null;
  checkout_state_hash: string;
  paypal_order_id: string | null;
  paypal_authorization_id: string | null;
  paypal_capture_id: string | null;
  authorization_expires_at: Date | null;
  authorized_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type EventSource =
  | "APP"
  | "DRIVER"
  | "OPERATOR"
  | "SYNTHETIC_SIMULATOR"
  | "PAYPAL_SANDBOX_API"
  | "PAYPAL_WEBHOOK"
  | "MOCK_PROVIDER"
  | "RECONCILER";

export function providerSource(mode: ProviderMode): EventSource {
  return mode === "PAYPAL_SANDBOX" ? "PAYPAL_SANDBOX_API" : "MOCK_PROVIDER";
}

export async function getReservation(q: Queryable, id: string): Promise<ReservationRow | null> {
  const rows = await q.query<ReservationRow>("select * from reservations where id = $1", [id]);
  return rows[0] ?? null;
}

/** Row-locked read for a read-modify-write inside a transaction (held until that transaction ends). */
export async function getReservationForUpdate(q: Queryable, id: string): Promise<ReservationRow | null> {
  const rows = await q.query<ReservationRow>("select * from reservations where id = $1 for update", [id]);
  return rows[0] ?? null;
}

export async function getReservationByOffer(q: Queryable, offerId: string): Promise<ReservationRow | null> {
  const rows = await q.query<ReservationRow>("select * from reservations where offer_id = $1", [offerId]);
  return rows[0] ?? null;
}

/** A session's plan. `powerW` is the effective (latest committed) schedule; it defaults to the agreed terms. */
export function planOf(r: Pick<ReservationRow, "id" | "port_id" | "terms">, powerW: readonly number[] = r.terms.powerW): SessionPlan {
  return { sessionId: r.id, portId: r.port_id, plugInMs: r.terms.plugInMs, departMs: r.terms.departMs, powerW };
}

/** Latest committed schedule per reservation on a night (reservations without a recovery are absent). */
export async function latestSchedulesOf(q: Queryable, stationId: string, nightOf: string): Promise<Map<string, number[]>> {
  const rows = await q.query<{ reservation_id: string; power_w: number[] }>(
    `select distinct on (v.reservation_id) v.reservation_id, v.power_w from schedule_versions v
     join reservations r on r.id = v.reservation_id where r.station_id = $1 and r.night_of = $2
     order by v.reservation_id, v.version desc`,
    [stationId, nightOf],
  );
  return new Map(rows.map((row) => [row.reservation_id, row.power_w]));
}

/** Effective per-slot plan of one reservation: its latest schedule version, or the agreed terms if none. */
export async function effectivePowerOf(q: Queryable, r: Pick<ReservationRow, "id" | "terms">): Promise<number[]> {
  const rows = await q.query<{ power_w: number[] }>("select power_w from schedule_versions where reservation_id = $1 order by version desc limit 1", [r.id]);
  return rows[0]?.power_w ?? r.terms.powerW;
}

/** Sessions currently holding station capacity (and port occupancy) for a night, at their effective plans. */
export async function committedPlans(q: Queryable, stationId: string, nightOf: string, excludeId?: string): Promise<SessionPlan[]> {
  const rows = await q.query<ReservationRow>(
    "select id, port_id, terms from reservations where station_id = $1 and night_of = $2 and slots_committed = true and ($3::text is null or id <> $3) order by created_at, id",
    [stationId, nightOf, excludeId ?? null],
  );
  const latest = await latestSchedulesOf(q, stationId, nightOf);
  return rows.map((r) => planOf(r, latest.get(r.id) ?? r.terms.powerW));
}

export async function appendEvent(q: Queryable, reservationId: string | null, type: string, source: EventSource, payload: Record<string, unknown> = {}): Promise<void> {
  await q.query("insert into events (reservation_id, type, source, payload) values ($1, $2, $3, $4)", [reservationId, type, source, JSON.stringify(payload)]);
}

/** Appends unless an event with the same type and payload already exists for the reservation (serialized on its row lock). */
export async function appendEventOnce(db: Db, reservationId: string, type: string, source: EventSource, payload: Record<string, unknown>): Promise<void> {
  await db.tx(async (q) => {
    await getReservationForUpdate(q, reservationId);
    const seen = await q.query("select 1 from events where reservation_id = $1 and type = $2 and payload = $3::jsonb limit 1", [reservationId, type, JSON.stringify(payload)]);
    if (seen.length === 0) await appendEvent(q, reservationId, type, source, payload);
  });
}

export async function recordProof(
  q: Queryable,
  reservationId: string,
  proofType: ProofType,
  mode: ProviderMode,
  providerRef: string,
  providerStatus: string,
  amountCents: number | null,
): Promise<void> {
  await q.query(
    `insert into provider_proofs (reservation_id, proof_type, provider_mode, provider_ref, provider_status, amount_cents, evidence_source)
     values ($1, $2, $3, $4, $5, $6, $7) on conflict (reservation_id, proof_type) do nothing`,
    [reservationId, proofType, mode, providerRef, providerStatus, amountCents, mode === "PAYPAL_SANDBOX" ? "PAYPAL_SANDBOX_API" : "MOCK_PROVIDER"],
  );
}

type ReservationPatch = Partial<
  Pick<
    ReservationRow,
    "service_state" | "slots_committed" | "paypal_order_id" | "paypal_authorization_id" | "paypal_capture_id" | "approve_url" | "authorization_expires_at" | "authorized_at"
  >
>;

/**
 * Compare-and-set payment transition. Returns false (no write) if the row is no longer
 * in `from`, which makes concurrent/duplicate requests harmless.
 */
export async function transitionPayment(q: Queryable, id: string, from: PaymentState, to: PaymentState, patch: ReservationPatch = {}): Promise<boolean> {
  assertTransition(from, to);
  const entries = Object.entries(patch);
  const sets = entries.map(([k], i) => `${k} = $${i + 4}`);
  const rows = await q.query<{ id: string }>(
    `update reservations set payment_state = $3, updated_at = now()${sets.length ? ", " + sets.join(", ") : ""} where id = $1 and payment_state = $2 returning id`,
    [id, from, to, ...entries.map(([, v]) => (v instanceof Date ? v.toISOString() : v))],
  );
  return rows.length === 1;
}

export async function patchReservation(q: Queryable, id: string, patch: ReservationPatch): Promise<void> {
  const entries = Object.entries(patch);
  if (entries.length === 0) return;
  await q.query(`update reservations set ${entries.map(([k], i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() where id = $1`, [
    id,
    ...entries.map(([, v]) => (v instanceof Date ? v.toISOString() : v)),
  ]);
}

export type OperationKind = "CREATE_ORDER" | "AUTHORIZE" | "CAPTURE" | "VOID";
export type OperationStatus = "STARTED" | "SUCCEEDED" | "FAILED" | "AMBIGUOUS";

export interface OperationRow {
  idempotency_key: string;
  kind: OperationKind;
  status: OperationStatus;
  provider_ref: string | null;
  attempts: number;
  request: unknown;
  terms_hash: string | null;
  amount_cents: number | null;
}

/** Binds an operation to the accepted offer and stores the exact provider input before any call. */
export interface OperationBinding {
  termsHash: string;
  amountCents: number;
  request?: unknown;
}

const OP_COLUMNS = "idempotency_key, kind, status, provider_ref, attempts, request, terms_hash, amount_cents";

/** Upper bound on one provider call (gateway timeout is 15 s) before another worker may retry. */
export const OPERATION_LEASE_MS = 60_000;

/**
 * Claims a payment operation. `fresh=false` means an earlier attempt exists; callers must
 * reuse its idempotency key (PayPal-Request-Id) rather than create a new financial request.
 */
export async function claimOperation(q: Queryable, reservationId: string, kind: OperationKind, binding?: OperationBinding): Promise<{ fresh: boolean; op: OperationRow }> {
  const key = `${reservationId}:${kind}`;
  const inserted = await q.query<OperationRow>(
    `insert into payment_operations (reservation_id, kind, idempotency_key, status, terms_hash, amount_cents, request) values ($1, $2, $3, 'STARTED', $4, $5, $6)
     on conflict do nothing returning ${OP_COLUMNS}`,
    [reservationId, kind, key, binding?.termsHash ?? null, binding?.amountCents ?? null, binding?.request === undefined ? null : JSON.stringify(binding.request)],
  );
  if (inserted[0]) return { fresh: true, op: inserted[0] };
  const existing = await q.query<OperationRow>(`select ${OP_COLUMNS} from payment_operations where reservation_id = $1 and kind = $2`, [reservationId, kind]);
  if (!existing[0]) {
    // Conflict came from the one-settlement index: the other settlement kind already exists.
    throw new SettlementConflictError(reservationId, kind);
  }
  return { fresh: false, op: existing[0] };
}

export class SettlementConflictError extends Error {
  constructor(reservationId: string, kind: OperationKind) {
    super(`reservation ${reservationId} already has a different settlement operation; refusing ${kind}`);
    this.name = "SettlementConflictError";
  }
}

/**
 * Takes the operation's lease if no other worker holds an unexpired one. Exactly one concurrent
 * caller wins; losers must not call the provider (PayPal may reject or race a same-key request).
 */
export async function leaseOperation(q: Queryable, key: string, nowMs: number, leaseMs = OPERATION_LEASE_MS): Promise<OperationRow | null> {
  const rows = await q.query<OperationRow>(
    `update payment_operations set lease_until = $2, attempts = attempts + 1
     where idempotency_key = $1 and (lease_until is null or lease_until <= $3) returning ${OP_COLUMNS}`,
    [key, new Date(nowMs + leaseMs).toISOString(), new Date(nowMs).toISOString()],
  );
  return rows[0] ?? null;
}

/** Records an attempt's outcome and releases the lease. A SUCCEEDED operation is never downgraded. */
export async function finishOperation(q: Queryable, key: string, status: Exclude<OperationStatus, "STARTED">, providerRef: string | null, errorCode: string | null = null): Promise<void> {
  await q.query(
    `update payment_operations set status = case when status = 'SUCCEEDED' then status else $2 end, provider_ref = coalesce($3, provider_ref),
       error_code = case when status = 'SUCCEEDED' then error_code else $4 end, completed_at = now(), lease_until = null
     where idempotency_key = $1`,
    [key, status, providerRef, errorCode],
  );
}

/** Recorded disturbances for one station-night, in the order the envelope applies them. */
export interface NightDisturbances {
  eventIds: string[];
  records: DisturbanceRecord[];
}

export async function nightDisturbances(q: Queryable, stationId: string, nightOf: string): Promise<NightDisturbances> {
  const rows = await q.query<{ event_id: string; reservation_id: string; port_id: string; type: DisturbanceType; params: Record<string, number>; effective_slot: number }>(
    `select d.event_id, d.reservation_id, r.port_id, d.type, d.params, d.effective_slot from disruption_events d
     join reservations r on r.id = d.reservation_id where r.station_id = $1 and r.night_of = $2 order by d.created_at, d.event_id`,
    [stationId, nightOf],
  );
  return {
    eventIds: rows.map((row) => row.event_id),
    records: rows.map((row) => ({ reservationId: row.reservation_id, portId: row.port_id, type: row.type, effectiveSlot: row.effective_slot, params: row.params })),
  };
}

/** Identity of the disturbance set a quote was priced against. Equal digests mean the same station snapshot. */
export function digestOfEventIds(eventIds: readonly string[]): string {
  return createHash("sha256").update([...eventIds].sort().join(",")).digest("hex");
}
