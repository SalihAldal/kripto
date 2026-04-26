import type { AIAnalysisInput } from "@/src/types/ai";
import type { MarketContext } from "@/src/types/scanner";
import { getKlines, getOrderBook, getRecentTrades } from "@/services/binance.service";
import { getMarketSnapshot } from "@/src/server/scanner/market-snapshot-cache";
import { buildMultiTimeframeAnalysis } from "@/src/server/ai/multi-timeframe.service";

export async function formatAIRequest(
  context: MarketContext,
  strategyParams?: Record<string, unknown>,
  riskSettings?: AIAnalysisInput["riskSettings"],
): Promise<AIAnalysisInput> {
  const cached = getMarketSnapshot(context.symbol);
  const [baseSnapshot, klines5m, klines15m, klines1h, klines4h, klines1d] = await Promise.all([
    cached
      ? Promise.resolve({
          klines: cached.klines,
          orderBook: cached.orderBook,
          recentTrades: cached.recentTrades,
        })
      : Promise.all([
          getKlines(context.symbol, "1m", 80),
          getOrderBook(context.symbol, 30),
          getRecentTrades(context.symbol, 150),
        ]).then(([klines, orderBook, recentTrades]) => ({ klines, orderBook, recentTrades })),
    getKlines(context.symbol, "5m", 80),
    getKlines(context.symbol, "15m", 80),
    getKlines(context.symbol, "1h", 80),
    getKlines(context.symbol, "4h", 80),
    getKlines(context.symbol, "1d", 80),
  ]);
  const { klines, orderBook, recentTrades } = baseSnapshot;
  const mtf = buildMultiTimeframeAnalysis({
    m1: klines,
    m5: klines5m,
    m15: klines15m,
    h1: klines1h,
    h4: klines4h,
    d1: klines1d,
  });

  const buyVolume = recentTrades
    .filter((x) => !x.isBuyerMaker)
    .reduce((acc, x) => acc + x.qty * x.price, 0);
  const sellVolume = recentTrades
    .filter((x) => x.isBuyerMaker)
    .reduce((acc, x) => acc + x.qty * x.price, 0);
  const bidDepth = orderBook.bids.reduce((acc, x) => acc + x.quantity * x.price, 0);
  const askDepth = orderBook.asks.reduce((acc, x) => acc + x.quantity * x.price, 0);

  return {
    symbol: context.symbol,
    lastPrice: context.lastPrice,
    klines,
    volume24h: context.volume24h,
    orderBookSummary: {
      bestBid: orderBook.bids[0]?.price ?? context.lastPrice,
      bestAsk: orderBook.asks[0]?.price ?? context.lastPrice,
      bidDepth,
      askDepth,
    },
    recentTradesSummary: {
      buyVolume,
      sellVolume,
      buySellRatio: Number((buyVolume / Math.max(sellVolume, 0.0001)).toFixed(4)),
    },
    spread: context.spreadPercent,
    volatility: context.volatilityPercent,
    marketSignals: {
      change24h: context.change24h,
      shortMomentumPercent: Number(context.metadata.shortMomentumPercent ?? 0),
      shortFlowImbalance: Number(context.metadata.shortFlowImbalance ?? 0),
      tradeVelocity: Number(context.metadata.tradeVelocity ?? 0),
      // Harici kaynak bagli degilse notr default ile aciklanabilir karar korunur.
      btcDominanceBias: Number(context.metadata.btcDominanceBias ?? 0),
      socialSentimentScore: Number(context.metadata.socialSentimentScore ?? 50),
      newsSentiment: "NEUTRAL",
    },
    marketRegime: {
      mode: String(context.metadata.marketRegime ?? "RANGE_SIDEWAYS") as NonNullable<AIAnalysisInput["marketRegime"]>["mode"],
      confidenceScore: Number(context.metadata.marketRegimeConfidenceScore ?? 60),
      reason: String(context.metadata.marketRegimeReason ?? "Regime not resolved"),
      marketSummary: String(context.metadata.marketRegimeSummary ?? "Regime summary not available"),
      selectedStrategy: String(context.metadata.marketRegimeStrategy ?? "RANGE_MEAN_REVERSION"),
      allowedStrategyTypes: Array.isArray(context.metadata.marketRegimeAllowedStrategies)
        ? (context.metadata.marketRegimeAllowedStrategies as string[])
        : ["RANGE_MEAN_REVERSION"],
      forbiddenStrategyTypes: Array.isArray(context.metadata.marketRegimeForbiddenStrategies)
        ? (context.metadata.marketRegimeForbiddenStrategies as string[])
        : [],
      tradingAggressiveness: String(
        context.metadata.marketRegimeTradingAggressiveness ?? "MEDIUM",
      ) as NonNullable<AIAnalysisInput["marketRegime"]>["tradingAggressiveness"],
      entryThresholdScore: Number(context.metadata.marketRegimeEntryThresholdScore ?? 65),
      openTradeAllowed: Boolean(context.metadata.marketRegimeOpenTradeAllowed ?? true),
      tpMultiplier: Number(context.metadata.marketRegimeTpMultiplier ?? 1),
      slMultiplier: Number(context.metadata.marketRegimeSlMultiplier ?? 1),
      riskMultiplier: Number(context.metadata.marketRegimeRiskMultiplier ?? 1),
    },
    multiTimeframe: {
      higher: mtf.higher,
      mid: mtf.mid,
      lower: mtf.lower,
      entry: mtf.entry,
      trend: mtf.trend,
      macro: mtf.macro,
      dominantTrend: mtf.dominantTrend,
      alignmentScore: mtf.alignmentScore,
      conflict: mtf.conflict,
      trendAligned: mtf.trendAligned,
      entrySuitable: mtf.entrySuitable,
      conflictingSignals: mtf.conflictingSignals,
      finalAlignmentSummary: mtf.finalAlignmentSummary,
      reason: mtf.reason,
    },
    strategyParams,
    riskSettings,
  };
}
