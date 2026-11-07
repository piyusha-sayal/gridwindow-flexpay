/**
 * MOCK provider for local development and tests. It is NOT PayPal: every object it
 * creates is prefixed "MOCK-", proofs are stored with evidence_source MOCK_PROVIDER,
 * and the UI labels the mode. It never reports PayPal-verified status.
 */
import { randomUUID } from "node:crypto";
import type { Queryable } from "@/server/db/client";
import {
  ProviderError,
  type CreateOrderInput,
  type PaymentGateway,
  type ProviderAuthorization,
  type ProviderCapture,
  type ProviderOrder,
} from "./gateway";

interface MockOrder {
  orderId: string;
  status: "PAYER_ACTION_REQUIRED" | "APPROVED" | "COMPLETED" | "VOIDED";
  amountCents: number;
  customId: string;
  returnUrl: string;
  cancelUrl: string;
  authorizationId: string | null;
}

interface MockAuth {
  authorizationId: string;
  status: "CREATED" | "CAPTURED" | "VOIDED";
  amountCents: number;
  expirationTime: string;
  captureId: string | null;
}

/**
 * Structural check: `instanceof` is unreliable because the runtime singleton can be created
 * by a different server bundle than the one asking.
 */
/** Provider-side capture outcomes the operator can script in MOCK mode (exercises async settlement). */
export type MockCaptureOutcome = "PENDING" | "DECLINED";

export function isMockGateway(g: PaymentGateway): g is MockGateway {
  return g.mode === "MOCK" && typeof (g as Partial<MockGateway>).approve === "function" && typeof (g as Partial<MockGateway>).peek === "function";
}

export class MockGateway implements PaymentGateway {
  readonly mode = "MOCK" as const;

  constructor(
    private readonly db: Queryable,
    private readonly basePath = "",
  ) {}

  private async load<T>(id: string, kind: string): Promise<T> {
    const rows = await this.db.query<{ data: T }>("select data from mock_provider_objects where id = $1 and kind = $2", [id, kind]);
    if (!rows[0]) throw new ProviderError("HTTP_4XX", `mock ${kind} ${id} not found`, 404, undefined, "RESOURCE_NOT_FOUND");
    return rows[0].data;
  }

  private async save(id: string, kind: string, data: unknown): Promise<void> {
    await this.db.query(
      "insert into mock_provider_objects (id, kind, data) values ($1, $2, $3) on conflict (id) do update set data = excluded.data, updated_at = now()",
      [id, kind, JSON.stringify(data)],
    );
  }

  /** Idempotency: same request id returns the object created by the first call. */
  private async byRequestId(requestId: string): Promise<string | null> {
    const rows = await this.db.query<{ data: { ref: string } }>("select data from mock_provider_objects where id = $1", [`req:${requestId}`]);
    return rows[0]?.data.ref ?? null;
  }

  private toOrder(o: MockOrder, auth: MockAuth | null): ProviderOrder {
    return {
      orderId: o.orderId,
      status: o.status,
      amountCents: o.amountCents,
      currency: "USD",
      customId: o.customId,
      approveUrl: `${this.basePath}/mock-checkout?token=${encodeURIComponent(o.orderId)}`,
      authorizations: auth ? [this.toAuth(auth)] : [],
    };
  }

  private toAuth(a: MockAuth): ProviderAuthorization {
    return { authorizationId: a.authorizationId, status: a.status, amountCents: a.amountCents, currency: "USD", expirationTime: a.expirationTime };
  }

  async createOrder(input: CreateOrderInput): Promise<ProviderOrder> {
    const existing = await this.byRequestId(input.requestId);
    if (existing) return this.getOrder(existing);
    const order: MockOrder = {
      orderId: `MOCK-ORDER-${randomUUID()}`,
      status: "PAYER_ACTION_REQUIRED",
      amountCents: input.amountCents,
      customId: input.reservationId,
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
      authorizationId: null,
    };
    await this.save(order.orderId, "order", order);
    await this.save(`req:${input.requestId}`, "request", { ref: order.orderId });
    return this.toOrder(order, null);
  }

  /** Reads the mock order including its return/cancel URLs (mock approval page only). */
  async peek(orderId: string): Promise<MockOrder> {
    return this.load<MockOrder>(orderId, "order");
  }

  /** Simulates the buyer clicking approve on the (mock) hosted page. */
  async approve(orderId: string): Promise<MockOrder> {
    const order = await this.load<MockOrder>(orderId, "order");
    if (order.status !== "PAYER_ACTION_REQUIRED") return order;
    const approved: MockOrder = { ...order, status: "APPROVED" };
    await this.save(orderId, "order", approved);
    return approved;
  }

