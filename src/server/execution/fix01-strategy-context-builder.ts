import { getMarketDataDaemon } from "@/src/server/market-data/spine/market-data-daemon";
import type { DeepMarketState, MarketTradeEvent } from "@/src/server/market-data/spine/events";
import type { EarlyContextExtension } from "@/src/server/profitability/pr02-types";
import type { CausalCandle, StrategyContextExtension } from "@/src/server/profitability/pr03-types";

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
  schemaVersion: "fix01-strategy-context-v1";
};

export type StrategyContextBuildResult = {
  earlyContext: EarlyContextExtension;
  strategyContext: StrategyContextExtension;
  dataCoverage: StrategyContextDataCoverage;
};

function tradeEventAt(trade: MarketTradeEvent) {
  return trade.tradeTime || trade.eventTime || trade.receiveTime;
}

export function filterTradesAtDecision(trades: MarketTradeEvent[], decisionAtMs: number): MarketTradeEvent[] {
  return trades.filter((trade) => tradeEventAt(trade) <= decisionAtMs);
}

export function klinesToCausalCandles(
  klines: DeepMarketState["klines1m"],
  decisionAtMs: number,
): CausalCandle[] {
  const rows: CausalCandle[] = [];
  for (const kline of klines) {
    if (kline.openTime > decisionAtMs) continue;
    const closed = kline.closeTime <= decisionAtMs;
    if (!closed) {
      rows.push({
        openTime: kline.openTime,
        closeTime: kline.closeTime,
        open: kline.open,
        high: kline.open,
        low: kline.open,
        close: kline.open,
        volume: 0,
        closed: false,
        availableAt: decisionAtMs,
      });
      continue;
    }
    const availableAt = kline.closeTime;
    if (availableAt > decisionAtMs) continue;
    rows.push({
      openTime: kline.openTime,
      closeTime: kline.closeTime,
      open: kline.open,
      high: kline.high,
      low: kline.low,
      close: kline.close,
      volume: kline.volume,
      closed: true,
      availableAt,
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
  const book =
    bookTicker &&
    (bookTicker.lastUpdateAt || bookTicker.eventTime) <= input.decisionAtMs &&
    !bookTicker.stale
      ? bookTicker
      : null;

  const baselinePrice = input.baselinePrice ?? trades.at(-1)?.price ?? null;
  const firstDetectionPrice = input.firstDetectionPrice ?? baselinePrice ?? null;

  const missingReasons: string[] = [];
  if (!trades.length) missingReasons.push("TRADES_MISSING");
  if (!candles.length) missingReasons.push("CANDLES_MISSING");
  if (!book) missingReasons.push("BOOK_MISSING");

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
      schemaVersion: "fix01-strategy-context-v1",
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
