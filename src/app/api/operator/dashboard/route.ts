import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, requireOperator } from "@/server/http";
import { getRuntime } from "@/server/runtime";
import { driverDefaultNightOf } from "@/server/services/quoteService";
import { demoToolsAllowed } from "@/server/services/demoService";
import { operatorDashboard } from "@/server/services/viewService";

const night = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const GET = handler(async (req: Request) => {
  await requireOperator();
  const { deps, env } = await getRuntime();
  const param = new URL(req.url).searchParams.get("night");
  const nightOf = param ? night.parse(param) : driverDefaultNightOf(deps.station, deps.now());
  return NextResponse.json({ dashboard: await operatorDashboard(deps, nightOf), demoTools: demoToolsAllowed(env) });
});
