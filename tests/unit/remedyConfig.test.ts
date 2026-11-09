import { describe, expect, it } from "vitest";
import { loadEnv } from "@/server/env";
import { SYNTHETIC_ECONOMICS } from "@/domain/economics";

describe("FAILED_SERVICE_REMEDY_CENTS (MODELED operator cost)", () => {
  it("defaults to the 200-cent modeled assumption", () => {
    expect(loadEnv({}).FAILED_SERVICE_REMEDY_CENTS).toBe(200);
    expect(loadEnv({}).FAILED_SERVICE_REMEDY_CENTS).toBe(SYNTHETIC_ECONOMICS.failedServiceRemedyCents);
    expect(loadEnv({ FAILED_SERVICE_REMEDY_CENTS: "" }).FAILED_SERVICE_REMEDY_CENTS).toBe(200);
  });

  it("accepts whole cents of 0 or more", () => {
    expect(loadEnv({ FAILED_SERVICE_REMEDY_CENTS: "0" }).FAILED_SERVICE_REMEDY_CENTS).toBe(0);
    expect(loadEnv({ FAILED_SERVICE_REMEDY_CENTS: "250" }).FAILED_SERVICE_REMEDY_CENTS).toBe(250);
  });

  it.each(["-1", "1.5", "1e3", "abc", "+5", " 5", "0100"])("refuses %j", (value) => {
    expect(() => loadEnv({ FAILED_SERVICE_REMEDY_CENTS: value })).toThrow();
  });
});
