/**
 * The sandbox smoke flow against a fake PayPal transport (no network): exactly two $1.23 orders,
 * one capture, one void, no retried writes, and an immediate stop on any mismatch.
 */
import { describe, expect, it } from "vitest";
import { PAYPAL_SANDBOX_API, PayPalSandboxGateway } from "@/payments/paypalSandbox";
import { inspectOrder, resumeSmokeOrder, runSmokeFlow, selectSmokeFlows, SmokeCheckError, type SmokeOptions } from "../../scripts/paypalSmokeFlow";

interface FakePayPal {
  captureStatus?: string;
  payee?: string | null;
  approveHost?: string;
  approve?: boolean;
  failCreate?: number;
  existing?: { id: string; status: string; custom: string }[];
}

function fakePayPal(cfg: FakePayPal = {}) {
  const writes: string[] = [];
  const urls: string[] = [];
  const orders = new Map<string, { status: string; custom: string; value: string }>();
  const auths = new Map<string, string>();
  const captures = new Map<string, string>();
  let n = 0;
  for (const e of cfg.existing ?? []) orders.set(e.id, { status: e.status, custom: e.custom, value: "1.23" });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const order = (id: string) => {
    const o = orders.get(id)!;
    return {
      id,
      status: o.status,
      links: [{ rel: "payer-action", href: `${cfg.approveHost ?? "https://www.sandbox.paypal.com"}/checkoutnow?token=${id}` }],
      purchase_units: [{ custom_id: o.custom, amount: { currency_code: "USD", value: o.value }, ...(cfg.payee === null ? {} : { payee: { merchant_id: cfg.payee ?? "MERCHANT123" } }) }],
    };
  };
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    const p = url.slice(PAYPAL_SANDBOX_API.length);
    const method = init?.method ?? "GET";
    if (p === "/v1/oauth2/token") return json({ access_token: "tok", expires_in: 3600 });
    if (method === "POST") writes.push(p.replace(/\/[A-Z0-9_]+(?=\/|$)/g, "/{id}"));
    if (method === "POST" && p === "/v2/checkout/orders") {
      if (cfg.failCreate && writes.filter((w) => w === "/v2/checkout/orders").length <= cfg.failCreate) return json({ name: "INTERNAL_SERVER_ERROR" }, 500);
      const body = JSON.parse(String(init!.body));
      const id = `ORDER${++n}AAAA`;
      orders.set(id, { status: "PAYER_ACTION_REQUIRED", custom: body.purchase_units[0].custom_id, value: body.purchase_units[0].amount.value });
      if (cfg.approve !== false) orders.get(id)!.status = "APPROVED"; // the human approved on PayPal's page
      return json(order(id));
    }
    const m = /^\/v2\/checkout\/orders\/([^/]+)(\/authorize)?$/.exec(p);
    if (m && !m[2]) return json(order(m[1]!));
    if (m && m[2]) {
      const id = `AUTH${n}BBBBBB`;
      auths.set(id, "CREATED");
      orders.get(m[1]!)!.status = "COMPLETED";
      return json({ ...order(m[1]!), purchase_units: [{ payments: { authorizations: [{ id, status: "CREATED", amount: { currency_code: "USD", value: "1.23" }, expiration_time: "2026-11-27T00:00:00Z" }] } }] });
    }
    const a = /^\/v2\/payments\/authorizations\/([^/]+)(\/capture|\/void)?$/.exec(p);
    if (a && a[2] === "/capture") captures.set(`CAP${n}CCCCCC`, a[1]!);
    if (a && a[2] === "/capture") return json({ id: `CAP${n}CCCCCC`, status: cfg.captureStatus ?? "COMPLETED", amount: { currency_code: "USD", value: "1.23" }, supplementary_data: { related_ids: { authorization_id: a[1] } } });
    if (a && a[2] === "/void") {
      auths.set(a[1]!, "VOIDED");
      return new Response(null, { status: 204 });
    }
    if (a) return json({ id: a[1], status: auths.get(a[1]!), amount: { currency_code: "USD", value: "1.23" } });
    const c = /^\/v2\/payments\/captures\/([^/]+)$/.exec(p);
    if (c) return json({ id: c[1], status: cfg.captureStatus ?? "COMPLETED", amount: { currency_code: "USD", value: "1.23" }, supplementary_data: { related_ids: { authorization_id: captures.get(c[1]!) } } });
    return json({ name: "NOT_FOUND" }, 404);
  }) as typeof fetch;
  const gw = new PayPalSandboxGateway({ clientId: "id", clientSecret: "secret-value", webhookId: null, brandName: "smoke", fetchImpl });
  return { gw, writes, urls };
}

