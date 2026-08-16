import { describe, expect, it, vi } from "vitest";
import {
  CooperativeAsyncTimeoutError,
  createAsyncTelemetry,
  runCooperativePool,
  startRoundSelectionWatchdog,
  withBoundedAwait,
} from "@/src/server/execution/cooperative-async.service";
import { RoundSelectionAbortError } from "@/src/server/execution/round-runtime.types";

describe("cooperative async runtime", () => {
  it("times out bounded awaits instead of waiting forever", async () => {
    await expect(
      withBoundedAwait(
        "slow",
        new Promise<string>(() => {
          /* never resolves */
        }),
        30,
        createAsyncTelemetry(),
      ),
    ).rejects.toBeInstanceOf(CooperativeAsyncTimeoutError);
  });

  it("isolates stalled workers and continues remaining items", async () => {
    const telemetry = createAsyncTelemetry();
    const results = await runCooperativePool(
      ["stall", "ok", "done"],
      async (value, _index, signal) => {
        if (value === "stall") {
          await new Promise(() => {
            signal.addEventListener("abort", () => undefined);
          });
        }
        return value.toUpperCase();
      },
      {
        label: "test-pool",
        concurrency: 2,
        workerTimeoutMs: 50,
        telemetry,
      },
    );
    expect(results[0]).toBeNull();
    expect(results[1]).toBe("OK");
    expect(results[2]).toBe("DONE");
    expect(telemetry.workerTimedOut).toBeGreaterThanOrEqual(1);
  });

  it("polls budget via shouldAbort during pool execution", async () => {
    const abort = vi.fn(() => {
      throw new RoundSelectionAbortError("BUDGET_EXPIRED", "budget");
    });
    await expect(
      runCooperativePool(
        [1, 2],
        async (value) => value,
        {
          label: "budget-pool",
          concurrency: 1,
          workerTimeoutMs: 500,
          shouldAbort: abort,
          heartbeatIntervalMs: 10,
        },
      ),
    ).rejects.toBeInstanceOf(RoundSelectionAbortError);
    expect(abort).toHaveBeenCalled();
  });

  it("fires watchdog when heartbeat goes stale", async () => {
    vi.useFakeTimers();
    const onStale = vi.fn();
    const watchdog = startRoundSelectionWatchdog({
      jobId: "job-1",
      getLastHeartbeatAt: () => new Date(Date.now() - 120_000).toISOString(),
      staleMs: 1000,
      pollMs: 100,
      onStale,
    });
    await vi.advanceTimersByTimeAsync(150);
    expect(onStale).toHaveBeenCalled();
    watchdog.stop();
    vi.useRealTimers();
  });
});
