import { getMarketDataDaemon } from "@/src/server/market-data/spine/market-data-daemon";
import type { DeepMarketState, MarketTradeEvent } from "@/src/server/market-data/spine/events";
import type { EarlyContextExtension } from "@/src/server/profitability/pr02-types";
import type { CausalCandle, StrategyContextExtension } from "@/src/server/profitability/pr03-types";
import type { KlineItem } from "@/src/types/exchange";

export type StrategyContextBuildInput = {
  symbol: string;
  venue?: string | null;
  candidateId: string;
  lifecycleId: string;
  featureSnapshotId: string;
  decisionAtMs: number;
  baselinePrice?: number | null;
  firstDetectionPrice?: number | null;
  intendedNotional?: number;
  deepState?: DeepMarketState | null;
};

export type StrategyContextDataCoverage = {
  tradeCount: number;
  candleCount: number;
  closedCandleCount: number;
  bookPresent: boolean;
  hasProducerData: boolean;
  missingReasons: string[];
  dataSource: "MARKET_DATA_DAEMON" | "INJECTED_DEEP_STATE";
  schemaVersion: "fix01-strategy-context-v2";
};

export type StrategyContextBuildResult = {
  earlyContext: EarlyContextExtension;
  strategyContext: StrategyContextExtension;
  dataCoverage: StrategyContextDataCoverage;
};

export function tradeEventAtMs(trade: MarketTradeEvent) {
  return trade.tradeTime || trade.eventTime;
}

export function tradeAvailableAtMs(trade: MarketTradeEvent) {
  return trade.receiveTime;
}

export function filterTradesAtDecision(trades: MarketTradeEvent[], decisionAtMs: number): MarketTradeEvent[] {
  return trades.filter((trade) => {
    const eventAt = tradeEventAtMs(trade);
    const availableAt = tradeAvailableAtMs(trade);
    return eventAt <= decisionAtMs && availableAt <= decisionAtMs;
  });
}

function klineRevisionAtDecision(kline: KlineItem, decisionAtMs: number): KlineItem | null {
  const eventAt = klineEventAtMs(kline);
  if (eventAt > decisionAtMs) return null;
  const availableAt = kline.availableAt;
  if (availableAt == null) return null;
  if (availableAt > decisionAtMs) return null;
  return kline;
}

function klineEventAtMs(kline: KlineItem) {
  if (kline.closed === false) return kline.openTime;
  return kline.eventAt ?? kline.closeTime;
}

export function klinesToCausalCandles(
  klines: DeepMarketState["klines1m"],
  decisionAtMs: number,
): CausalCandle[] {
  const rows: CausalCandle[] = [];
  for (const kline of klines) {
    const eventAt = klineEventAtMs(kline);
    if (eventAt > decisionAtMs) continue;
    const revision = klineRevisionAtDecision(kline, decisionAtMs);
    if (!revision) continue;
    const closed = revision.closed === true && revision.closeTime <= decisionAtMs;
    if (!closed) {
      rows.push({
        openTime: revision.openTime,
        closeTime: revision.closeTime,
        open: revision.open,
        high: revision.open,
        low: revision.open,
        close: revision.open,
        volume: 0,
        closed: false,
        availableAt: revision.availableAt!,
      });
      continue;
    }
    rows.push({
      openTime: revision.openTime,
      closeTime: revision.closeTime,
      open: revision.open,
      high: revision.high,
      low: revision.low,
      close: revision.close,
      volume: revision.volume,
      closed: true,
      availableAt: revision.availableAt!,
    });
  }
  return rows.filter((row) => row.availableAt <= decisionAtMs);
}

export function buildStrategyEvaluationContexts(input: StrategyContextBuildInput): StrategyContextBuildResult {
  const injected = input.deepState != null;
  const deep = input.deepState ?? getMarketDataDaemon().getDeepState(input.symbol);
  const trades = filterTradesAtDecision(deep?.recentTrades ?? [], input.decisionAtMs);
  const candles = klinesToCausalCandles(deep?.klines1m ?? [], input.decisionAtMs);
  const bookTicker = deep?.bookTicker ?? null;
  const bookAvailableAt = bookTicker ? bookTicker.lastUpdateAt || bookTicker.eventTime : null;
  const book =
    bookTicker && bookAvailableAt != null && bookAvailableAt <= input.decisionAtMs && !bookTicker.stale
      ? bookTicker
      : null;

  const baselinePrice =
    input.baselinePrice ?? (trades.length ? trades[trades.length - 1]!.price : null);
  const firstDetectionPrice = input.firstDetectionPrice ?? input.baselinePrice ?? null;

  const missingReasons: string[] = [];
  if (!trades.length) missingReasons.push("TRADES_MISSING");
  if (!candles.length) missingReasons.push("CANDLES_MISSING");
  if (!book) missingReasons.push("BOOK_MISSING");
  if (baselinePrice == null) missingReasons.push("BASELINE_PRICE_MISSING");
  if (firstDetectionPrice == null) missingReasons.push("FIRST_DETECTION_PRICE_MISSING");

  const earlyContext: EarlyContextExtension = {
    trades,
    book,
    baselinePrice: baselinePrice ?? 0,
    firstDetectionPrice: firstDetectionPrice ?? 0,
    intendedNotional: input.intendedNotional ?? 500,
    featureSnapshotId: input.featureSnapshotId,
    lifecycleId: input.lifecycleId,
    nowMs: input.decisionAtMs,
  };

  const strategyContext: StrategyContextExtension = {
    symbol: input.symbol,
    venue: input.venue ?? undefined,
    trades,
    book,
    candles,
    lifecycleId: input.lifecycleId,
    featureSnapshotId: input.featureSnapshotId,
    nowMs: input.decisionAtMs,
  };

  return {
    earlyContext,
    strategyContext,
    dataCoverage: {
      schemaVersion: "fix01-strategy-context-v2",
      tradeCount: trades.length,
      candleCount: candles.length,
      closedCandleCount: candles.filter((row) => row.closed).length,
      bookPresent: book != null,
      hasProducerData: trades.length > 0 || candles.length > 0,
      missingReasons,
      dataSource: injected ? "INJECTED_DEEP_STATE" : "MARKET_DATA_DAEMON",
    },
  };
}
