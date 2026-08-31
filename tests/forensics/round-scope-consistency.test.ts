import { describe, expect, it } from "vitest";
import { filterByRun } from "@/src/server/forensics/round-forensic-export.service";

describe("round scope consistency filter", () => {
  it("keeps only rows that match same run or round window", () => {
    const runId = "run-1";
    const roundId = "1";
    const roundNo = 1;
    const startedAtMs = Date.parse("2026-08-22T21:35:00.000Z");
    const endedAtMs = Date.parse("2026-08-22T21:50:00.000Z");
    const rows = [
      { id: "a", runId, timestamp: "2026-08-22T21:40:00.000Z" },
      { id: "b", roundId, timestamp: "2026-08-22T21:40:00.000Z" },
      { id: "c", metadata: { runId }, timestamp: "2026-08-22T21:00:00.000Z" },
      { id: "d", timestamp: "2026-08-22T21:41:00.000Z" },
      { id: "e", timestamp: "2026-08-22T22:10:00.000Z" },
    ];
    const filtered = filterByRun({
      rows,
      runId,
      roundId,
      roundNo,
      startedAtMs,
      endedAtMs,
    });
    expect(filtered.map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("drops unrelated rows when candidateCount window is empty", () => {
    const filtered = filterByRun({
      rows: [
        { id: "old", timestamp: "2026-08-22T20:00:00.000Z" },
        { id: "other-run", runId: "run-2", timestamp: "2026-08-22T21:40:00.000Z" },
      ],
      runId: "run-1",
      roundId: "3",
      roundNo: 3,
      startedAtMs: Date.parse("2026-08-22T21:35:00.000Z"),
      endedAtMs: Date.parse("2026-08-22T21:50:00.000Z"),
    });
    expect(filtered).toHaveLength(0);
  });
});

