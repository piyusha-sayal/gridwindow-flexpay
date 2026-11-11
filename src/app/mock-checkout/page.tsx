import { notFound } from "next/navigation";
import { formatUsd } from "@/domain/units";
import { isMockGateway } from "@/payments/mockGateway";
import { getRuntime } from "@/server/runtime";

export const metadata = { title: "MOCK provider approval, not PayPal" };

/** Stand-in for a hosted approval page, available only when PAYMENT_MODE=mock. */
export default async function MockCheckout({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { deps } = await getRuntime();
  if (!isMockGateway(deps.gateway)) notFound();
  const token = (await searchParams).token;
  if (typeof token !== "string" || !/^MOCK-ORDER-[0-9a-f-]{36}$/.test(token)) notFound();
  let amount: number;
  try {
    amount = (await deps.gateway.peek(token)).amountCents;
  } catch {
    notFound();
  }
  return (
    <div className="checkout-card ring-flow mx-auto max-w-[520px] card overflow-hidden p-0">
      <p className="mock-banner border-b border-[var(--amber-line)] bg-warn-soft px-6 py-3 text-[14px] font-semibold text-warn" role="note">
        MOCK PAYMENT PROVIDER: this is not PayPal. No money, real or sandbox, moves. Configure PayPal Sandbox credentials to use the real sandbox checkout.
      </p>
      <div className="space-y-6 p-6 sm:p-8">
        <span aria-hidden="true" className="icon-tile icon-tile-amber">
          <span className="ico ico-shield" />
        </span>
        <h1 className="text-[clamp(28px,4vw,36px)] font-semibold">Approve authorization</h1>
        <div className="checkout-amount flex flex-wrap items-baseline justify-between gap-4 py-4">
          <span className="text-text-2">Authorize</span>
          <strong className="text-gradient-amber num-rise text-[clamp(32px,6vw,44px)] font-semibold tabular">{formatUsd(amount)} USD</strong>
        </div>
        <p className="meta break-all">Order {token}</p>
        <form method="post" action="/api/mock-provider/approve" className="flex flex-wrap gap-3">
          <input type="hidden" name="token" value={token} />
          <button type="submit" name="decision" value="approve" className="btn btn-primary btn-lg btn-glow">
            Approve (mock)
          </button>
          <button type="submit" name="decision" value="cancel" className="btn btn-lg">
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
