import type { ExecutionMarketSnapshot } from "@/src/server/execution/execution-market-snapshot.service";
import { assessKlineInput } from "@/src/server/market-data/kline-input-contract.service";
import type { AIAnalysisInput } from "@/src/types/ai";
import type { MarketContext } from "@/src/types/scanner";
import { marketDataGateway } from "@/src/server/market-data/market-data-gateway";
import { isMarketDataUnavailableError } from "@/src/server/market-data/market-data-unavailable.error";
import { ensureFreshKlineContext } from "@/src/server/market-data/ensure-fresh-kline-context.service";
import { getMarketSnapshot } from "@/src/server/scanner/market-snapshot-cache";
import { buildMultiTimeframeAnalysis } from "@/src/server/ai/multi-timeframe.service";
import { getAIAnalysisMemoryContext } from "@/src/server/ai/ai-analysis-memory.service";
import { getMarketDataDaemon } from "@/src/server/market-data/spine/market-data-daemon";
import { logTradeEvent } from "@/src/server/observability/trade-event-log";

async function fromRamOrEmpty<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isMarketDataUnavailableError(error)) return fallback;
    throw error;
  }
}

export async function formatAIRequest(
  context: MarketContext,
  strategyParams?: Record<string, unknown>,
  riskSettings?: AIAnalysisInput["riskSettings"],
  executionSnapshot?: ExecutionMarketSnapshot,
): Promise<AIAnalysisInput> {
  if (!executionSnapshot) getMarketDataDaemon().subscribeDeep(context.symbol, "scanner-ai");
  if (executionSnapshot && executionSnapshot.symbol !== context.symbol) throw new Error("EXECUTION_SNAPSHOT_SYMBOL_MISMATCH");
  const cached = executionSnapshot ? null : getMarketSnapshot(context.symbol);
  const cachedUsable = Boolean(
    cached &&
      (cached.klines.some((row) => Number(row.volume ?? 0) > 0) ||
        cached.orderBook.bids.some((row) => row.quantity > 0) ||
        cached.orderBook.asks.some((row) => row.quantity > 0) ||
        cached.recentTrades.some((row) => row.qty > 0)),
  );
  const allowCached = cachedUsable && !(context.metadata as { liteSnapshot?: boolean } | undefined)?.liteSnapshot;
  const klineContext = executionSnapshot ? {
    ...assessKlineInput({ klines: executionSnapshot.bundle.klines1m, nowMs: Date.now() }),
    interval: "1m", klines: executionSnapshot.bundle.klines1m, source: "execution_venue_snapshot",
    refreshed: true, refreshAttempted: true, refreshSucceeded: true,
  } : await ensureFreshKlineContext({
    symbol: context.symbol,
    interval: "1m",
    limit: 80,
    existingKlines: allowCached ? cached?.klines : undefined,
  });
  await logTradeEvent({
    symbol: context.symbol,
    eventType: "AI_KLINE_INPUT",
    price: context.lastPrice,
    newValue: {
      symbol: context.symbol,
      venue: String(context.metadata?.venue ?? context.metadata?.exchangeVenue ?? "UNKNOWN"),
      interval: klineContext.interval,
      count: klineContext.count,
      source: klineContext.source,
      lastOpenTime: klineContext.lastOpenTime,
      lastCloseTime: klineContext.lastCloseTime,
      ageSec: klineContext.ageSec,
      fresh: klineContext.fresh,
      refreshed: klineContext.refreshed,
      refreshAttempted: klineContext.refreshAttempted,
      refreshSucceeded: klineContext.refreshSucceeded,
      reasonCode: klineContext.reasonCode,
    },
  });
  const [orderBook, recentTrades, klines5m, klines15m, klines1h, klines4h, klines1d] = await Promise.all([
    executionSnapshot ? Promise.resolve(executionSnapshot.bundle.orderBook!) : allowCached
      ? Promise.resolve(cached!.orderBook)
      : fromRamOrEmpty(
          () => marketDataGateway.getOrderBook(context.symbol, 30),
          { lastUpdateId: 0, bids: [], asks: [] },
        ),
    executionSnapshot ? Promise.resolve(executionSnapshot.bundle.recentTrades ?? []) : allowCached
      ? Promise.resolve(cached!.recentTrades)
      : fromRamOrEmpty(() => marketDataGateway.getRecentTrades(context.symbol, 150), []),
    Promise.resolve(executionSnapshot?.timeframes["5m"] ?? []),
    Promise.resolve(executionSnapshot?.timeframes["15m"] ?? []),
    Promise.resolve(executionSnapshot?.timeframes["1h"] ?? []),
    Promise.resolve(executionSnapshot?.timeframes["4h"] ?? []),
    Promise.resolve(executionSnapshot?.timeframes["1d"] ?? []),
  ]);
  const klines = klineContext.klines;
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

  const aiInput: AIAnalysisInput = {
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
      shortTradeCount: Number(context.metadata.shortTradeCount ?? 0),
      tradeVelocity: Number(context.metadata.tradeVelocity ?? 0),
      // Harici kaynak bagli degilse notr default ile aciklanabilir karar korunur.
      btcDominanceBias: Number(context.metadata.btcDominanceBias ?? 0),
      socialSentimentScore: Number(context.metadata.socialSentimentScore ?? 50),
      newsSentiment: String(context.metadata.macroNewsSentiment ?? "NEUTRAL") as
        | "POSITIVE"
        | "NEGATIVE"
        | "NEUTRAL",
      macroHighImpactNews: Boolean(context.metadata.macroHighImpactNews ?? false),
      macroUncertaintyLevel: Number(context.metadata.macroUncertaintyLevel ?? 0),
      futuresIntent: String(context.metadata.futuresIntent ?? "NEUTRAL"),
      futuresRiskScore: Number(context.metadata.futuresRiskScore ?? 0),
      futuresRiskSummary: String(context.metadata.futuresRiskSummary ?? "Futures intelligence not available"),
      futuresIntelDegraded: Boolean(context.metadata.futuresIntelDegraded ?? false),
      leverageStressScore: Number(context.metadata.leverageStressScore ?? 0),
      squeezeProbability: Number(context.metadata.squeezeProbability ?? 0),
      leveragedTrapProbability: Number(context.metadata.leveragedTrapProbability ?? 0),
      positioningPressure: Number(context.metadata.positioningPressure ?? 50),
      aggressivePositioningScore: Number(context.metadata.aggressivePositioningScore ?? 50),
      oiPriceDivergenceScore: Number(context.metadata.oiPriceDivergenceScore ?? 0),
      manipulationPressureScore: Number(context.metadata.manipulationPressureScore ?? 0),
      overcrowdedLongScore: Number(context.metadata.overcrowdedLongScore ?? 0),
      overcrowdedShortScore: Number(context.metadata.overcrowdedShortScore ?? 0),
      fundingRate: Number(context.metadata.fundingRate ?? 0),
      fundingDelta: Number(context.metadata.fundingDelta ?? 0),
      openInterest: Number(context.metadata.openInterest ?? 0),
      openInterestDelta: Number(context.metadata.openInterestDelta ?? 0),
      longShortRatio: Number(context.metadata.longShortRatio ?? 0),
      longShortRatioDelta: Number(context.metadata.longShortRatioDelta ?? 0),
      liquidationImbalance: Number(context.metadata.liquidationImbalance ?? 0),
      liquidationMagnetPrice: Number(context.metadata.liquidationMagnetPrice ?? 0),
      liquidationMagnetDistancePercent: Number(context.metadata.liquidationMagnetDistancePercent ?? 0),
      regimeStabilityScore: Number(context.metadata.regimeStabilityScore ?? 50),
      regimeAgeSec: Number(context.metadata.regimeAgeSec ?? 0),
      regimeTransitionProbability: Number(context.metadata.regimeTransitionProbability ?? 0),
      regimeFlipRisk: Number(context.metadata.regimeFlipRisk ?? 0),
      regimeChaosProbability: Number(context.metadata.regimeChaosProbability ?? 0),
      regimePersistenceScore: Number(context.metadata.regimePersistenceScore ?? 50),
      regimeSwitchCount10m: Number(context.metadata.regimeSwitchCount10m ?? 0),
      regimeLifecyclePhase: String(context.metadata.regimeLifecyclePhase ?? "NEW_REGIME"),
      regimeChopWarning: Boolean(context.metadata.regimeChopWarning ?? false),
      regimeUnstableBreakoutCondition: Boolean(context.metadata.regimeUnstableBreakoutCondition ?? false),
      pumpCandidate: Boolean(
        context.metadata.pumpEarlyConfirmed ||
          context.metadata.pumpContinuationMode ||
          context.metadata.pumpIntradaySpike ||
          Number(context.metadata.topGainerPriorityScore ?? 0) >= 70,
      ),
      pumpStage: String(context.metadata.pumpBreakoutStage ?? ""),
      pumpPriorityScore: Number(
        context.metadata.topGainerPriorityScore ?? context.metadata.pumpEarlyPriorityScore ?? 0,
      ),
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
  const analysisMemory = await getAIAnalysisMemoryContext(aiInput);
  return {
    ...aiInput,
    analysisMemory,
  };
}
