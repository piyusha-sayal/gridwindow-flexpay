import { NextResponse } from "next/server";
import { z } from "zod";
import { ServiceError } from "@/server/deps";
import { assertSameOrigin, handler, isOperator, operatorLogin, operatorLogout, rateLimit, rateLimitGlobal, readJson } from "@/server/http";

const schema = z.object({ passphrase: z.string().min(1).max(256) }).strict();

export const GET = handler(async () => NextResponse.json({ operator: await isOperator() }));

export const POST = handler(async (req: Request) => {
  await assertSameOrigin(req);
  rateLimit(req, "operator-login", 5);
  rateLimitGlobal("operator-login", 30);
  const { passphrase } = schema.parse(await readJson(req));
  if (!(await operatorLogin(passphrase))) throw new ServiceError("INVALID_CREDENTIALS", "Incorrect passphrase.", 401);
  return NextResponse.json({ operator: true });
});

export const DELETE = handler(async (req: Request) => {
  await assertSameOrigin(req);
  await operatorLogout();
  return NextResponse.json({ operator: false });
});
