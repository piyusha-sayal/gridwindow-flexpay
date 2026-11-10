/** Customer payment copy is truthful in every state, including ones MOCK journeys cannot reach. */
import { describe, expect, it } from "vitest";
import { amountLine, CAPACITY_UNCONFIRMED_COPY, capacityUnconfirmed, PAYMENT_COPY, paymentCopyFor, paymentCopyForView } from "@/app/reservations/[id]/paymentCopy";
import { PAYMENT_STATES } from "@/domain/paymentState";
import type { ReservationView } from "@/server/services/viewService";

const text = (s: keyof typeof PAYMENT_COPY) => `${PAYMENT_COPY[s].title} ${PAYMENT_COPY[s].body}`;

describe("reservation payment copy", () => {
  it("covers every payment state", () => {
    expect(Object.keys(PAYMENT_COPY).sort()).toEqual([...PAYMENT_STATES].sort());
  });

  it("only CAPTURED reads as a completed charge", () => {
    const completed = /\bpaid\b|\bcaptured after\b|\bwe charged\b|(?<!\bno )\bpayment (?:was|is|has been) (?:collected|completed|successful)\b/i;
    for (const s of PAYMENT_STATES) {
      if (s === "CAPTURED") expect(text(s)).toMatch(/captured/i);
      else expect(text(s), s).not.toMatch(completed);
    }
  });

  it("states pending, declined, voided and reconciliation outcomes without overclaiming", () => {
    expect(text("CAPTURE_PENDING")).toMatch(/not final/i);
    expect(text("CAPTURE_DECLINED")).toMatch(/no new charge will be attempted without your new approval/i);
    expect(text("VOIDED")).toMatch(/not a refund/i);
    expect(text("VOIDED")).toMatch(/may take some time/i);
    expect(text("NEEDS_RECONCILIATION")).toMatch(/no new charge will be attempted/i);
    expect(text("AUTHORIZED")).toMatch(/not captured/i);
    for (const s of PAYMENT_STATES) if (s !== "VOIDED") expect(text(s), s).not.toMatch(/refund/i);
  });
});

describe("provider authorization without confirmed capacity", () => {
  const view = (slotsCommitted: boolean) => ({ paymentState: "AUTHORIZED" as const, serviceState: "AWAITING_PAYMENT" as const, proofs: [], slotsCommitted });

  it("is derived only for an AUTHORIZED hold with no committed capacity", () => {
    expect(capacityUnconfirmed(view(false))).toBe(true);
    expect(capacityUnconfirmed(view(true))).toBe(false);
    expect(capacityUnconfirmed({ paymentState: "VOIDED", slotsCommitted: false })).toBe(false);
  });

  it("is never described as a committed charging window", () => {
    const copy = paymentCopyForView(view(false));
    expect(copy).toBe(CAPACITY_UNCONFIRMED_COPY);
    expect(`${copy.title} ${copy.body}`).toMatch(/charging capacity not yet confirmed/i);
    expect(`${copy.title} ${copy.body}`).not.toMatch(/window is reserved|reserved/i);
    expect(paymentCopyForView(view(true))).toBe(PAYMENT_COPY.AUTHORIZED);
  });
});

describe("delivered but not yet settled", () => {
  it("shows capture requested, not paid, while the provider has not answered", () => {
    const c = paymentCopyFor("AUTHORIZED", "DELIVERED");
    expect(c.title).toMatch(/capture requested/i);
    expect(`${c.title} ${c.body}`).not.toMatch(/\bpaid\b(?! until)|captured\./i);
    expect(paymentCopyFor("AUTHORIZED", "SCHEDULED")).toBe(PAYMENT_COPY.AUTHORIZED);
    expect(paymentCopyFor("CAPTURED", "DELIVERED")).toBe(PAYMENT_COPY.CAPTURED);
  });
});

describe("payment panel amount line", () => {
  const view = (paymentState: ReservationView["paymentState"], proofs: string[] = []) =>
    ({ paymentState, economics: { priceCents: 1243 }, proofs: proofs.map((type) => ({ type, amountCents: 1243 })) }) as unknown as ReservationView;

  it("reads as paid only with a provider CAPTURED proof", () => {
    expect(amountLine(view("CAPTURED", ["CAPTURED"]))).toEqual({ amount: "$12.43", note: "paid", tone: "success" });
    expect(amountLine(view("CAPTURED")).note).not.toMatch(/paid/);
    for (const s of PAYMENT_STATES) if (s !== "CAPTURED") expect(amountLine(view(s, ["AUTHORIZED"])).note, s).not.toMatch(/paid/);
  });

  it("shows a hold while authorized or pending, and $0.00 when nothing can be collected", () => {
    expect(amountLine(view("AUTHORIZED", ["AUTHORIZED"]))).toMatchObject({ amount: "$12.43", note: "held, not collected" });
    expect(amountLine(view("CAPTURE_PENDING", ["AUTHORIZED"]))).toMatchObject({ amount: "$12.43", note: "held, capture not final" });
    for (const s of ["VOIDED", "CAPTURE_DECLINED", "CANCELLED", "FAILED"] as const) expect(amountLine(view(s, ["AUTHORIZED", "VOIDED"]))).toMatchObject({ amount: "$0.00", note: "not collected" });
    expect(amountLine(view("ORDER_CREATED"))).toMatchObject({ amount: "$12.43", note: "not yet authorized" });
    expect(amountLine(view("NEEDS_RECONCILIATION", ["AUTHORIZED"]))).toMatchObject({ amount: "$12.43", note: "not collected · being confirmed" });
  });
});

describe("unreconciled provider capture", () => {
  const view = (paymentState: ReservationView["paymentState"]) =>
    ({ paymentState, serviceState: "FAILED", economics: { priceCents: 1243 }, proofs: [{ type: "CAPTURED", amountCents: 1243 }] }) as unknown as ReservationView;

  it("shows the captured amount as under review, never $0.00 or a final outcome", () => {
    for (const s of ["VOIDED", "FAILED", "CANCELLED", "CAPTURE_DECLINED", "NEEDS_RECONCILIATION"] as const) {
      expect(amountLine(view(s)), s).toEqual({ amount: "$12.43", note: "captured by provider · reconciling, not final", tone: "warn" });
      expect(paymentCopyForView(view(s)), s).toEqual(PAYMENT_COPY.NEEDS_RECONCILIATION);
    }
  });

  it("uses the normal copy when there is no contradiction", () => {
    const voided = { paymentState: "VOIDED", serviceState: "FAILED", proofs: [{ type: "VOIDED" }] } as unknown as ReservationView;
    expect(paymentCopyForView(voided)).toEqual(paymentCopyFor("VOIDED", "FAILED"));
  });
});
