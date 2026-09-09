import { describe, expect, it } from "vitest";
import { schedulePumpScan, attemptedPumpCursor } from "@/src/server/scanner/pump-scan-scheduler";
describe("pump discovery scheduling", () => {
  it("covers the entire watchlist even when hot leaders fill every scan", () => {
    const watchlist = Array.from({ length: 101 }, (_, i) => `COIN${i}TRY`);
    const leaders = Array.from({ length: 60 }, (_, i) => `HOT${i}TRY`);
    const seen = new Set<string>(); let cursor = 0;
    for (let i = 0; i < 9; i++) {
      const batch = schedulePumpScan({ watchlist, leaders, cursor, limit: 36, discoveryBatchSize: 24 });
      expect(batch.symbols).toHaveLength(36);
      expect(new Set(batch.symbols).size).toBe(36);
      expect(batch.symbols.slice(0, 12)).toEqual(batch.discoverySymbols);
      batch.symbols.forEach(s => seen.add(s)); cursor = batch.nextCursor;
    }
    expect(watchlist.every(s => seen.has(s))).toBe(true);
  });
  it("handles overlaps, tiny budgets and empty universes", () => {
    expect(schedulePumpScan({ leaders: ["A", "A", "B"], watchlist: ["A", "B", "B"], cursor: 0, limit: 8, discoveryBatchSize: 6 }).symbols).toEqual(["A", "B"]);
    expect(schedulePumpScan({ leaders: ["HOT"], watchlist: ["A", "B"], cursor: 1, limit: 1, discoveryBatchSize: 6 }).symbols).toEqual(["B"]);
    expect(schedulePumpScan({ leaders: ["HOT"], watchlist: [], cursor: 20, limit: 2, discoveryBatchSize: 6 }).symbols).toEqual(["HOT"]);
  });
  it("does not skip queued discovery names when a deadline stops the scan", () => {
    const watchlist = ["A", "B", "C", "D", "E", "F"];
    const batch = schedulePumpScan({ leaders: [], watchlist, cursor: 0, limit: 6, discoveryBatchSize: 6 });
    expect(attemptedPumpCursor(watchlist, 0, batch.discoverySymbols, new Set())).toBe(0);
    expect(attemptedPumpCursor(watchlist, 0, batch.discoverySymbols, new Set(["A"]))).toBe(1);
    expect(attemptedPumpCursor(watchlist, 0, batch.discoverySymbols, new Set(["B"]))).toBe(0);
  });
});
