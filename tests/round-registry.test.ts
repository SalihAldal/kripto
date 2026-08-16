import { beforeEach, describe, expect, it } from "vitest";
import {
  atomicAcquireRoundOwnership,
  getRoundRegistrySnapshot,
  resetRoundRegistryForTests,
  roundRegistry,
} from "@/src/server/execution/round-registry.service";

const stressLevels = [25, 50, 100];

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("round registry exclusive ownership", () => {
  beforeEach(() => {
    resetRoundRegistryForTests();
  });

  it.each(stressLevels)("handles %i concurrent ownership requests for one round", async (count) => {
    const jobId = "job-round-stress";
    const roundNo = 58;
    let createCount = 0;
    let resolveCreated!: () => void;
    const created = new Promise<void>((resolve) => {
      resolveCreated = resolve;
    });

    const results = await Promise.all(
      Array.from({ length: count }, () =>
        atomicAcquireRoundOwnership({
          jobId,
          roundNo,
          ownerId: "owner-a",
          persistAcquire: async () => {
            createCount += 1;
            if (createCount === 1) resolveCreated();
            await wait(5);
            return { action: createCount === 1 ? "created" : "attached", runId: `run-${roundNo}-canonical` };
          },
        }),
      ),
    );

    await created;

    const acquired = results.filter((row) => row.action === "acquired");
    const attached = results.filter((row) => row.action === "attached");
    const runIds = new Set(results.map((row) => row.record?.runId).filter(Boolean));

    expect(acquired.length).toBe(1);
    expect(acquired.length + attached.length).toBe(count);
    expect(createCount).toBe(1);
    expect(runIds.size).toBe(1);
    expect(getRoundRegistrySnapshot().activeCount).toBe(1);
    expect(roundRegistry.size).toBe(1);
  });

  it("attaches to existing ownership instead of recreating", async () => {
    const first = await atomicAcquireRoundOwnership({
      jobId: "job-a",
      roundNo: 1,
      ownerId: "owner-a",
      persistAcquire: async () => ({ action: "created", runId: "run-1" }),
    });
    const second = await atomicAcquireRoundOwnership({
      jobId: "job-a",
      roundNo: 1,
      ownerId: "owner-a",
      persistAcquire: async () => ({ action: "created", runId: "run-should-not-be-used" }),
    });

    expect(first.action).toBe("acquired");
    expect(second.action).toBe("attached");
    expect(first.record?.runId).toBe(second.record?.runId);
  });
});
