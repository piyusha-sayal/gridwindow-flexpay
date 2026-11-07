/**
 * The PayPal Sandbox smoke flow, separated from the CLI so it can be tested against a fake
 * transport. One $1.23 AUTHORIZE order per flow (default both): one captured, one voided. Every write is sent
 * once with a fixed PayPal-Request-Id and never retried; every result is re-read from PayPal and
 * checked. Any mismatch or provider error stops the run immediately.
 */
import type { PaymentGateway, ProviderOrder } from "../src/payments/gateway";

export const SMOKE_AMOUNT_CENTS = 123;
export const SMOKE_FLOWS = ["capture", "void"] as const;
export type SmokeFlow = (typeof SMOKE_FLOWS)[number];

export class SmokeCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmokeCheckError";
  }
}

/** Default buyer approval window; sandbox login and checkout can take a while. */
export const DEFAULT_APPROVAL_TIMEOUT_MS = 30 * 60_000;

export const redact = (id: string | null | undefined): string => (id && id.length > 8 ? `…${id.slice(-6)}` : "…");

export interface SmokeOptions {
  runId: string;
  /** Shows the official PayPal approval link to the human sandbox buyer. Never automates approval. */
  promptApproval: (flow: SmokeFlow, approveUrl: string) => void;
  log: (line: string) => void;
  /** Required: the run stops unless PayPal reports exactly this payee on the order. */
  expectedMerchantId: string;
  approvalTimeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Called after each provider response so an interrupted run can report and save what exists. */
  onReference?: (flow: SmokeFlow, kind: SmokeStepKind, id: string, status: string) => void;
}

export type SmokeStepKind = "order" | "authorization" | "capture" | "void";

export interface SmokeEvidence {
  flow: SmokeFlow;
  reservationRef: string;
  order: { id: string; status: string; amountCents: number | null; currency: string | null; merchant: string; createdAt: string };
  authorization: { id: string; status: string; amountCents: number; currency: string; expiresAt: string | null; at: string };
  capture?: { id: string; status: string; amountCents: number; currency: string; authorizationMatches: boolean; at: string };
  void?: { authorizationStatusAfter: string; at: string };
  operations: string[];
}

function check(ok: boolean, message: string): void {
  if (!ok) throw new SmokeCheckError(message);
}

/** Plausible PayPal account identifier: guards against an empty or mistyped expected merchant. */
export const MERCHANT_ID_FORMAT = /^[A-Z0-9]{10,20}$/;

/**
 * PayPal documents no call that names the merchant behind client credentials before an order
 * exists, so the payee PayPal reports on the order is the proof. It is checked before the buyer
 * is shown any link: a wrong-merchant order is never approved and therefore never authorized.
 */
function checkOrder(order: ProviderOrder, reservationRef: string, expectedMerchantId: string): void {
  check(order.amountCents === SMOKE_AMOUNT_CENTS && order.currency === "USD", `order amount/currency mismatch (${order.amountCents} ${order.currency})`);
  check(order.customId === null || order.customId === reservationRef, "order custom_id does not match the smoke reservation reference");
  check(!!order.payeeMerchantId, "PayPal did not report the order payee; merchant cannot be confirmed");
  check(order.payeeMerchantId === expectedMerchantId, "order payee is not the expected sandbox merchant");
}

/** Polls GET order (read-only, safe to repeat) until the buyer approves on PayPal's page. */
async function waitForApproval(gw: PaymentGateway, orderId: string, o: SmokeOptions): Promise<ProviderOrder> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const timeoutMs = o.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
  const deadline = now() + timeoutMs;
  let lookupFailures = 0;
  let nextReminder = now() + 60_000;
  while (now() < deadline) {
    try {
      const order = await gw.getOrder(orderId);
      lookupFailures = 0;
      if (order.status === "APPROVED") return order;
    } catch (err) {
      if (++lookupFailures >= 3) throw err; // lookups only; no payment operation is ever repeated
    }
    if (now() >= nextReminder) {
      o.log(`  …still waiting for approval of order ${orderId} (${Math.ceil((deadline - now()) / 60_000)} min left)`);
      nextReminder += 60_000;
    }
    await sleep(o.pollMs ?? 5_000);
  }
  throw new SmokeCheckError(
    `order ${orderId} was not approved within ${Math.round(timeoutMs / 60_000)} min; nothing further was sent for it. ` +
      `Approve it, then finish it with: npm run paypal:smoke -- --approve-sandbox-orders --resume-order ${orderId}`,
  );
}

