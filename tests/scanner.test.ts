import { describe, expect, it } from "vitest";
import { rankCandidates } from "../src/server/scanner/candidate-ranking.service";
import { scoreContext } from "../src/server/scanner/signal-scoring.engine";
import type { MarketContext } from "../src/types/scanner";

function context(symbol: string, momentum = 0.8): MarketContext {
  return {
    symbol,
    lastPrice: 100,
    change24h: 1.2,
    volume24h: 20_000_000,
    spreadPercent: 0.08,
    volatilityPercent: 1.3,
    momentumPercent: momentum,
    orderBookImbalance: 0.2,
    buyPressure: 0.62,
    shortCandleSignal: 2,
    fakeSpikeScore: 0.3,
    tradable: true,
    rejectReasons: [],
    metadata: {},
  };
}

describe("scanner", () => {
  it("scores context as qualified", () => {
    const score = scoreContext(context("BTCUSDT"));
    expect(score.score).toBeGreaterThan(0);
    expect(["QUALIFIED", "REJECTED"]).toContain(score.status);
  });

  it("ranks candidates by score desc", () => {
    const rows = [
      { context: context("AAAUSDT", 0.5), score: scoreContext(context("AAAUSDT", 0.5)) },
      { context: context("BBBUSDT", 1.0), score: scoreContext(context("BBBUSDT", 1.0)) },
    ];
    const ranked = rankCandidates(rows, 2);
    expect(ranked[0].score.score).toBeGreaterThanOrEqual(ranked[1].score.score);
  });
});
