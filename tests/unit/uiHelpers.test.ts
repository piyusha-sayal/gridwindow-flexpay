/**
 * Pure helpers behind Sprint 10 UI: the "lowest price" offer criterion, operator night KPIs and the
 * receipt money line (only a provider-confirmed capture reads as paid).
 */
import { describe, expect, it } from "vitest";
import { benchmarkHighlights } from "@/app/impact-lab/Highlights";
import { lowestPriceOfferIds, offerTraits } from "@/app/drive/OfferList";
import { contributionItem } from "@/app/operator/DetailPanel";
import { nightSummary } from "@/app/operator/metrics";
import { ATTENTION_STATES } from "@/components/ui";
import { settlementStep } from "@/app/reservations/[id]/paymentCopy";
import { contributionLine, printPageStyle, receiptNumber, settlement, totalLine } from "@/components/FlexReceipt";
import type { BenchmarkSummary } from "@/domain/benchmark";
import { economicOutcome } from "@/domain/paymentState";
import type { PricedOffer } from "@/domain/quotes";
import { DEMO_STATION } from "@/domain/station";
import { driverDefaultNightOf, driverDefaultWindow, toChargeRequest } from "@/server/services/quoteService";
import type { DashboardSession, OperatorDashboard, ReservationView } from "@/server/services/viewService";

const offer = (offerId: string, priceCents: number) => ({ offerId, priceCents }) as PricedOffer;

describe("lowest-price offer", () => {
  it("returns every offer sharing the minimum final price", () => {
    expect([...lowestPriceOfferIds([offer("a", 900), offer("b", 750), offer("c", 800)])]).toEqual(["b"]);
    expect([...lowestPriceOfferIds([offer("a", 1243), offer("b", 1243), offer("c", 1300)])]).toEqual(["a", "b"]);
    expect(lowestPriceOfferIds([]).size).toBe(0);
  });

  it("differentiates offers by charging time, max power and ready-by time", () => {
    expect(offerTraits({ powerW: [0, 11_000, 5_500, 0], chargeEndMs: 42 })).toEqual({ chargingSlots: 2, maxPowerW: 11_000, readyByMs: 42 });
  });
});

function session(over: Partial<DashboardSession>): DashboardSession {
  return {
    id: "r",
    portId: "A",
    plugInMs: 0,
    departMs: 0,
    powerW: [0, 0],
    deliveredW: null,
    paymentState: "AUTHORIZED",
    serviceState: "SCHEDULED",
    slotsCommitted: true,
    amountCents: 1000,
    providerMode: "MOCK",
    targetBatteryWh: 30_000,
    baselinePowerW: [],
    listPriceCents: 1200,
    discountCents: 200,
    energyCostCents: 400,
    baselineEnergyCostCents: 700,
    operatorImprovementCents: 100,
    lastEvent: null,
    updatedAt: "",
    providerCapturedCents: null,
    operatorResolutionRequired: false,
    resolutionDeadline: null,
    resolutionOverdue: false,
    ...over,
  };
}

describe("operator night summary", () => {
  it("counts active capacity holders, ports, modeled costs and attention states", () => {
    const d = {
      slotCount: 2,
      stationCapW: 100_000,
      safetyHeadroomW: 10_000,
      congestionThresholdW: 70_000,
      forecastBaseLoadW: [20_000, 30_000],
      ports: [{ id: "A" }, { id: "B" }, { id: "C" }],
      sessions: [
        session({ id: "1", portId: "A", powerW: [7_000, 0] }),
        session({ id: "2", portId: "B", powerW: [0, 11_000], paymentState: "CAPTURED", serviceState: "DELIVERED", slotsCommitted: false }),
        session({ id: "3", portId: "C", paymentState: "VOIDED", serviceState: "CANCELLED", slotsCommitted: false }),
        session({ id: "4", portId: "C", paymentState: "NEEDS_RECONCILIATION", slotsCommitted: false }),
      ],
    } as unknown as OperatorDashboard;
    const n = nightSummary(d, ATTENTION_STATES);
    expect(n).toMatchObject({ activeReservations: 1, vehiclesParked: 2, portsInUse: 2, plannedPeakW: 41_000, stationCapW: 100_000, minHeadroomW: 49_000 });
    expect(n).toMatchObject({ energyCostCents: 800, baselineEnergyCostCents: 1400, needsAttention: 1 });
    // Only the AUTHORIZED reservation is projected; only the CAPTURED one is realized; voided contributes nothing.
    expect(n).toMatchObject({ projectedContributionCents: 100, realizedContributionCents: 100, capturedRevenueCents: 1000, capturedCount: 1 });
  });

  it("a provider capture contradicting a terminal local state counts as collected money and needs attention", () => {
    const d = {
      slotCount: 2,
      stationCapW: 100_000,
      safetyHeadroomW: 0,
      congestionThresholdW: 100_000,
      forecastBaseLoadW: [0, 0],
      ports: [{ id: "A" }],
      sessions: [session({ id: "x", paymentState: "VOIDED", serviceState: "CANCELLED", slotsCommitted: false, providerCapturedCents: 900 })],
    } as unknown as OperatorDashboard;
    expect(nightSummary(d, ATTENTION_STATES)).toMatchObject({ capturedRevenueCents: 900, capturedCount: 1, needsAttention: 1, realizedContributionCents: 0 });
  });

  it("sums simulated delivered energy from 15-minute slots", () => {
    const d = { slotCount: 2, stationCapW: 1, safetyHeadroomW: 0, congestionThresholdW: 1, forecastBaseLoadW: [0, 0], ports: [], sessions: [session({ deliveredW: [4_000, 8_000], slotsCommitted: false, paymentState: "CAPTURED" })] } as unknown as OperatorDashboard;
    expect(nightSummary(d, ATTENTION_STATES).deliveredWh).toBe(3_000);
  });
});

