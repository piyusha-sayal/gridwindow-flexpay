import { isIP } from "node:net";

/**
 * Mandatory settings for the live PayPal Sandbox webhook certification. Pure and value-free: results carry
 * the requirement name and a reason, never the configured value. Every unmet requirement is a FAIL.
 */
export interface CertificationCheck {
  name: string;
  ok: boolean;
  reason?: string;
}

/** PayPal webhook IDs are short alphanumeric strings. */
export const WEBHOOK_ID_FORMAT = /^[A-Za-z0-9]{10,40}$/;

const PRIVATE_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home.arpa"];

/** Returns why a value is not a usable public HTTPS origin, or null when it is. */
export function publicHttpsOriginProblem(value: string | undefined): string | null {
  if (!value) return "not set (the app would default to http://localhost:3000)";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "not a valid URL";
  }
  if (url.protocol !== "https:") return "must use https://";
  if (url.username || url.password) return "must not contain credentials";
  if (url.search || url.hash || url.pathname !== "/") return "must be an origin only (no path, query or fragment)";
  const host = url.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, "")) !== 0) return "must be a DNS name, not an IP address";
  if (!host.includes(".") || host === "localhost" || PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) return "must be a public host name, not a local one";
  return null;
}

export function checkLiveCertification(env: Record<string, string | undefined>): CertificationCheck[] {
  const check = (name: string, problem: string | null): CertificationCheck => ({ name, ok: problem === null, ...(problem ? { reason: problem } : {}) });
  const webhookId = env.PAYPAL_WEBHOOK_ID?.trim() ?? "";
  return [
    check("APP_BASE_URL is the public HTTPS endpoint", publicHttpsOriginProblem(env.APP_BASE_URL)),
    check("PAYPAL_WEBHOOK_ID is the ID of the registered webhook", webhookId === "" ? "not set (every webhook delivery would be rejected)" : WEBHOOK_ID_FORMAT.test(webhookId) ? null : "does not look like a PayPal webhook ID"),
    check("TRUST_PROXY=true (tunnel in front of the app)", env.TRUST_PROXY === "true" ? null : 'must be exactly "true"; otherwise all callers share one rate-limit bucket'),
  ];
}