function options(over: Partial<SmokeOptions> = {}) {
  const prompts: string[] = [];
  let clock = 0;
  const o: SmokeOptions = {
    runId: "smoke_test",
    log: () => undefined,
    promptApproval: (_flow, url) => prompts.push(url),
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    pollMs: 5_000,
    approvalTimeoutMs: 60_000,
    expectedMerchantId: "MERCHANT123",
    ...over,
  };
  return { o, prompts };
}

describe("PayPal sandbox smoke flow", () => {
  it("creates exactly two $1.23 orders, captures one, voids the other, and sends each write once", async () => {
    const { gw, writes, urls } = fakePayPal();
    const { o, prompts } = options({ expectedMerchantId: "MERCHANT123" });
    const evidence = await runSmokeFlow(gw, o);
    expect(writes).toEqual([
      "/v2/checkout/orders",
      "/v2/checkout/orders/{id}/authorize",
      "/v2/payments/authorizations/{id}/capture",
      "/v2/checkout/orders",
      "/v2/checkout/orders/{id}/authorize",
      "/v2/payments/authorizations/{id}/void",
    ]);
    expect(urls.every((u) => u.startsWith("https://api-m.sandbox.paypal.com/"))).toBe(true);
    expect(prompts).toHaveLength(2); // the human approves both on PayPal's page
    expect(evidence.map((e) => e.flow)).toEqual(["capture", "void"]);
    expect(evidence[0]!.capture).toMatchObject({ status: "COMPLETED", amountCents: 123, currency: "USD", authorizationMatches: true });
    expect(evidence[1]!.void).toMatchObject({ authorizationStatusAfter: "VOIDED" });
    // The client-side idempotency keys are recorded for each write (they are not provider secrets).
    const [cap, voided] = evidence;
    expect(cap!.requestIds).toEqual({ createOrder: `${cap!.reservationRef}:CREATE_ORDER`, authorize: `${cap!.reservationRef}:AUTHORIZE`, capture: `${cap!.reservationRef}:CAPTURE` });
    expect(voided!.requestIds).toEqual({ createOrder: `${voided!.reservationRef}:CREATE_ORDER`, authorize: `${voided!.reservationRef}:AUTHORIZE`, void: `${voided!.reservationRef}:VOID` });
    expect(cap!.requestIds.createOrder).not.toBe(voided!.requestIds.createOrder);
    const text = JSON.stringify(evidence);
    expect(text).not.toContain("ORDER1AAAA");
    expect(text).not.toContain("MERCHANT123");
    expect(text).not.toContain("secret-value");
  });

  it("stops without creating the second order when the capture is not COMPLETED", async () => {
    const { gw, writes } = fakePayPal({ captureStatus: "PENDING" });
    await expect(runSmokeFlow(gw, options().o)).rejects.toThrow(SmokeCheckError);
    expect(writes.filter((w) => w === "/v2/checkout/orders")).toHaveLength(1);
  });

  it("refuses to authorize when the order goes to an unexpected merchant", async () => {
    const { gw, writes } = fakePayPal({ payee: "SOMEONEELSE1" });
    const { o, prompts } = options();
    await expect(runSmokeFlow(gw, o)).rejects.toThrow(/expected sandbox merchant/);
    expect(prompts).toEqual([]);
    expect(writes).toEqual(["/v2/checkout/orders"]);
  });

  it("requires a well-formed expected merchant before any PayPal call", async () => {
    const { gw, urls } = fakePayPal();
    await expect(runSmokeFlow(gw, options({ expectedMerchantId: "" }).o)).rejects.toThrow(/PAYPAL_EXPECTED_MERCHANT_ID/);
    expect(urls).toEqual([]);
  });

  it("stops before showing the buyer a link when PayPal reports no payee", async () => {
    const { gw, writes } = fakePayPal({ payee: null });
    const { o, prompts } = options();
    await expect(runSmokeFlow(gw, o)).rejects.toThrow(/did not report the order payee/);
    expect(prompts).toEqual([]);
    expect(writes).toEqual(["/v2/checkout/orders"]);
  });

  it("rejects an approval link that is not PayPal's sandbox checkout over HTTPS", async () => {
    for (const approveHost of ["https://www.paypal.com", "http://www.sandbox.paypal.com", "https://www.sandbox.paypal.com.evil.example"]) {
      const { gw, writes } = fakePayPal({ approveHost });
      const { o, prompts } = options();
      await expect(runSmokeFlow(gw, o), approveHost).rejects.toMatchObject({ kind: "INVALID_RESPONSE" });
      expect(prompts).toEqual([]);
      expect(writes).toEqual(["/v2/checkout/orders"]);
    }
  });

  it("gives up after the approval window without authorizing", async () => {
    const { gw, writes } = fakePayPal({ approve: false });
    await expect(runSmokeFlow(gw, options().o)).rejects.toThrow(/was not approved within 1 min.*--resume-order/);
    expect(writes).toEqual(["/v2/checkout/orders"]);
  });

  it("never retries an order creation that failed", async () => {
    const { gw, writes } = fakePayPal({ failCreate: 1 });
    await expect(runSmokeFlow(gw, options().o)).rejects.toMatchObject({ kind: "HTTP_5XX" });
    expect(writes).toEqual(["/v2/checkout/orders"]);
  });
});

