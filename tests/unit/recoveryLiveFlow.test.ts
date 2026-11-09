import { describe, expect, it } from "vitest";
import { argsDigest, boundedToolVerdict, pickLiveEnv, skippedModelReasons, summarizeTrace, type TraceEntryLike } from "../../scripts/recoveryLiveFlow";

const step = (over: Partial<TraceEntryLike>): TraceEntryLike => ({ seq: 1, tool: "requestRecoveryCandidates", actor: "GEMINI", input: {}, outcome: "OK", detail: "ok", ...over });

describe("pickLiveEnv", () => {
  it("keeps only the allowlisted keys and ignores database and other secrets", () => {
    const text = ["DATABASE_URL=postgres://user:pw@host/db", "GEMINI_API_KEY=key-123", "GEMINI_MODEL=gemini-x", "PAYPAL_CLIENT_SECRET=abc", "bad line"].join("\n");
    expect(pickLiveEnv(text)).toEqual({ GEMINI_API_KEY: "key-123", GEMINI_MODEL: "gemini-x" });
  });

  it("returns an empty object when the file has no allowlisted keys", () => {
    expect(pickLiveEnv("")).toEqual({});
  });
});

describe("argsDigest", () => {
  it("is stable for equal input and differs for different input", () => {
    expect(argsDigest({ candidateId: "c1" })).toBe(argsDigest({ candidateId: "c1" }));
    expect(argsDigest({ candidateId: "c1" })).not.toBe(argsDigest({ candidateId: "c2" }));
    expect(argsDigest({})).toHaveLength(16);
  });
});

describe("summarizeTrace", () => {
  it("replaces raw input with a digest and bounds the detail length", () => {
    const [s] = summarizeTrace([step({ input: { text: "secret model text" }, detail: "x".repeat(300) })]);
    expect(s).toMatchObject({ seq: 1, actor: "GEMINI", tool: "requestRecoveryCandidates", outcome: "OK" });
    expect(s!.detail).toHaveLength(160);
    expect(JSON.stringify(s)).not.toContain("secret model text");
  });
});

describe("skippedModelReasons", () => {
  it("extracts the reason from orchestrator skip entries only", () => {
    const entries = [
      step({ tool: "orchestrator", actor: "DETERMINISTIC", detail: "model not used for this step: TIMEOUT" }),
      step({ tool: "orchestrator", actor: "DETERMINISTIC", detail: "started" }),
    ];
    expect(skippedModelReasons(entries)).toEqual(["TIMEOUT"]);
  });
});

describe("boundedToolVerdict", () => {
  it("passes when every model step names a server tool and no payment call happened", () => {
    const r = boundedToolVerdict([step({ tool: "validateRecoveryPlan" }), step({ tool: "proposeRecovery" })], 0);
    expect(r).toEqual({ verdict: "PASS", toolsNamed: ["validateRecoveryPlan", "proposeRecovery"], outsideToolSet: [] });
  });

  it("fails when the model names a tool outside the server set", () => {
    const r = boundedToolVerdict([step({ tool: "capturePayment" })], 0);
    expect(r.verdict).toBe("FAIL");
    expect(r.outsideToolSet).toEqual(["capturePayment"]);
  });

  it("fails when any payment-gateway call occurred during the run", () => {
    expect(boundedToolVerdict([step({})], 1).verdict).toBe("FAIL");
  });

  it("is BLOCKED when the model produced no step", () => {
    expect(boundedToolVerdict([step({ actor: "DETERMINISTIC" })], 0).verdict).toBe("BLOCKED");
  });
});
