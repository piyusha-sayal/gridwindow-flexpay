import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, handler, rateLimit, readJson } from "@/server/http";
import { interpretRequest } from "@/server/ai/assistant";
import { getRuntime } from "@/server/runtime";
import { relativeDeadlineWindow } from "@/server/services/quoteService";

const schema = z.object({ text: z.string().max(1000) }).strict();

/** Model-assisted (or labeled deterministic fallback) parsing: returns suggested form fields only, never prices or approvals. */
export const POST = handler(async (req: Request) => {
  await assertSameOrigin(req);
  rateLimit(req, "parse", 30);
  const { text } = schema.parse(await readJson(req));
  const { deps, llm } = await getRuntime();
  const result = await interpretRequest(llm, deps.station, text);
  const within = result.parsed.departWithinMinutes;
  if (within === undefined) return NextResponse.json(result);
  // "In two hours" is resolved here, against the station clock and time zone, never by the model.
  const w = relativeDeadlineWindow(deps.station, deps.now(), within);
  const [ph, pm] = w.plugInLocal.split(":").map(Number) as [number, number];
  const [dh, dm] = w.departLocal.split(":").map(Number) as [number, number];
  const notes = [...result.parsed.notes, `"Within ${within} minutes" read as plug in at ${w.plugInLocal}, ready by ${w.departLocal} (station time).`];
  return NextResponse.json({ ...result, parsed: { ...result.parsed, nightOf: w.nightOf, plugInLocal: { hour: ph, minute: pm }, departLocal: { hour: dh, minute: dm }, notes } });
});