/** Approval onward for an order that already exists: wait, re-check, authorize once, then capture or void once. */
async function completeFlow(gw: PaymentGateway, flow: SmokeFlow, ref: string, order: ProviderOrder, createdAt: string, o: SmokeOptions, operations: string[]): Promise<SmokeEvidence> {
  const iso = () => new Date((o.now ?? Date.now)()).toISOString();
  const approved = order.status === "APPROVED" ? order : await waitForApproval(gw, order.orderId, o);
  operations.push("GET /v2/checkout/orders/{id} (poll)");
  checkOrder(approved, ref, o.expectedMerchantId);

  const auth = await gw.authorizeOrder(order.orderId, `${ref}:AUTHORIZE`);
  operations.push("POST /v2/checkout/orders/{id}/authorize");
  o.onReference?.(flow, "authorization", auth.authorizationId, auth.status);
  check(auth.amountCents === SMOKE_AMOUNT_CENTS && auth.currency === "USD", "authorization amount/currency mismatch");
  check(auth.status === "CREATED", `authorization status is ${auth.status}, expected CREATED`);
  o.log(`[${flow}] authorization ${redact(auth.authorizationId)} status=${auth.status} expires=${auth.expirationTime ?? "-"}`);

  const evidence: SmokeEvidence = {
    flow,
    reservationRef: ref,
    order: { id: redact(order.orderId), status: approved.status, amountCents: approved.amountCents, currency: approved.currency, merchant: redact(approved.payeeMerchantId), createdAt },
    authorization: { id: redact(auth.authorizationId), status: auth.status, amountCents: auth.amountCents, currency: auth.currency, expiresAt: auth.expirationTime, at: iso() },
    operations,
  };

  if (flow === "capture") {
    const created = await gw.captureAuthorization(auth.authorizationId, SMOKE_AMOUNT_CENTS, ref, `${ref}:CAPTURE`);
    operations.push("POST /v2/payments/authorizations/{id}/capture");
    o.onReference?.(flow, "capture", created.captureId, created.status);
    const cap = await gw.getCapture(created.captureId);
    operations.push("GET /v2/payments/captures/{id}");
    const authorizationMatches = cap.authorizationId === null || cap.authorizationId === auth.authorizationId;
    evidence.capture = { id: redact(cap.captureId), status: cap.status, amountCents: cap.amountCents, currency: cap.currency, authorizationMatches, at: iso() };
    o.log(`[capture] capture ${redact(cap.captureId)} provider status=${cap.status} amount=${cap.amountCents}c ${cap.currency}`);
    check(cap.amountCents === SMOKE_AMOUNT_CENTS && cap.currency === "USD" && authorizationMatches, "capture amount/currency/authorization mismatch");
    check(cap.status === "COMPLETED", `capture status is ${cap.status}, not COMPLETED (not treated as paid)`);
  } else {
    await gw.voidAuthorization(auth.authorizationId, `${ref}:VOID`);
    operations.push("POST /v2/payments/authorizations/{id}/void");
    const after = await gw.getAuthorization(auth.authorizationId);
    operations.push("GET /v2/payments/authorizations/{id}");
    o.onReference?.(flow, "void", after.authorizationId, after.status);
    evidence.void = { authorizationStatusAfter: after.status, at: iso() };
    o.log(`[void] authorization ${redact(after.authorizationId)} provider status=${after.status}`);
    check(after.status === "VOIDED", `authorization status after void is ${after.status}, not VOIDED`);
  }
  return evidence;
}

async function runFlow(gw: PaymentGateway, flow: SmokeFlow, o: SmokeOptions): Promise<SmokeEvidence> {
  const ref = `${o.runId}_${flow}`;
  const order = await gw.createOrder({
    reservationId: ref,
    amountCents: SMOKE_AMOUNT_CENTS,
    description: `GridWindow sandbox smoke (${flow})`,
    returnUrl: "https://example.com/return",
    cancelUrl: "https://example.com/cancel",
    requestId: `${ref}:CREATE_ORDER`,
  });
  o.onReference?.(flow, "order", order.orderId, order.status);
  checkOrder(order, ref, o.expectedMerchantId);
  check(!!order.approveUrl, "order has no PayPal approval link");
  // The full order ID is printed so an unfinished order can be resumed instead of creating another.
  o.log(`[${flow}] order ${order.orderId} status=${order.status} amount=${order.amountCents}c ${order.currency}`);
  o.promptApproval(flow, order.approveUrl!);
  return completeFlow(gw, flow, ref, order, new Date((o.now ?? Date.now)()).toISOString(), o, ["POST /v2/checkout/orders"]);
}

/** What a read-only GET says about an order. No field identifies the buyer. */
export interface OrderReport {
  status: string;
  smokeRef: string | null;
  flow: SmokeFlow | null;
  payeeMatches: boolean;
  merchant: string;
  amountCents: number | null;
  currency: string | null;
  amountOk: boolean;
  buyerApproved: boolean;
  authorizations: { id: string; status: string }[];
  captured: boolean;
  approvalLinkAvailable: boolean;
}

