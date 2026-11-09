import { Kpi } from "@/components/ui";
import { formatUsd } from "@/domain/units";
import type { SessionSummary } from "@/server/services/sessionService";

export function SummaryCards({ summary }: { summary: SessionSummary }) {
  return (
    <section aria-label="Summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi label="Modeled savings" value={formatUsd(summary.modeledSavingCents)} hint="Modeled, not a cash payout." />
      <Kpi label="Agreed charging price" value={formatUsd(summary.agreedPriceCents)} hint="Excludes voided and cancelled commitments." />
      <Kpi label="Active commitments" value={summary.activeCommitments} hint="Authorized, not yet captured or voided." />
      <Kpi label="Verified payment state" value={`${summary.captured} captured`} hint={`${summary.voided} voided · ${summary.pending} pending`} />
    </section>
  );
}
