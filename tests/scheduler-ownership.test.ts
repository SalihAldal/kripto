import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  atomicSpawnScheduler,
  getSchedulerRegistrySnapshot,
  loopRegistry,
  ownerRegistry,
  resetSchedulerOwnershipForTests,
  spawnQueues,
  touchSchedulerLease,
} from "@/src/server/execution/scheduler-ownership.service";

const stressLevels = [1, 10, 25, 50, 100];

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("scheduler ownership atomic spawn", () => {
  beforeEach(() => {
    resetSchedulerOwnershipForTests();
  });

  it.each(stressLevels)("handles %i simultaneous spawn requests with one loop", async (count) => {
    const jobId = `job-stress-${count}`;
    let loopStarts = 0;
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const startLoop = async () => {
      loopStarts += 1;
      resolveStarted();
      await wait(40);
    };

    const results = await Promise.all(
      Array.from({ length: count }, () => atomicSpawnScheduler(jobId, startLoop)),
    );

    await started;

    const spawned = results.filter((row) => row.action === "spawned");
    const attached = results.filter((row) => row.action === "attached");
    const registry = getSchedulerRegistrySnapshot();

    expect(spawned.length).toBe(1);
    expect(spawned.length + attached.length).toBe(count);
    expect(registry.loopCount).toBeLessThanOrEqual(1);
    expect(loopRegistry.size).toBeLessThanOrEqual(1);
    expect(ownerRegistry.size).toBeLessThanOrEqual(1);
    expect(loopStarts).toBe(1);

    await wait(60);
    expect(loopRegistry.size).toBe(0);
    expect(spawnQueues.size).toBe(0);
  });

  it("returns the same owner for idempotent start calls", async () => {
    const jobId = "job-idempotent";
    const first = await atomicSpawnScheduler(jobId, async () => {
      await wait(20);
    });
    const second = await atomicSpawnScheduler(jobId, async () => {
      await wait(20);
    });

    expect(first.action).toBe("spawned");
    expect(second.action).toBe("attached");
    expect(first.ownerId).toBe(second.ownerId);
    expect(first.generation).toBe(second.generation);
  });

  it("serializes lifecycle transitions without duplicate STARTING loops", async () => {
    const jobId = "job-lifecycle";
    const states: string[] = [];
    await atomicSpawnScheduler(jobId, async (ctx) => {
      states.push(`run:${ctx.generation}`);
      await wait(15);
    });

    await wait(30);
    const lease = ownerRegistry.get(jobId);
    expect(lease?.state).toBe("STOPPED");
    expect(states).toEqual(["run:1"]);
  });

  it("throttles scheduler lease persistence writes", async () => {
    vi.useFakeTimers();
    const jobId = "job-lease-throttle";
    const persistLease = vi.fn(async ({ lease }: { lease: unknown }) => ({ ok: true, lease }));
    await atomicSpawnScheduler(
      jobId,
      async (ctx) => {
        await touchSchedulerLease(jobId, ctx, {
          loadLease: async () => null,
          persistLease,
        });
        await touchSchedulerLease(jobId, ctx, {
          loadLease: async () => null,
          persistLease,
        });
        await vi.advanceTimersByTimeAsync(11_000);
        await touchSchedulerLease(jobId, ctx, {
          loadLease: async () => null,
          persistLease,
        });
      },
      {
        loadLease: async () => null,
        persistLease,
      },
    );
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(persistLease.mock.calls.length).toBeLessThanOrEqual(3);
  });
});
