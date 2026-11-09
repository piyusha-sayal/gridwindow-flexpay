import { NextResponse } from "next/server";
import { handler } from "@/server/http";
import { getRuntime } from "@/server/runtime";
import { driverDefaultWindow } from "@/server/services/quoteService";

export const GET = handler(async () => {
  const { deps, llm } = await getRuntime();
  const defaults = driverDefaultWindow(deps.station, deps.now());
  return NextResponse.json({
    providerMode: deps.gateway.mode,
    station: { name: deps.station.name, timeZone: deps.station.timeZone, stationCapW: deps.station.stationCapW, ports: deps.station.ports },
    ai: { enabled: llm !== null, model: llm?.model ?? null },
    defaultNightOf: defaults.nightOf,
    defaultPlugInLocal: defaults.plugInLocal,
    defaultDepartLocal: defaults.departLocal,
  });
});