const view = (over: Partial<ReservationView>) => ({ id: "res_0123456789abcdef", paymentState: "CAPTURED", proofs: [], economics: { priceCents: 1000 }, ...over }) as ReservationView;

describe("receipt money line", () => {
  it("shows an amount paid only with a provider-confirmed capture", () => {
    expect(totalLine(view({ proofs: [{ type: "CAPTURED", amountCents: 1000 } as ReservationView["proofs"][number]] })).value).toBe("$10.00 USD");
    expect(totalLine(view({ proofs: [] })).value).toBe("$0.00 USD (not collected)");
    expect(totalLine(view({ paymentState: "CAPTURE_PENDING" }))).toEqual({ label: "Capture pending", value: "$10.00 USD authorized · not final, not yet paid" });
    for (const s of ["VOIDED", "CAPTURE_DECLINED", "AUTHORIZED"] as const) expect(totalLine(view({ paymentState: s })).value).toBe("$0.00 USD (not collected)");
  });

  it("never shows $0.00 or a final outcome when the provider recorded a capture the local state does not reflect", () => {
    const captured = [{ type: "CAPTURED", amountCents: 1000 } as ReservationView["proofs"][number]];
    for (const paymentState of ["VOIDED", "FAILED", "CANCELLED", "CAPTURE_DECLINED", "NEEDS_RECONCILIATION", "AUTHORIZED"] as const) {
      const r = view({ paymentState, proofs: captured });
      expect(totalLine(r), paymentState).toEqual({ label: "Payment under review", value: "$10.00 USD captured by provider · reconciling, not final" });
      expect(settlement(r), paymentState).toEqual({ tone: "warn", text: "Provider recorded a capture of $10.00; payment status is being reconciled, not final" });
      expect(settlementStep(r), paymentState).toEqual({ label: "Provider recorded a capture: reconciling, not final", status: "in-progress" });
    }
  });

  it("derives a short receipt number from the reservation id", () => {
    expect(receiptNumber("res_0123456789abcdef")).toBe("FR-89ABCDEF");
  });
});

describe("final progress step", () => {
  const proof = (type: string) => ({ type }) as ReservationView["proofs"][number];
  it("names the provider-confirmed outcome and never shows a pending capture as complete", () => {
    expect(settlementStep({ paymentState: "CAPTURED", proofs: [proof("CAPTURED")] })).toEqual({ label: "Payment captured (provider-confirmed)", status: "done" });
    expect(settlementStep({ paymentState: "VOIDED", proofs: [proof("VOIDED")] })).toEqual({ label: "Authorization voided: not charged (provider-confirmed)", status: "done" });
    expect(settlementStep({ paymentState: "CAPTURE_PENDING", proofs: [] })).toEqual({ label: "Capture pending: not final", status: "in-progress" });
    expect(settlementStep({ paymentState: "CAPTURE_DECLINED", proofs: [] })).toEqual({ label: "Capture declined: not charged", status: "failed" });
    expect(settlementStep({ paymentState: "CAPTURED", proofs: [] }).status).toBe("not-started");
    expect(settlementStep({ paymentState: "AUTHORIZED", proofs: [proof("AUTHORIZED")] }).status).toBe("not-started");
  });

  it("prints the receipt number in the page footer", () => {
    expect(printPageStyle("FR-89ABCDEF")).toContain('content: "GridWindow FlexReceipt FR-89ABCDEF"');
  });
});

describe("projected vs realized economics", () => {
  const r = (paymentState: ReservationView["paymentState"]) => ({ paymentState, economics: { operatorImprovementCents: 452 } }) as ReservationView;
  it("never presents a voided, failed or declined reservation's contribution as realized", () => {
    expect(economicOutcome("CAPTURED")).toBe("REALIZED");
    for (const s of ["VOIDED", "CANCELLED", "FAILED", "CAPTURE_DECLINED"] as const) {
      expect(economicOutcome(s)).toBe("NOT_REALIZED");
      expect(contributionItem(r(s))).toEqual({ k: "Operator contribution (not realized)", v: "$0.00 · +$4.52 was projected" });
      expect(contributionLine(r(s))).toContain("not realized");
    }
    for (const s of ["AUTHORIZED", "CAPTURE_PENDING", "NEEDS_RECONCILIATION"] as const) {
      expect(economicOutcome(s)).toBe("PROJECTED");
      expect(contributionItem(r(s)).k).toBe("Operator contribution (projected)");
    }
    expect(contributionItem(r("CAPTURED")).k).toBe("Operator contribution (realized, modeled)");
  });
});

