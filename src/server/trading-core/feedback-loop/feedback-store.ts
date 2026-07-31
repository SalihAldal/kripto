import type { FeedbackCloseTradeInput, FeedbackOpenTradeInput, FeedbackRejectTradeInput, FeedbackSetupStats, FeedbackTradeRecord } from "@/src/server/trading-core/feedback-loop/feedback-loop-types";
import { isSuccessfulNetExit } from "@/src/server/execution/profit-thresholds";

function now() {
  return new Date().toISOString();
}

function setupKey(input: Pick<FeedbackTradeRecord, "botId" | "strategy" | "market" | "strategySnapshot">) {
  const indicators = input.strategySnapshot.indicators;
  const tags = [
    input.botId,
    input.strategy,
    input.market.marketRegime ?? "UNKNOWN",
    indicators?.rsi !== undefined && indicators.rsi < 35 ? "RSI_OVERSOLD" : null,
    indicators?.rsi !== undefined && indicators.rsi > 65 ? "RSI_OVERBOUGHT" : null,
    indicators?.macd?.histogram !== undefined && indicators.macd.histogram > 0 ? "MACD_BULLISH" : null,
    indicators?.macd?.histogram !== undefined && indicators.macd.histogram < 0 ? "MACD_BEARISH" : null,
    indicators?.volumeSpike?.isSpike ? "VOLUME_SPIKE" : null,
    ...(input.strategySnapshot.edgeConditions?.map((condition) => condition.type) ?? []),
  ].filter(Boolean);
  return tags.join(":");
}

export class FeedbackStore {
  private readonly trades = new Map<string, FeedbackTradeRecord>();
  private readonly setupReturns = new Map<string, { record: FeedbackSetupStats; totalReturn: number }>();

  open(input: FeedbackOpenTradeInput): FeedbackTradeRecord {
    const record: FeedbackTradeRecord = {
      ...input,
      openedAt: input.openedAt ?? now(),
      status: "OPEN",
      createdAt: now(),
      updatedAt: now(),
    };
    this.trades.set(record.tradeId, record);
    return record;
  }

  close(input: FeedbackCloseTradeInput): FeedbackTradeRecord {
    const current = this.trades.get(input.tradeId);
    if (!current) throw new Error("Feedback trade not found");
    const closed: FeedbackTradeRecord = {
      ...current,
      status: "CLOSED",
      exitPrice: input.exitPrice,
      realizedPnl: input.realizedPnl,
      returnPercent: input.returnPercent,
      closedAt: input.closedAt ?? now(),
      exitReason: input.exitReason,
      updatedAt: now(),
    };
    this.trades.set(input.tradeId, closed);
    this.recordSetup(closed);
    return closed;
  }

  reject(input: FeedbackRejectTradeInput): FeedbackTradeRecord {
    const record: FeedbackTradeRecord = {
      ...input,
      openedAt: input.openedAt ?? now(),
      status: "REJECTED",
      exitPrice: input.entryPrice,
      realizedPnl: -0.000001,
      returnPercent: -0.05,
      closedAt: input.rejectedAt ?? now(),
      rejectedAt: input.rejectedAt ?? now(),
      exitReason: input.rejectReason,
      createdAt: now(),
      updatedAt: now(),
    };
    this.trades.set(record.tradeId, record);
    this.recordSetup(record);
    return record;
  }

  get(tradeId: string) {
    return this.trades.get(tradeId) ?? null;
  }

  snapshot() {
    const trades = Array.from(this.trades.values());
    return {
      openTrades: trades.filter((trade) => trade.status === "OPEN"),
      closedTrades: trades.filter((trade) => trade.status === "CLOSED").slice(0, 200),
      rejectedTrades: trades.filter((trade) => trade.status === "REJECTED").slice(0, 200),
      setupStats: this.setupStats(),
    };
  }

  setupStats() {
    return Array.from(this.setupReturns.values()).map((item) => item.record).sort((a, b) => b.adaptiveConfidenceScore - a.adaptiveConfidenceScore);
  }

  private recordSetup(trade: FeedbackTradeRecord) {
    const key = setupKey(trade);
    const existing = this.setupReturns.get(key);
    const record = existing?.record ?? {
      setupKey: key,
      botId: trade.botId,
      strategy: trade.strategy,
      marketRegime: trade.market.marketRegime,
      trades: 0,
      wins: 0,
      losses: 0,
      winrate: 0,
      averageReturnPercent: 0,
      adaptiveConfidenceScore: 50,
      dynamicWeight: 1,
      status: "NEUTRAL" as const,
      reasons: [],
      updatedAt: now(),
    };
    const totalReturn = (existing?.totalReturn ?? 0) + (trade.returnPercent ?? 0);
    record.trades += 1;
    const won = trade.status !== "REJECTED" && isSuccessfulNetExit(trade.returnPercent);
    record.wins += won ? 1 : 0;
    record.losses += trade.status === "REJECTED" || !won ? 1 : 0;
    record.winrate = Number((record.wins / Math.max(1, record.trades) * 100).toFixed(2));
    record.averageReturnPercent = Number((totalReturn / Math.max(1, record.trades)).toFixed(4));
    record.adaptiveConfidenceScore = Number(Math.max(0, Math.min(100, 50 + record.averageReturnPercent * 12 + (record.winrate - 50) * 0.55)).toFixed(2));
    record.dynamicWeight = Number(Math.max(0.15, Math.min(2.5, record.adaptiveConfidenceScore / 55)).toFixed(4));
    record.status = record.trades >= 3 && record.adaptiveConfidenceScore >= 68 ? "BOOSTED" : record.trades >= 3 && record.adaptiveConfidenceScore <= 35 ? "BLACKLISTED" : "NEUTRAL";
    record.reasons = [
      `market=${record.marketRegime ?? "UNKNOWN"}`,
      `winrate=${record.winrate}%`,
      `avgReturn=${record.averageReturnPercent}%`,
      `status=${record.status}`,
    ];
    record.updatedAt = now();
    this.setupReturns.set(key, { record, totalReturn });
  }
}
