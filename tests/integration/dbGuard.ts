/** Real-PostgreSQL tests truncate tables and create schemas: they must never run against a hosted database. */
const HOSTED = /(\.neon\.tech|-pooler|\.supabase\.(co|com)|\.rds\.amazonaws\.com|\.azure\.com|\.render\.com|\.railway\.app)$/i;

export function assertDisposableTestUrl(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid URL.");
  }
  const persistent = process.env.DATABASE_URL ? safeHost(process.env.DATABASE_URL) : null;
  if (HOSTED.test(host) || (persistent !== null && persistent === host)) {
    throw new Error("TEST_DATABASE_URL points at a hosted or persistent database; use a throwaway local server.");
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
