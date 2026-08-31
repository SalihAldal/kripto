import { beforeEach, describe, expect, it } from "vitest";
import {
  getTransactionDurationLog,
  recordTransactionDuration,
  resetTransactionTelemetry,
} from "@/src/server/forensics/transaction-telemetry.service";

describe("transaction telemetry scope", () => {
  beforeEach(() => {
    resetTransactionTelemetry();
  });

  it("filters records by runId and roundId", () => {
    recordTransactionDuration({
      operation: "auto-round.beginRound",
      startedAt: "2026-08-26T07:00:00.000Z",
      endedAt: "2026-08-26T07:00:00.300Z",
      durationMs: 300,
      outcome: "commit",
      classification: "NORMAL",
      scope: { jobId: "job-a", runId: "run-a", roundId: "1" },
    });
    recordTransactionDuration({
      operation: "auto-round.failRound",
      startedAt: "2026-08-26T07:01:00.000Z",
      endedAt: "2026-08-26T07:01:02.300Z",
      durationMs: 2300,
      outcome: "rollback",
      classification: "SLOW",
      scope: { jobId: "job-a", runId: "run-b", roundId: "2" },
    });

    const runScoped = getTransactionDurationLog({ runId: "run-a" });
    const roundScoped = getTransactionDurationLog({ roundId: "2" });

    expect(runScoped).toHaveLength(1);
    expect(runScoped[0]?.scope?.runId).toBe("run-a");
    expect(roundScoped).toHaveLength(1);
    expect(roundScoped[0]?.scope?.roundId).toBe("2");
  });
});