  async getOrder(orderId: string): Promise<ProviderOrder> {
    const order = await this.load<MockOrder>(orderId, "order");
    const auth = order.authorizationId ? await this.load<MockAuth>(order.authorizationId, "authorization") : null;
    return this.toOrder(order, auth);
  }

  async authorizeOrder(orderId: string, requestId: string): Promise<ProviderAuthorization> {
    const existing = await this.byRequestId(requestId);
    if (existing) return this.getAuthorization(existing);
    const order = await this.load<MockOrder>(orderId, "order");
    if (order.status !== "APPROVED") throw new ProviderError("HTTP_4XX", "order not approved", 422, undefined, "ORDER_NOT_APPROVED");
    const auth: MockAuth = {
      authorizationId: `MOCK-AUTH-${randomUUID()}`,
      status: "CREATED",
      amountCents: order.amountCents,
      expirationTime: new Date(Date.now() + 29 * 86_400_000).toISOString(),
      captureId: null,
    };
    await this.save(auth.authorizationId, "authorization", auth);
    await this.save(orderId, "order", { ...order, status: "COMPLETED", authorizationId: auth.authorizationId });
    await this.save(`req:${requestId}`, "request", { ref: auth.authorizationId });
    return this.toAuth(auth);
  }

  async getAuthorization(authorizationId: string): Promise<ProviderAuthorization> {
    return this.toAuth(await this.load<MockAuth>(authorizationId, "authorization"));
  }

  async captureAuthorization(authorizationId: string, amountCents: number, _invoiceId: string, requestId: string): Promise<ProviderCapture> {
    const existing = await this.byRequestId(requestId);
    if (existing) return this.getCapture(existing);
    const auth = await this.load<MockAuth>(authorizationId, "authorization");
    if (auth.status !== "CREATED") throw new ProviderError("HTTP_4XX", `authorization is ${auth.status}`, 422, undefined, "AUTHORIZATION_ALREADY_FINALIZED");
    if (amountCents > auth.amountCents) throw new ProviderError("HTTP_4XX", "capture exceeds authorization", 422, undefined, "AMOUNT_EXCEEDED");
    const scripted = await this.db.query<{ data: { status: MockCaptureOutcome } }>("select data from mock_provider_objects where id = $1", [`capture-outcome:${authorizationId}`]);
    const status = scripted[0]?.data.status ?? "COMPLETED";
    const capture: ProviderCapture = { captureId: `MOCK-CAPTURE-${randomUUID()}`, status, amountCents, currency: "USD", authorizationId };
    await this.save(capture.captureId, "capture", capture);
    await this.save(authorizationId, "authorization", { ...auth, status: "CAPTURED", captureId: capture.captureId });
    await this.save(`req:${requestId}`, "request", { ref: capture.captureId });
    return capture;
  }

  async getCapture(captureId: string): Promise<ProviderCapture> {
    return this.load<ProviderCapture>(captureId, "capture");
  }

  /** Scripts the provider's answer to the next capture of this authorization (MOCK only). */
  async scriptCaptureOutcome(authorizationId: string, status: MockCaptureOutcome): Promise<void> {
    await this.load<MockAuth>(authorizationId, "authorization");
    await this.save(`capture-outcome:${authorizationId}`, "script", { status });
  }

  /** Simulates the provider finishing a PENDING capture later (MOCK only; PayPal would send a webhook). */
  async resolvePendingCapture(captureId: string, status: "COMPLETED" | "DECLINED"): Promise<ProviderCapture> {
    const capture = await this.load<ProviderCapture>(captureId, "capture");
    if (capture.status !== "PENDING") throw new ProviderError("HTTP_4XX", `capture is ${capture.status}`, 422, undefined, "CAPTURE_NOT_PENDING");
    const resolved: ProviderCapture = { ...capture, status };
    await this.save(captureId, "capture", resolved);
    return resolved;
  }

  async voidAuthorization(authorizationId: string, requestId: string): Promise<void> {
    if (await this.byRequestId(requestId)) return;
    const auth = await this.load<MockAuth>(authorizationId, "authorization");
    if (auth.status !== "CREATED") throw new ProviderError("HTTP_4XX", `authorization is ${auth.status}`, 422, undefined, "AUTHORIZATION_ALREADY_FINALIZED");
    await this.save(authorizationId, "authorization", { ...auth, status: "VOIDED" });
    await this.save(`req:${requestId}`, "request", { ref: authorizationId });
  }

  async verifyWebhook(): Promise<boolean> {
    // The mock provider never sends webhooks; any webhook in mock mode is rejected.
    return false;
  }
}
