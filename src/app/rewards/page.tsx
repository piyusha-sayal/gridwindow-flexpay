import Link from "next/link";
import { Suspense } from "react";
import { driverSession } from "@/server/http";
import { getRuntime } from "@/server/runtime";
import { listSessionReservations, summarizeSession } from "@/server/services/sessionService";
import { GearSection } from "./GearSection";
import { SummaryCards } from "./SummaryCards";
import { TransactionList } from "./TransactionList";

export const metadata = { title: "Rewards & Payments · GridWindow FlexPay" };
export const dynamic = "force-dynamic";

export default async function RewardsPage() {
  const { deps } = await getRuntime();
  const session = await driverSession(false);
  const reservations = session ? await listSessionReservations(deps, session) : [];
  const summary = summarizeSession(reservations);
  const providerNote = deps.gateway.mode === "PAYPAL_SANDBOX" ? "Authorizations use PayPal Sandbox." : "Payments are simulated (MOCK, not PayPal).";

  return (
    <div className="stagger space-y-8">
      <header className="space-y-3 max-w-[820px]">
        <p className="eyebrow">This browser session only</p>
        <h1 className="page-title font-semibold leading-[1.02] text-[clamp(36px,5.4vw,64px)]">Rewards &amp; Payments</h1>
        <p className="lede">
          Only charging commitments made from this browser appear here. Savings are modeled from synthetic tariffs. {providerNote}
        </p>
      </header>

      <SummaryCards summary={summary} />

      {reservations.length === 0 ? (
        <section aria-labelledby="empty" className="card empty-card p-6 space-y-4 text-center">
          <span aria-hidden="true" className="icon-tile mx-auto">
            <span className="ico ico-wallet" />
          </span>
          <h2 id="empty" className="text-[18px] font-semibold">No charging commitments yet.</h2>
          <Link href="/drive" className="btn btn-primary btn-glow no-underline">Plan My Charge</Link>
        </section>
      ) : (
        <TransactionList reservations={reservations} />
      )}

      <Suspense fallback={null}>
        <GearSection savingsCents={summary.modeledSavingCents} />
      </Suspense>
    </div>
  );
}
