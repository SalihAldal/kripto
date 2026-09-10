import { afterEach, describe, expect, it, vi } from "vitest";
import { tradingConfig } from "@/src/server/trading-core/config";
import {
  capturePaperStrategySnapshot,
  getPaperStrategySnapshot,
  guardPaperStrategyMutation,
  resolveApplyLearningForPaper,
} from "@/src/server/forensics/paper-strategy-freeze.service";
import { selfLearningEngine } from "@/src/server/trading-core/self-learning";
import { feedbackLoopEngine } from "@/src/server/trading-core/feedback-loop";

vi.mock("@/src/server/db/prisma", () => ({
  prisma: {
    appSetting: { findUnique: vi.fn(async () => null), upsert: vi.fn(async (x: unknown) => x) },
    $transaction: vi.fn(async (x: Promise<unknown>[]) => Promise.all(x)),
  },
}));

const learningInput = {
  tradeId: "freeze-trade-1",
  botId: "scalping-bot",
  strategy: "rsi-macd",
  symbol: "BTCTRY",
  side: "BUY" as const,
  realizedPnl: -12,
  returnPercent: -0.8,
  entryPrice: 100,
  exitPrice: 99.2,
  maxDurationSec: 120,
  targetProfitPercent: 1.2,
  stopLossPercent: 0.8,
  qualityScore: 55,
  marketRegime: "RANGE",
  openedAt: new Date("2026-09-09T20:00:00.000Z").toISOString(),
  closedAt: new Date("2026-09-09T20:02:00.000Z").toISOString(),
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("paper strategy freeze", () => {
  it("captures a stable strategy snapshot hash for the campaign", () => {
    vi.stubEnv("EXECUTION_MODE", "paper");
    vi.stubEnv("PAPER_STRATEGY_FREEZE_ENABLED", "true");
    const snapshot = capturePaperStrategySnapshot();
    expect(snapshot.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(getPaperStrategySnapshot()?.hash).toBe(snapshot.hash);
    expect(snapshot.strategies["rsi-macd"]?.minScore).toBe(tradingConfig.getStrategy("rsi-macd").minScore);
  });

  it("blocks self-learning apply mutations during paper freeze", async () => {
    vi.stubEnv("EXECUTION_MODE", "paper");
    vi.stubEnv("PAPER_STRATEGY_FREEZE_ENABLED", "true");
    const before = tradingConfig.getStrategy("rsi-macd").minScore;
    const report = await selfLearningEngine.learn(learningInput, true);
    expect(resolveApplyLearningForPaper(true)).toBe(false);
    expect(guardPaperStrategyMutation()).toBe(false);
    expect(tradingConfig.getStrategy("rsi-macd").minScore).toBe(before);
    expect(report.tradeId).toBe(learningInput.tradeId);
  });

  it("blocks feedback-loop adaptive config mutations during paper freeze", async () => {
    vi.stubEnv("EXECUTION_MODE", "paper");
    vi.stubEnv("PAPER_STRATEGY_FREEZE_ENABLED", "true");
    const beforeStrategy = tradingConfig.getStrategy("rsi-macd").minScore;
    const beforeBot = tradingConfig.getBot("scalping-bot")?.minScore;
    feedbackLoopEngine.openTrade({
      tradeId: "freeze-feedback-1",
      botId: "scalping-bot",
      strategy: "rsi-macd",
      symbol: "BTCTRY",
      side: "BUY",
      entryPrice: 100,
      quantity: 1,
      market: { marketRegime: "RANGE", volatilityPercent: 1.2, spreadPercent: 0.02, liquidityUsd: 50000 },
      strategySnapshot: {
        strategy: "rsi-macd",
        confidenceScore: 72,
        minScore: beforeStrategy,
        params: { qualityScore: 55, maxDurationSec: 120, targetProfitPercent: 1.2, stopLossPercent: 0.8 },
      },
      openedAt: new Date("2026-09-09T20:00:00.000Z").toISOString(),
    });
    await feedbackLoopEngine.closeTrade({
      tradeId: "freeze-feedback-1",
      exitPrice: 99,
      realizedPnl: -1,
      returnPercent: -1,
      closedAt: new Date("2026-09-09T20:02:00.000Z").toISOString(),
      exitReason: "STOP_LOSS",
      applyLearning: true,
    });
    expect(tradingConfig.getStrategy("rsi-macd").minScore).toBe(beforeStrategy);
    expect(tradingConfig.getBot("scalping-bot")?.minScore).toBe(beforeBot);
  });
});
