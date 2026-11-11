import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, rateLimit } from "@/server/http";
import { getRuntime } from "@/server/runtime";
import { searchGear } from "@/server/services/gearService";

const params = z.object({
  q: z.string().max(200).optional(),
  maxPriceCents: z.coerce.number().int().min(100).max(500_000).optional(),
  limit: z.coerce.number().int().min(1).max(12).optional(),
});

/** EV accessory search through Channel3. Read-only; `{ enabled: false }` when no Channel3 key is configured. */
export const GET = handler(async (req: Request) => {
  rateLimit(req, "gear", 20);
  const url = new URL(req.url);
  const { q, maxPriceCents, limit } = params.parse(Object.fromEntries(url.searchParams));
  const { env } = await getRuntime();
  return NextResponse.json(await searchGear(env.CHANNEL3_API_KEY, { query: q, maxPriceCents, limit }));
});
