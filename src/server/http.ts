/** HTTP boundary helpers: signed sessions, origin (CSRF) check, rate limiting, safe errors. */
import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ServiceError } from "./deps";
import { ConfigError } from "./env";
import { getRuntime } from "./runtime";

const DRIVER_COOKIE = "gw_drv";
const OPERATOR_COOKIE = "gw_op";
const OPERATOR_TTL_MS = 8 * 3_600_000;

function sign(key: Buffer, value: string): string {
  return createHmac("sha256", key).update(value).digest("base64url");
}

function verifySigned(key: Buffer, token: string | undefined): string | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const value = token.slice(0, i);
  const expected = Buffer.from(sign(key, value));
  const given = Buffer.from(token.slice(i + 1));
  return expected.length === given.length && timingSafeEqual(expected, given) ? value : null;
}

async function cookieOptions() {
  const { env } = await getRuntime();
  return { httpOnly: true, sameSite: "lax" as const, secure: env.APP_BASE_URL.startsWith("https://"), path: "/" };
}

/** Returns the driver's pseudonymous session id, creating one if needed (route handlers only). */
export async function driverSession(create = true): Promise<string | null> {
  const { sessionKey } = await getRuntime();
  const jar = await cookies();
  const existing = verifySigned(sessionKey, jar.get(DRIVER_COOKIE)?.value);
  if (existing?.startsWith("drv_")) return existing;
  if (!create) return null;
  const id = `drv_${randomBytes(16).toString("base64url")}`;
  jar.set(DRIVER_COOKIE, `${id}.${sign(sessionKey, id)}`, { ...(await cookieOptions()), maxAge: 7 * 86_400 });
  return id;
}

export async function isOperator(): Promise<boolean> {
  const { sessionKey } = await getRuntime();
  const value = verifySigned(sessionKey, (await cookies()).get(OPERATOR_COOKIE)?.value);
  if (!value?.startsWith("op:")) return false;
  return Number(value.slice(3)) > Date.now();
}

export async function requireOperator(): Promise<void> {
  if (!(await isOperator())) throw new ServiceError("UNAUTHORIZED", "Operator sign-in required.", 401);
}

export async function operatorLogin(passphrase: string): Promise<boolean> {
  const { sessionKey, operatorPassHash } = await getRuntime();
  if (!operatorPassHash) throw new ServiceError("OPERATOR_DISABLED", "Operator console is not configured on this server.", 503);
  const given = createHash("sha256").update(passphrase).digest();
  if (!timingSafeEqual(given, operatorPassHash)) return false;
  const value = `op:${Date.now() + OPERATOR_TTL_MS}`;
  (await cookies()).set(OPERATOR_COOKIE, `${value}.${sign(sessionKey, value)}`, { ...(await cookieOptions()), maxAge: OPERATOR_TTL_MS / 1000 });
  return true;
}

export async function operatorLogout(): Promise<void> {
  (await cookies()).delete(OPERATOR_COOKIE);
}

/** CSRF defense for state-changing requests: Origin must be our own. */
export async function assertSameOrigin(req: Request): Promise<void> {
  const { env } = await getRuntime();
  const origin = req.headers.get("origin");
  const allowed = new Set([new URL(env.APP_BASE_URL).origin, new URL(req.url).origin]);
  if (!origin || !allowed.has(origin)) throw new ServiceError("BAD_ORIGIN", "Request origin not allowed.", 403);
  // Second, independent CSRF layer: browsers label cross-site requests via Fetch Metadata.
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new ServiceError("BAD_ORIGIN", "Cross-site request refused.", 403);
}

const buckets = new Map<string, { count: number; resetAt: number; limit: number }>();
const MAX_BUCKETS = 10_000;

/**
 * Client key for rate limiting. X-Forwarded-For is client-controlled unless a trusted proxy
 * appends to it, so it is only used with TRUST_PROXY=true (taking the proxy-appended last hop);
 * otherwise all callers share one bucket per route, which fails closed.
 */
export function clientKey(req: Request, trustProxy = process.env.TRUST_PROXY === "true"): string {
  if (!trustProxy) return "shared";
  const hops = (req.headers.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return hops[hops.length - 1] ?? "shared";
}

/**
 * Keeps the map bounded without ever resetting a client that is currently limited: drop expired
 * windows, then the oldest clients still under their limit. Returns false if every tracked client
 * is limited (the caller then refuses the new client instead of forgetting a limited one).
 */
function pruneBuckets(now: number): boolean {
  for (const [key, entry] of buckets) if (entry.resetAt <= now) buckets.delete(key);
  for (const [key, entry] of buckets) {
    if (buckets.size < MAX_BUCKETS * 0.9) break;
    if (entry.count < entry.limit) buckets.delete(key);
  }
  return buckets.size < MAX_BUCKETS;
}

/** Fixed-window in-memory limiter (single-process demo; use a shared store if scaled out). */
export function rateLimit(req: Request, bucket: string, limit: number, windowMs = 60_000): void {
  hit(`${bucket}:${clientKey(req)}`, limit, windowMs);
}

/**
 * One counter for all callers. Backstop for brute-force-sensitive routes: even if a forwarded client address
 * is forged or rotated, the total attempts per window stay bounded.
 */
export function rateLimitGlobal(bucket: string, limit: number, windowMs = 60_000): void {
  hit(`${bucket}:*`, limit, windowMs);
}

function hit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    if (!entry && buckets.size >= MAX_BUCKETS && !pruneBuckets(now)) throw new ServiceError("RATE_LIMITED", "Too many requests. Please wait a moment.", 429);
    buckets.set(key, { count: 1, resetAt: now + windowMs, limit });
    return;
  }
  if (entry.count >= limit) throw new ServiceError("RATE_LIMITED", "Too many requests. Please wait a moment.", 429);
  buckets.set(key, { ...entry, count: entry.count + 1 });
}

export async function readJson(req: Request, maxBytes = 16_384): Promise<unknown> {
  // HTML forms cannot send application/json cross-site without a CORS preflight, which we never grant.
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new ServiceError("UNSUPPORTED_MEDIA_TYPE", "Request body must be sent as application/json.", 415);
  }
  const text = await req.text();
  if (Buffer.byteLength(text) > maxBytes) throw new ServiceError("PAYLOAD_TOO_LARGE", "Request too large.", 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new ServiceError("INVALID_JSON", "Request body must be JSON.", 400);
  }
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ServiceError) return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.httpStatus });
  if (err instanceof ZodError) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Some fields are invalid.", fields: err.issues.map((i) => i.path.join(".")) } }, { status: 400 });
  }
  if (err instanceof ConfigError) {
    console.error("[gridwindow] configuration error:", err.message);
    return NextResponse.json({ error: { code: "SERVER_MISCONFIGURED", message: "Server configuration error." } }, { status: 503 });
  }
  console.error("[gridwindow] unhandled error:", err instanceof Error ? `${err.name}: ${err.message}` : "unknown");
  return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong. No payment action was taken by this request." } }, { status: 500 });
}

/** Wraps a route handler with uniform error handling. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
