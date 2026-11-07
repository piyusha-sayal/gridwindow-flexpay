import { afterEach, describe, expect, it } from "vitest";
import { assertDisposableTestUrl } from "../integration/dbGuard";

const saved = process.env.DATABASE_URL;
afterEach(() => {
  if (saved === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved;
});

describe("assertDisposableTestUrl", () => {
  it("accepts a local throwaway server", () => {
    expect(() => assertDisposableTestUrl("postgres://gwtest@localhost:55432/gridwindow_test")).not.toThrow();
  });

  it.each(["postgres://u:p@ep-cool-123.us-east-2.aws.neon.tech/db", "postgres://u:p@ep-cool-123-pooler.c-2.us-east-2.aws.neon.tech/db", "postgres://u:p@db.abc.supabase.co/db"])(
    "refuses hosted endpoint %s",
    (url) => {
      expect(() => assertDisposableTestUrl(url)).toThrow(/hosted or persistent/);
    },
  );

  it("refuses the host of the configured persistent DATABASE_URL", () => {
    process.env.DATABASE_URL = "postgres://u:p@shared.internal.example/db";
    expect(() => assertDisposableTestUrl("postgres://x@shared.internal.example/other")).toThrow(/hosted or persistent/);
  });

  it("never echoes the URL", () => {
    try {
      assertDisposableTestUrl("postgres://secretuser:secretpw@ep-x.neon.tech/db");
    } catch (err) {
      expect((err as Error).message).not.toMatch(/secretuser|secretpw/);
    }
  });
});