describe("read-only inspection and resume of an existing order", () => {
  const pending = { id: "ORDEREXIST01", status: "PAYER_ACTION_REQUIRED", custom: "smoke_1700000000000_capture" };

  it("inspects an order with GET only and reports approval, payee, amount and link availability", async () => {
    const { gw, writes } = fakePayPal({ existing: [pending] });
    const r = await inspectOrder(gw, pending.id, "MERCHANT123");
    expect(writes).toEqual([]);
    expect(r).toMatchObject({ status: "PAYER_ACTION_REQUIRED", payeeMatches: true, amountOk: true, buyerApproved: false, authorizations: [], captured: false, approvalLinkAvailable: true, flow: "capture" });
    expect(JSON.stringify(r)).not.toContain("MERCHANT123");
    expect(JSON.stringify(r)).not.toContain("checkoutnow");
  });

  it("resumes an approved order without creating a new one: authorize once, capture once", async () => {
    const { gw, writes } = fakePayPal({ existing: [{ ...pending, status: "APPROVED" }] });
    const { o, prompts } = options();
    const ev = await resumeSmokeOrder(gw, pending.id, o);
    expect(writes).toEqual(["/v2/checkout/orders/{id}/authorize", "/v2/payments/authorizations/{id}/capture"]);
    expect(prompts).toEqual([]);
    expect(ev).toMatchObject({ flow: "capture", reservationRef: pending.custom, capture: { status: "COMPLETED" } });
  });

  it("shows the existing link again when approval is still pending, then waits for it", async () => {
    const { gw, writes } = fakePayPal({ existing: [pending], approve: false });
    const { o, prompts } = options();
    await expect(resumeSmokeOrder(gw, pending.id, o)).rejects.toThrow(/not approved within/);
    expect(prompts).toHaveLength(1);
    expect(writes).toEqual([]);
  });

  it("refuses orders not created by the smoke script", async () => {
    const { gw, writes } = fakePayPal({ existing: [{ ...pending, custom: "res_real_customer" }] });
    await expect(resumeSmokeOrder(gw, pending.id, options().o)).rejects.toThrow(/not created by this smoke script/);
    expect(writes).toEqual([]);
  });
});

