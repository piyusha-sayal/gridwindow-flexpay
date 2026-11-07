import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BenchmarkSummary } from "@/domain/benchmark";

/** The committed benchmark artifact (server only); null when it has not been generated. */
export async function loadSummary(): Promise<BenchmarkSummary | null> {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), "artifacts", "benchmark", "summary.json"), "utf8")) as BenchmarkSummary;
  } catch {
    return null;
  }
}
