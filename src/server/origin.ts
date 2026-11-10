/**
 * Browser origins the API accepts for state-changing requests (CSRF layer 1). Pure and strict:
 * - the configured APP_BASE_URL origin and the request's own origin (existing behaviour);
 * - explicit ALLOWED_ORIGINS entries (exact origins only: no wildcard, no path, https unless loopback);
 * - when APP_BASE_URL is a loopback dev address, the other loopback spellings of the same port, because
 *   `localhost` and `127.0.0.1` are the same machine in local development. Never applied to a public APP_BASE_URL.
 */
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

const isLoopbackHost = (hostname: string) => LOOPBACK_HOSTS.includes(hostname);

/** Returns the canonical origin of one ALLOWED_ORIGINS entry, or a reason it is refused. */
export function parseAllowedOrigin(entry: string): { origin: string } | { problem: string } {
  const trimmed = entry.trim();
  if (trimmed.includes("*")) return { problem: "wildcards are not allowed" };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { problem: "not a valid origin" };
  }
  if (url.origin === "null" || url.origin !== trimmed.replace(/\/$/, "")) return { problem: "must be an exact origin (scheme, host, optional port; no path)" };
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) return { problem: "must be https (http only for loopback)" };
  return { origin: url.origin };
}

export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const parsed = parseAllowedOrigin(entry);
      if ("problem" in parsed) throw new Error(`ALLOWED_ORIGINS entry rejected: ${parsed.problem}`);
      return parsed.origin;
    });
}

export function allowedOrigins(appBaseUrl: string, requestUrl: string, extra: readonly string[] = []): Set<string> {
  const base = new URL(appBaseUrl);
  const allowed = new Set<string>([base.origin, new URL(requestUrl).origin, ...extra]);
  if (base.protocol === "http:" && isLoopbackHost(base.hostname)) {
    const port = base.port ? `:${base.port}` : "";
    for (const host of LOOPBACK_HOSTS) allowed.add(`http://${host}${port}`);
  }
  return allowed;
}

export function isAllowedOrigin(origin: string | null, appBaseUrl: string, requestUrl: string, extra: readonly string[] = []): boolean {
  return origin !== null && allowedOrigins(appBaseUrl, requestUrl, extra).has(origin);
}
