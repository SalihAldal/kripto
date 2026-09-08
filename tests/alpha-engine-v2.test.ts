import { describe, expect, it } from "vitest";
import { applyAiOverlay } from "@/src/server/alpha-engine-v2/ai-overlay.service";
import { netAfterCost, grossReturnPct, fundingPnlDuringHold } from "@/src/server/alpha-engine-v2/cost-model-v2.service";
import { assertNoLookahead, LookaheadViolationError } from "@/src/server/alpha-engine-v2/lookahead-guard";
import { selectPortfolioSignals } from "@/src/server/alpha-engine-v2/portfolio-layer.service";
import {
  computeAlphaStats,
  passesFinalGate,
  passesValidationGate,
} from "@/src/server/alpha-engine-v2/validation-framework.service";
import type { AlphaSignal, AlphaTradeRecord } from "@/src/server/alpha-engine-v2/types";

describe("alpha-engine-v2", () => {
  it("applies realistic futures cost", () => {
    expect(netAfterCost(1, 0, 0.22)).toBeCloseTo(0.78, 2);
  });

  it("computes long and short pnl", () => {
    expect(grossReturnPct("LONG", 100, 102)).toBeCloseTo(2, 4);
    expect(grossReturnPct("SHORT", 100, 98)).toBeCloseTo(2, 4);
  });

  it("applies funding sign correctly", () => {
    const events = [{ fundingTime: 5000, fundingRate: 0.001 }];
    expect(fundingPnlDuringHold("LONG", events, 0, 10_000)).toBeCloseTo(-0.1, 4);
    expect(fundingPnlDuringHold("SHORT", events, 0, 10_000)).toBeCloseTo(0.1, 4);
  });

  it("blocks lookahead", () => {
    expect(() => assertNoLookahead(1000, 2000, "rsi")).toThrow(LookaheadViolationError);
  });

  it("validation gate requires positive expectancy", () => {
    expect(passesValidationGate({ trades: 10, wins: 6, losses: 4, grossPnl: 50, netPnl: 20, expectancy: 2, profitFactor: 1.5, maxDrawdown: 1, longTrades: 5, shortTrades: 5, cashSkips: 0 })).toBe(true);
    expect(passesValidationGate({ trades: 10, wins: 3, losses: 7, grossPnl: -10, netPnl: -30, expectancy: -3, profitFactor: 0.4, maxDrawdown: 5, longTrades: 10, shortTrades: 0, cashSkips: 0 })).toBe(false);
  });

  it("final gate allows lower sample", () => {
    expect(passesFinalGate({ trades: 6, wins: 4, losses: 2, grossPnl: 10, netPnl: 6, expectancy: 1, profitFactor: 2, maxDrawdown: 0.5, longTrades: 3, shortTrades: 3, cashSkips: 0 })).toBe(true);
  });

  it("dedupes portfolio symbols", () => {
    const signals: AlphaSignal[] = [
      { alphaId: "a", module: "m", version: "1", symbol: "BTCUSDT", venue: "FUTURES", side: "LONG", timestamp: 1, horizon: "8h", confidence: 80, expectedEdgeBps: 50, expectedCostBps: 22, expectedNetEdgeBps: 28, reasonCodes: [], metadata: {} },
      { alphaId: "a", module: "m", version: "1", symbol: "BTCUSDT", venue: "FUTURES", side: "LONG", timestamp: 1, horizon: "8h", confidence: 70, expectedEdgeBps: 40, expectedCostBps: 22, expectedNetEdgeBps: 18, reasonCodes: [], metadata: {} },
    ];
    const decisions = selectPortfolioSignals(signals, { maxPositions: 3, maxPerSymbol: 1, capital: 10_000, notionalPerTrade: 1000 });
    expect(decisions.filter((d) => d.accepted)).toHaveLength(1);
    expect(decisions.filter((d) => d.rejectedBecause === "DUPLICATE_SYMBOL")).toHaveLength(1);
  });

  it("ai overlay can veto anomaly", () => {
    const signal: AlphaSignal = {
      alphaId: "a", module: "m", version: "1", symbol: "ETHUSDT", venue: "FUTURES", side: "LONG", timestamp: 1, horizon: "8h", confidence: 80, expectedEdgeBps: 50, expectedCostBps: 22, expectedNetEdgeBps: 28, reasonCodes: [], metadata: {},
    };
    expect(applyAiOverlay(signal, { anomalyScore: 90 }).decision).toBe("VETO");
  });

  it("computes alpha stats excluding cash", () => {
    const trades: AlphaTradeRecord[] = [
      { entryTime: 0, exitTime: 1, symbol: "BTCUSDT", side: "LONG", grossReturnPct: 1, fundingPnlPct: 0, feeCostPct: 0.22, netReturnPct: 0.78, split: "VALIDATION", alphaId: "X" },
      { entryTime: 2, exitTime: 2, symbol: "BTCUSDT", side: "CASH", grossReturnPct: 0, fundingPnlPct: 0, feeCostPct: 0, netReturnPct: 0, split: "VALIDATION", alphaId: "X" },
    ];
    const stats = computeAlphaStats(trades);
    expect(stats.trades).toBe(1);
    expect(stats.cashSkips).toBe(1);
  });
});
