import { getRuntime } from "@/server/runtime";
import { searchGear } from "@/server/services/gearService";

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * "Spend your savings": EV accessories found through Channel3. Renders nothing without a Channel3 key or results,
 * so the page never depends on it. Links go to the merchant; GridWindow sells nothing here.
 */
export async function GearSection({ savingsCents }: { savingsCents: number }) {
  const { env } = await getRuntime();
  const { enabled, items } = await searchGear(env.CHANNEL3_API_KEY, { maxPriceCents: 6000, limit: 6 });
  if (!enabled || items.length === 0) return null;
  return (
    <section aria-labelledby="gear-title" className="card p-5 sm:p-6 space-y-4">
      <div className="space-y-1">
        <p className="eyebrow">Spend your savings</p>
        <h2 id="gear-title" className="text-[22px] font-semibold">Gear for smarter overnight charging</h2>
        <p className="text-[14px] text-text-2">
          {savingsCents > 0 ? `Your flexible charging has modeled ${usd(savingsCents)} in savings so far. ` : ""}
          In-stock EV accessories under $60, found live across merchants.
        </p>
      </div>
      <ul className="gear-grid grid gap-4 grid-cols-2 lg:grid-cols-3">
        {items.map((g) => (
          <li key={g.id} className="gear-card">
            <a href={g.url} target="_blank" rel="noopener noreferrer sponsored" className="gear-link no-underline">
              {g.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- merchant images come from arbitrary hosts
                <img src={g.imageUrl} alt="" loading="lazy" className="gear-img" />
              )}
              <span className="gear-title">{g.title}</span>
              <span className="gear-meta">
                <strong>{usd(g.priceCents)}</strong>
                {g.compareAtCents && g.compareAtCents > g.priceCents && <s className="text-muted">{usd(g.compareAtCents)}</s>}
                <span className="text-muted">· {g.domain}</span>
              </span>
              <span className="sr-only">(opens the merchant site in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="meta">Product search powered by Channel3. Prices and stock come from each merchant; GridWindow does not sell these items.</p>
    </section>
  );
}
