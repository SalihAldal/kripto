import { describe, expect, it } from "vitest";
import {
  computeAlphaStats,
  fundingPnlDuringHold,
  FUTURES_COST,
  grossReturnPct,
  netAfterFuturesCost,
  passesFinalGate,
  passesValidationGate,
  simulateHypothesis,
  type FundingPoint,
  type SymbolMicroPanel,
} from "@/src/server/strategy-architecture/microstructure-alpha-engine.service";

function panelFixture(): SymbolMicroPanel {
  const bars = Array.from({ length: 48 }, (_, i) => {
    const close = 100 + i * 0.1;
    return {
      openTime: i * 3_600_000,
      closeTime: (i + 1) * 3_600_000,
      open: close - 0.05,
      high: close + 0.2,
      low: close - 0.2,
      close,
      volume: 1000,
      quoteVolume: 100_000,
      takerBuyQuote: i % 2 === 0 ? 60_000 : 40_000,
    };
  });
  const funding: FundingPoint[] = [
    { fundingTime: 8 * 3_600_000, fundingRate: -0.001, markPrice: 100 },
    { fundingTime: 16 * 3_600_000, fundingRate: -0.0005, markPrice: 101 },
  ];
  return {
    symbol: "BTCUSDT",
    bars,
    funding,
    basis: bars.map((b) => ({ openTime: b.openTime, closeTime: b.closeTime, premium: -0.002 })),
    openInterest: [],
  };
}

describe("microstructure-alpha-engine", () => {
  it("applies futures round-trip cost", () => {
    expect(netAfterFuturesCost(1, 0, FUTURES_COST.realisticRoundTripPct)).toBeCloseTo(0.78, 2);
  });

  it("computes long and short gross returns", () => {
    expect(grossReturnPct("LONG", 100, 101)).toBeCloseTo(1, 4);
    expect(grossReturnPct("SHORT", 100, 99)).toBeCloseTo(1, 4);
  });

  it("applies funding sign for long vs short", () => {
    const funding: FundingPoint[] = [{ fundingTime: 5_000, fundingRate: 0.001, markPrice: 100 }];
    expect(fundingPnlDuringHold("LONG", funding, 0, 10_000)).toBeCloseTo(-0.1, 4);
    expect(fundingPnlDuringHold("SHORT", funding, 0, 10_000)).toBeCloseTo(0.1, 4);
  });

  it("prevents lookahead by using funding events after entry only", () => {
    const funding: FundingPoint[] = [{ fundingTime: 1_000, fundingRate: 0.001, markPrice: 100 }];
    expect(fundingPnlDuringHold("LONG", funding, 2_000, 10_000)).toBe(0);
  });

  it("validation gate requires positive expectancy and PF", () => {
    expect(
      passesValidationGate({
        trades: 10,
        wins: 6,
        losses: 4,
        grossPnl: 50,
        netPnl: 20,
        expectancy: 2,
        profitFactor: 1.5,
        maxDrawdown: 1,
        longTrades: 5,
        shortTrades: 5,
      }),
    ).toBe(true);
    expect(
      passesValidationGate({
        trades: 10,
        wins: 3,
        losses: 7,
        grossPnl: -10,
        netPnl: -30,
        expectancy: -3,
        profitFactor: 0.4,
        maxDrawdown: 5,
        longTrades: 10,
        shortTrades: 0,
      }),
    ).toBe(false);
  });

  it("final gate mirrors validation with lower trade count", () => {
    expect(
      passesFinalGate({
        trades: 6,
        wins: 4,
        losses: 2,
        grossPnl: 10,
        netPnl: 6,
        expectancy: 1,
        profitFactor: 2,
        maxDrawdown: 0.5,
        longTrades: 3,
        shortTrades: 3,
      }),
    ).toBe(true);
  });

  it("simulates extreme negative funding long hypothesis", () => {
    const panel = panelFixture();
    const trade = simulateHypothesis("FUNDING_EXTREME_NEGATIVE_LONG", panel, 10, "VALIDATION", FUTURES_COST.realisticRoundTripPct);
    expect(trade?.side).toBe("LONG");
    expect(trade?.hypothesis).toBe("FUNDING_EXTREME_NEGATIVE_LONG");
  });

  it("computes alpha stats from trades", () => {
    const stats = computeAlphaStats([
      {
        entryTime: 0,
        exitTime: 1,
        symbol: "BTCUSDT",
        side: "LONG",
        grossReturnPct: 1,
        fundingPnlPct: 0.05,
        feeCostPct: 0.22,
        netReturnPct: 0.83,
        split: "VALIDATION",
        hypothesis: "FUNDING_EXTREME_NEGATIVE_LONG",
        holdHours: 8,
      },
    ]);
    expect(stats.trades).toBe(1);
    expect(stats.netPnl).toBeGreaterThan(0);
  });
});
