/**
 * EV accessory search through Channel3 (https://api.trychannel3.com, POST /v1/search).
 *
 * Optional: without CHANNEL3_API_KEY the feature reports itself disabled and every caller hides it.
 * The key stays on the server. Results are cached briefly to respect the free-tier quota, and any
 * provider error degrades to "no results" rather than breaking the page that asked.
 */
import { z } from "zod";

export const CHANNEL3_SEARCH_URL = "https://api.trychannel3.com/v1/search";
const TIMEOUT_MS = 6_000;
const CACHE_MS = 10 * 60_000;
export const DEFAULT_GEAR_QUERY = "EV charging accessories J1772 adapter charging cable organizer";

export interface GearItem {
  id: string;
  title: string;
  brand: string | null;
  imageUrl: string | null;
  priceCents: number;
  compareAtCents: number | null;
  currency: string;
  url: string;
  domain: string;
}

export interface GearResult {
  enabled: boolean;
  items: GearItem[];
}

const responseSchema = z.object({
  products: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      brands: z.array(z.object({ name: z.string() })).optional().default([]),
      images: z
        .array(z.object({ url: z.string(), cleaned_url: z.string().nullable().optional(), is_main_image: z.boolean().optional() }))
        .optional()
        .default([]),
      offers: z
        .array(
          z.object({
            url: z.string(),
            domain: z.string(),
            availability: z.string().optional(),
            price: z.object({ price: z.number(), compare_at_price: z.number().nullable().optional(), currency: z.string() }),
          }),
        )
        .optional()
        .default([]),
    }),
  ),
});

const toCents = (dollars: number) => Math.round(dollars * 100);

/** Maps Channel3 products to display items: in-stock https offers only, cheapest offer per product. */
export function toGearItems(raw: unknown, limit: number): GearItem[] {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) return [];
  const items: GearItem[] = [];
  for (const p of parsed.data.products) {
    const offer = p.offers
      .filter((o) => o.url.startsWith("https://") && o.availability !== "OutOfStock")
      .sort((a, b) => a.price.price - b.price.price)[0];
    if (!offer) continue;
    const image = p.images.find((i) => i.is_main_image) ?? p.images[0];
    items.push({
      id: p.id,
      title: p.title,
      brand: p.brands[0]?.name ?? null,
      imageUrl: image ? (image.cleaned_url ?? image.url) : null,
      priceCents: toCents(offer.price.price),
      compareAtCents: offer.price.compare_at_price ? toCents(offer.price.compare_at_price) : null,
      currency: offer.price.currency,
      url: offer.url,
      domain: offer.domain,
    });
    if (items.length >= limit) break;
  }
  return items;
}

const cache = new Map<string, { at: number; items: GearItem[] }>();

export async function searchGear(
  apiKey: string | undefined,
  opts: { query?: string; maxPriceCents?: number; limit?: number },
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<GearResult> {
  if (!apiKey) return { enabled: false, items: [] };
  const query = (opts.query?.trim() || DEFAULT_GEAR_QUERY).slice(0, 200);
  const limit = Math.min(Math.max(opts.limit ?? 6, 1), 12);
  const maxPrice = opts.maxPriceCents && opts.maxPriceCents > 0 ? opts.maxPriceCents / 100 : null;
  const key = JSON.stringify([query, limit, maxPrice]);
  const hit = cache.get(key);
  if (hit && now() - hit.at < CACHE_MS) return { enabled: true, items: hit.items };
  try {
    const res = await fetchImpl(CHANNEL3_SEARCH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        query,
        limit,
        filters: { availability: ["InStock"], conditions: ["new"], ...(maxPrice ? { price: { max_price: maxPrice } } : {}) },
        config: { country: "US", currency: "USD" },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { enabled: true, items: [] };
    const items = toGearItems(await res.json(), limit);
    cache.set(key, { at: now(), items });
    return { enabled: true, items };
  } catch {
    return { enabled: true, items: [] };
  }
}