const SMOKE_REF = /^smoke_\d+_(capture|void)$/;
/** Order statuses that mean the buyer has already approved. */
const APPROVED_OR_LATER = new Set(["APPROVED", "COMPLETED"]);

/** GET-only inspection of an existing order; sends no payment write. */
export async function inspectOrder(gw: PaymentGateway, orderId: string, expectedMerchantId: string): Promise<OrderReport> {
  const order = await gw.getOrder(orderId);
  const match = order.customId ? SMOKE_REF.exec(order.customId) : null;
  return {
    status: order.status,
    smokeRef: match ? order.customId : null,
    flow: match ? (match[1] as SmokeFlow) : null,
    payeeMatches: !!order.payeeMerchantId && order.payeeMerchantId === expectedMerchantId,
    merchant: redact(order.payeeMerchantId),
    amountCents: order.amountCents,
    currency: order.currency,
    amountOk: order.amountCents === SMOKE_AMOUNT_CENTS && order.currency === "USD",
    buyerApproved: APPROVED_OR_LATER.has(order.status),
    authorizations: order.authorizations.map((a) => ({ id: redact(a.authorizationId), status: a.status })),
    captured: order.authorizations.some((a) => a.status === "CAPTURED" || a.status === "PARTIALLY_CAPTURED"),
    approvalLinkAvailable: !!order.approveUrl && !APPROVED_OR_LATER.has(order.status),
  };
}

/**
 * Finishes one existing smoke order from an earlier, interrupted run instead of creating a new
 * one. Reuses that run's reference, so the authorize/capture/void request IDs are the ones it would
 * have sent. Refuses orders this script did not create, and orders that already have an
 * authorization (those need a human decision, not an automatic settle).
 */
export async function resumeSmokeOrder(gw: PaymentGateway, orderId: string, o: SmokeOptions): Promise<SmokeEvidence> {
  check(gw.mode === "PAYPAL_SANDBOX", "smoke test requires the PayPal Sandbox gateway");
  check(MERCHANT_ID_FORMAT.test(o.expectedMerchantId), "PAYPAL_EXPECTED_MERCHANT_ID is missing or not a PayPal account identifier");
  const order = await gw.getOrder(orderId);
  const match = order.customId ? SMOKE_REF.exec(order.customId) : null;
  check(!!match, "order was not created by this smoke script; refusing to resume it");
  const ref = order.customId!;
  const flow = match![1] as SmokeFlow;
  checkOrder(order, ref, o.expectedMerchantId);
  check(order.authorizations.length === 0, "order already has an authorization; settle it manually, not by resuming");
  check(order.status === "APPROVED" || !!order.approveUrl, `order status is ${order.status} and no approval link is available; it cannot be resumed`);
  o.log(`[${flow}] resuming order ${order.orderId} status=${order.status} (no new order is created)`);
  if (order.status !== "APPROVED") o.promptApproval(flow, order.approveUrl!);
  return completeFlow(gw, flow, ref, order, "(created by an earlier run)", o, ["GET /v2/checkout/orders/{id} (resume)"]);
}

/** Runs the given flows (default: both) in order and stops at the first failure; one order per flow. */
export async function runSmokeFlow(gw: PaymentGateway, o: SmokeOptions, flows: readonly SmokeFlow[] = SMOKE_FLOWS): Promise<SmokeEvidence[]> {
  check(gw.mode === "PAYPAL_SANDBOX", "smoke test requires the PayPal Sandbox gateway");
  check(MERCHANT_ID_FORMAT.test(o.expectedMerchantId), "PAYPAL_EXPECTED_MERCHANT_ID is missing or not a PayPal account identifier");
  const evidence: SmokeEvidence[] = [];
  check(flows.length > 0 && new Set(flows).size === flows.length, "smoke flows must be distinct and non-empty");
  for (const flow of flows) evidence.push(await runFlow(gw, flow, o));
  return evidence;
}

const SINGLE_FLOW_FLAGS: Record<string, SmokeFlow> = { "--capture-only": "capture", "--void-only": "void" };

/** Flows a run creates orders for: one per single-flow flag (at most one), none of those when resuming. */
export function selectSmokeFlows(argv: readonly string[], resuming: boolean): readonly SmokeFlow[] {
  const chosen = Object.keys(SINGLE_FLOW_FLAGS).filter((f) => argv.includes(f));
  if (chosen.length > 1) throw new Error(`choose only one of ${chosen.join(" / ")}`);
  const flag = chosen[0];
  if (flag && resuming) throw new Error(`${flag} creates a new order; it cannot be combined with --resume-order`);
  return flag ? [SINGLE_FLOW_FLAGS[flag]!] : SMOKE_FLOWS;
}