describe("benchmark highlights", () => {
  it("reads headline numbers from the summary, including cases where optimization costs more", () => {
    const p = (policy: string, served: number, violations = 0) => ({ policy, served, infeasible: 1500 - served, violations, meanEnergyCostCentsPerServed: 1, meanPeakSiteW: 1, congestedRequests: 0 });
    const s = {
      requestCount: 1500,
      policies: [p("immediate", 1499), p("optimized", 1500)],
      pairwise: [{ baseline: "immediate", pairs: 1499, optimizedWorse: 34 }],
    } as unknown as BenchmarkSummary;
    const h = benchmarkHighlights(s);
    expect(h.optimized?.served).toBe(1500);
    expect(h.totalViolations).toBe(0);
    expect(h.baselines.map((b) => b.policy)).toEqual(["immediate"]);
    expect(h.costlier).toEqual([{ baseline: "immediate", pairs: 1499, optimizedWorse: 34 }]);
  });
});

describe("driver default night", () => {
  // DEMO_STATION runs in America/Los_Angeles; 2026-10-30 is PDT (UTC−7).
  const at = (localHour: number, minute = 15) => Date.UTC(2026, 9, 30, localHour + 7, minute);
  it("is always tonight in station time, so the default window has not started (regression: pre-07:00 used last night)", () => {
    expect(driverDefaultNightOf(DEMO_STATION, at(0, 0))).toBe("2026-10-30");
    expect(driverDefaultNightOf(DEMO_STATION, at(5, 0))).toBe("2026-10-30");
    expect(driverDefaultNightOf(DEMO_STATION, at(6, 59))).toBe("2026-10-30");
    expect(driverDefaultNightOf(DEMO_STATION, at(7, 0))).toBe("2026-10-30");
    expect(driverDefaultNightOf(DEMO_STATION, at(20))).toBe("2026-10-30");
  });

  it("keeps the 19:00 → 07:00 window until 18:45, then plugs in at the next quarter-hour at least 15 minutes ahead", () => {
    expect(driverDefaultWindow(DEMO_STATION, at(5, 0))).toEqual({ nightOf: "2026-10-30", plugInLocal: "19:00", departLocal: "07:00" });
    expect(driverDefaultWindow(DEMO_STATION, at(18, 44)).plugInLocal).toBe("19:00");
    expect(driverDefaultWindow(DEMO_STATION, at(18, 46)).plugInLocal).toBe("19:15");
    expect(driverDefaultWindow(DEMO_STATION, at(20, 7)).plugInLocal).toBe("20:30");
    expect(driverDefaultWindow(DEMO_STATION, at(23, 50))).toEqual({ nightOf: "2026-10-30", plugInLocal: "00:15", departLocal: "07:00" });
  });

  it("uses station wall time across DST changes", () => {
    // 2026-11-01 01:30 occurs twice (PDT then PST); 2026-03-08 02:00-03:00 does not exist.
    for (const utc of [Date.UTC(2026, 10, 1, 8, 30), Date.UTC(2026, 10, 1, 9, 30)]) expect(driverDefaultWindow(DEMO_STATION, utc)).toEqual({ nightOf: "2026-11-01", plugInLocal: "19:00", departLocal: "07:00" });
    expect(driverDefaultWindow(DEMO_STATION, Date.UTC(2026, 2, 8, 10, 30))).toEqual({ nightOf: "2026-03-08", plugInLocal: "19:00", departLocal: "07:00" });
    expect(driverDefaultWindow(DEMO_STATION, Date.UTC(2026, 2, 8, 6, 10)).plugInLocal).toBe("22:30"); // 22:10 PST on 2026-03-07
  });

  it("every minute of a normal day and both DST days: plug-in at least 15 minutes ahead, departure after plug-in, tonight's date", () => {
    // Station wall time comes from Intl with the station's zone, never the server's or browser's zone.
    const days: [number, number, number][] = [[2026, 9, 30], [2026, 10, 1], [2026, 2, 8]];
    for (const [y, m, d] of days) {
      const start = Date.UTC(y, m, d, 7); // 00:00 PDT or 23:00 PST the evening before; both sides are covered
      for (let min = 0; min < 26 * 60; min++) {
        const nowMs = start + min * 60_000;
        const w = driverDefaultWindow(DEMO_STATION, nowMs);
        const req = toChargeRequest(DEMO_STATION, { portId: "port_a", targetBatteryKWh: 30, spendCapCents: 2_000, ...w });
        expect(req.plugInMs - nowMs).toBeGreaterThanOrEqual(15 * 60_000);
        expect(req.departMs).toBeGreaterThan(req.plugInMs);
        expect(w.nightOf).toBe(new Intl.DateTimeFormat("en-CA", { timeZone: DEMO_STATION.timeZone }).format(nowMs));
      }
    }
  });
});