describe("capture-only smoke run", () => {
  it("creates exactly one order, authorizes once, captures once and never voids", async () => {
    const { gw, writes, urls } = fakePayPal();
    const { o, prompts } = options({ expectedMerchantId: "MERCHANT123" });
    const evidence = await runSmokeFlow(gw, o, ["capture"]);
    expect(writes).toEqual(["/v2/checkout/orders", "/v2/checkout/orders/{id}/authorize", "/v2/payments/authorizations/{id}/capture"]);
    expect(urls.every((u) => u.startsWith("https://api-m.sandbox.paypal.com/"))).toBe(true);
    expect(prompts).toHaveLength(1);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.capture).toMatchObject({ status: "COMPLETED", amountCents: 123, currency: "USD", authorizationMatches: true });
  });

  it("reports every provider response as it happens, so evidence can be saved before the run ends", async () => {
    const { gw } = fakePayPal();
    const steps: string[] = [];
    const { o } = options({ expectedMerchantId: "MERCHANT123", onReference: (flow, kind, _id, status) => steps.push(`${flow}/${kind}:${status}`) });
    await runSmokeFlow(gw, o, ["capture"]);
    expect(steps).toEqual(["capture/order:APPROVED", "capture/authorization:CREATED", "capture/capture:COMPLETED"]);
  });

  it("records the created order even when the payee check then stops the run", async () => {
    const { gw, writes } = fakePayPal({ payee: "SOMEONEELSE1" });
    const steps: string[] = [];
    const { o, prompts } = options({ onReference: (_f, kind) => steps.push(kind) });
    await expect(runSmokeFlow(gw, o, ["capture"])).rejects.toThrow(/expected sandbox merchant/);
    expect(steps).toEqual(["order"]);
    expect(prompts).toEqual([]);
    expect(writes).toEqual(["/v2/checkout/orders"]);
  });

  it("refuses an empty or duplicated flow list before any PayPal call", async () => {
    for (const flows of [[], ["capture", "capture"]] as const) {
      const { gw, urls } = fakePayPal();
      await expect(runSmokeFlow(gw, options().o, flows)).rejects.toThrow(/distinct and non-empty/);
      expect(urls).toEqual([]);
    }
  });
});

describe("void-only smoke run", () => {
  it("creates exactly one order, authorizes once, voids once and confirms VOIDED with a read-only GET", async () => {
    const { gw, writes, urls } = fakePayPal();
    const steps: string[] = [];
    const { o, prompts } = options({ expectedMerchantId: "MERCHANT123", onReference: (flow, kind, _id, status) => steps.push(`${flow}/${kind}:${status}`) });
    const evidence = await runSmokeFlow(gw, o, ["void"]);
    expect(writes).toEqual(["/v2/checkout/orders", "/v2/checkout/orders/{id}/authorize", "/v2/payments/authorizations/{id}/void"]);
    expect(urls.every((u) => u.startsWith("https://api-m.sandbox.paypal.com/"))).toBe(true);
    expect(urls.at(-1)).toMatch(/\/v2\/payments\/authorizations\/[^/]+$/); // the final call is the GET re-read
    expect(prompts).toHaveLength(1);
    expect(steps).toEqual(["void/order:APPROVED", "void/authorization:CREATED", "void/void:VOIDED"]);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.capture).toBeUndefined();
    expect(evidence[0]!.void).toMatchObject({ authorizationStatusAfter: "VOIDED" });
    expect(evidence[0]!.operations).toContain("GET /v2/payments/authorizations/{id}");
  });

  it("keeps the merchant check: a wrong payee stops before the buyer sees a link", async () => {
    const { gw, writes } = fakePayPal({ payee: "SOMEONEELSE1" });
    const { o, prompts } = options();
    await expect(runSmokeFlow(gw, o, ["void"])).rejects.toThrow(/expected sandbox merchant/);
    expect(prompts).toEqual([]);
    expect(writes).toEqual(["/v2/checkout/orders"]);
  });

  it("resumes an approved void-flow order: authorize once, void once, no new order", async () => {
    const { gw, writes } = fakePayPal({ existing: [{ id: "ORDERVOID001", status: "APPROVED", custom: "smoke_1700000000000_void" }] });
    const evidence = await resumeSmokeOrder(gw, "ORDERVOID001", options().o);
    expect(writes).toEqual(["/v2/checkout/orders/{id}/authorize", "/v2/payments/authorizations/{id}/void"]);
    expect(evidence.void).toMatchObject({ authorizationStatusAfter: "VOIDED" });
  });
});

describe("smoke flow selection", () => {
  it("maps flags to exactly one flow, defaults to both, and rejects conflicting flags", () => {
    expect(selectSmokeFlows(["--approve-sandbox-orders", "--void-only"], false)).toEqual(["void"]);
    expect(selectSmokeFlows(["--capture-only"], false)).toEqual(["capture"]);
    expect(selectSmokeFlows([], false)).toEqual(["capture", "void"]);
    expect(() => selectSmokeFlows(["--capture-only", "--void-only"], false)).toThrow(/only one/);
    expect(() => selectSmokeFlows(["--void-only"], true)).toThrow(/--resume-order/);
    expect(selectSmokeFlows([], true)).toEqual(["capture", "void"]);
  });
});
