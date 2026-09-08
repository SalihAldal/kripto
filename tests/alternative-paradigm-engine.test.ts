import { describe, expect, it } from "vitest";
import {
  computeParadigmStats,
  netAfterCost,
  passesValidationGate,
  PARADIGM_COST,
} from "@/src/server/strategy-architecture/alternative-paradigm-engine.service";

describe("alternative-paradigm-engine", () => {
  it("applies realistic round-trip cost", () => {
    expect(netAfterCost(1.0, PARADIGM_COST.realisticRoundTripPct)).toBeCloseTo(0.56, 2);
  });

  it("validation gate requires positive expectancy and PF", () => {
    expect(passesValidationGate({ trades: 10, wins: 6, losses: 4, grossPnl: 50, netPnl: 20, expectancy: 2, profitFactor: 1.5, maxDrawdown: 1, turnover: 10 })).toBe(true);
    expect(passesValidationGate({ trades: 10, wins: 3, losses: 7, grossPnl: -10, netPnl: -30, expectancy: -3, profitFactor: 0.4, maxDrawdown: 5, turnover: 10 })).toBe(false);
  });

  it("computes paradigm stats from trades", () => {
    const stats = computeParadigmStats([
      { entryTime: 0, exitTime: 1, symbols: ["A"], grossReturnPct: 1.2, netReturnPct: 0.76, split: "VALIDATION", paradigm: "CROSS_SECTIONAL_RELATIVE_STRENGTH" },
      { entryTime: 2, exitTime: 3, symbols: ["B"], grossReturnPct: -0.5, netReturnPct: -0.94, split: "VALIDATION", paradigm: "CROSS_SECTIONAL_RELATIVE_STRENGTH" },
    ]);
    expect(stats.trades).toBe(2);
    expect(stats.netPnl).not.toBe(0);
  });
});
