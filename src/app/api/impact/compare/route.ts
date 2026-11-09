import { NextResponse } from "next/server";
import { impactScenarioSchema } from "@/app/impact-lab/scenario";
import { assertSameOrigin, handler, rateLimit, readJson } from "@/server/http";
import { getRuntime } from "@/server/runtime";
import { compareScenario } from "@/server/services/impactService";

/** Pure comparison: never stores a quote, reservation or any other row. */
export const POST = handler(async (req: Request) => {
  await assertSameOrigin(req);
  rateLimit(req, "impact", 60);
  const input = impactScenarioSchema.parse(await readJson(req));
  const { deps } = await getRuntime();
  return NextResponse.json({ comparison: await compareScenario(deps, input) });
});
