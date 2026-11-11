import { describe, expect, it, vi } from "vitest";
import { CHANNEL3_SEARCH_URL, searchGear, toGearItems } from "@/server/services/gearService";

const product = (id: string, offers: { url: string; price: number; availability?: string; compare?: number | null }[], image = true) => ({
  id,
  title: `Item ${id}`,
  brands: [{ id: "b", name: "Brand" }],
  images: image ? [{ url: `https://img.example/${id}.jpg`, cleaned_url: null, is_main_image: true }] : [],
  offers: offers.map((o) => ({ url: o.url, domain: "shop.example", availability: o.availability ?? "InStock", price: { price: o.price, compare_at_price: o.compare ?? null, currency: "USD" } })),
});

describe("toGearItems", () => {
  it("keeps the cheapest in-stock https offer, in cents", () => {
    const items = toGearItems(
      {
        products: [
          product("a", [
            { url: "https://shop.example/a1", price: 29.99, compare: 39.99 },
            { url: "https://shop.example/a2", price: 24.5 },
            { url: "https://shop.example/a3", price: 9.99, availability: "OutOfStock" },
          ]),
        ],
      },
      6,
    );
    expect(items).toEqual([
      expect.objectContaining({ id: "a", brand: "Brand", priceCents: 2450, compareAtCents: null, url: "https://shop.example/a2", imageUrl: "https://img.example/a.jpg" }),
    ]);
  });

  it("drops products without a usable offer and malformed payloads", () => {
    expect(toGearItems({ products: [product("b", [{ url: "http://insecure.example/b", price: 5 }])] }, 6)).toEqual([]);
    expect(toGearItems({ nope: true }, 6)).toEqual([]);
  });

  it("respects the limit", () => {
    const products = ["1", "2", "3"].map((id) => product(id, [{ url: `https://shop.example/${id}`, price: 10 }]));
    expect(toGearItems({ products }, 2)).toHaveLength(2);
  });
});

describe("searchGear", () => {
  it("is disabled without a key and never calls the network", async () => {
    const f = vi.fn();
    await expect(searchGear(undefined, {}, f as unknown as typeof fetch)).resolves.toEqual({ enabled: false, items: [] });
    expect(f).not.toHaveBeenCalled();
  });

  it("sends the key server-side with a dollar price filter, and caches", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ products: [product("c", [{ url: "https://shop.example/c", price: 12 }])] }), { status: 200 }));
    const r1 = await searchGear("k1", { query: "cache test", maxPriceCents: 6000, limit: 3 }, f as unknown as typeof fetch, () => 1_000);
    const r2 = await searchGear("k1", { query: "cache test", maxPriceCents: 6000, limit: 3 }, f as unknown as typeof fetch, () => 2_000);
    expect(r1).toEqual(r2);
    expect(r1.items[0]?.priceCents).toBe(1200);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CHANNEL3_SEARCH_URL);
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k1");
    expect(JSON.parse(String(init.body))).toMatchObject({ query: "cache test", limit: 3, filters: { price: { max_price: 60 } } });
  });

  it("degrades to no results on provider errors", async () => {
    const bad = vi.fn(async () => new Response("{}", { status: 402 }));
    await expect(searchGear("k2", { query: "error test" }, bad as unknown as typeof fetch)).resolves.toEqual({ enabled: true, items: [] });
    const boom = vi.fn(async () => {
      throw new Error("network");
    });
    await expect(searchGear("k2", { query: "throw test" }, boom as unknown as typeof fetch)).resolves.toEqual({ enabled: true, items: [] });
  });
});
