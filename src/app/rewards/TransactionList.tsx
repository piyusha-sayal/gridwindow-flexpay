import Link from "next/link";
import { PaymentBadge, ServiceBadge } from "@/components/ui";
import { settlementStep } from "@/app/reservations/[id]/paymentCopy";
import { formatUsd } from "@/domain/units";
import type { SessionReservation } from "@/server/services/sessionService";
import { EventTrail } from "./EventTrail";
import { batteryLabel, formatStamp, simulationLabel, windowLabel } from "./rewardsFormat";

function OfferPrice({ r }: { r: SessionReservation }) {
  return (
    <>
      <p className="font-semibold">{formatUsd(r.offer.agreedPriceCents)} agreed</p>
      <p className="text-muted text-[13px]">
        List {formatUsd(r.offer.listPriceCents)} · modeled saving {formatUsd(r.offer.modeledSavingCents)}
      </p>
    </>
  );
}

function CommitmentRef({ r }: { r: SessionReservation }) {
  return (
    <>
      <Link href={`/reservations/${encodeURIComponent(r.id)}`} className="font-mono text-[13px] break-all">
        {r.id}
      </Link>
      <p className="text-muted text-[13px]">Created {formatStamp(Date.parse(r.createdAt), r.timeZone)}</p>
    </>
  );
}

function DesktopRow({ r }: { r: SessionReservation }) {
  return (
    <>
      <tr className="align-top border-t border-line">
        <td className="p-3"><CommitmentRef r={r} /></td>
        <td className="p-3">
          <p>{batteryLabel(r.offer.targetBatteryWh)}</p>
          <p className="text-muted text-[13px]">{windowLabel(r)}</p>
        </td>
        <td className="p-3"><OfferPrice r={r} /></td>
        <td className="p-3"><PaymentBadge state={r.paymentState} /></td>
        <td className="p-3">
          <ServiceBadge state={r.serviceState} />
          <p className="text-muted text-[13px] mt-1">{simulationLabel(r.simulationOutcome)}</p>
        </td>
        <td className="p-3 text-[13px]">{settlementStep(r).label}</td>
      </tr>
      <tr className="border-none">
        <td colSpan={6} className="px-3 pb-3"><EventTrail events={r.events} timeZone={r.timeZone} /></td>
      </tr>
    </>
  );
}

function MobileCard({ r }: { r: SessionReservation }) {
  return (
    <article className="card p-4 space-y-3 min-w-0">
      <CommitmentRef r={r} />
      <dl className="grid grid-cols-1 gap-2 text-sm">
        <div><dt className="meta">Offer</dt><dd>{batteryLabel(r.offer.targetBatteryWh)} · {windowLabel(r)}</dd></div>
        <div><dt className="meta">Accepted price</dt><dd><OfferPrice r={r} /></dd></div>
        <div><dt className="meta">Authorization</dt><dd><PaymentBadge state={r.paymentState} /></dd></div>
        <div><dt className="meta">Charging</dt><dd><ServiceBadge state={r.serviceState} /> <span className="text-muted text-[13px]">{simulationLabel(r.simulationOutcome)}</span></dd></div>
        <div><dt className="meta">Capture or void</dt><dd>{settlementStep(r).label}</dd></div>
      </dl>
      <EventTrail events={r.events} timeZone={r.timeZone} />
    </article>
  );
}

export function TransactionList({ reservations }: { reservations: SessionReservation[] }) {
  return (
    <section aria-labelledby="transactions" className="space-y-4">
      <h2 id="transactions" className="text-[22px] font-semibold tracking-[-0.01em]">Transactions</h2>
      <div className="card hidden md:block overflow-hidden">
        <table className="w-full table-fixed text-sm">
          <caption className="sr-only">Charging commitments for this browser session, newest first</caption>
          <thead className="text-left text-muted">
            <tr>
              <th scope="col" className="p-3 w-[18%]">Commitment</th>
              <th scope="col" className="p-3 w-[16%]">Offer</th>
              <th scope="col" className="p-3 w-[18%]">Accepted price</th>
              <th scope="col" className="p-3 w-[16%]">Authorization</th>
              <th scope="col" className="p-3 w-[18%]">Charging</th>
              <th scope="col" className="p-3">Capture or void</th>
            </tr>
          </thead>
          <tbody>
            {reservations.map((r) => (
              <DesktopRow key={r.id} r={r} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 md:hidden">
        {reservations.map((r) => (
          <MobileCard key={r.id} r={r} />
        ))}
      </div>
    </section>
  );
}
