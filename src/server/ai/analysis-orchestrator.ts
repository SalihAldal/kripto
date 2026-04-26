import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { pushLog } from "@/services/log.service";
import {
  getKlines,
  getOrderBook,
  getRecentTrades,
  getTicker,
} from "@/services/binance.service";
import { createProviderAdapter } from "@/src/server/ai/provider-factory";
import { getProviderConfigs } from "@/src/server/ai/provider-registry";
import { summarizeConsensus } from "@/src/server/ai/consensus-engine";
import { buildHybridDecision } from "@/src/server/ai/hybrid-decision-engine";
import { buildMultiTimeframeAnalysis } from "@/src/server/ai/multi-timeframe.service";
import { detectMarketRegime } from "@/src/server/scanner/market-regime.service";
import { withAiRetry } from "@/src/server/ai/utils";
import { markHeartbeat } from "@/src/server/observability/heartbeat";
import { withCircuitBreaker } from "@/src/server/resilience/circuit-breaker";
import type { AIAnalysisInput, AIConsensusResult, AIModelOutput, AIProviderResult } from "@/src/types/ai";

function aggregateModelOutputs(parts: AIModelOutput[]): AIModelOutput {
  const decisionCount = { BUY: 0, SELL: 0, HOLD: 0, NO_TRADE: 0 } as Record<AIModelOutput["decision"], number>;
  for (const p of parts) decisionCount[p.decision] += 1;

  const sorted = Object.entries(decisionCount).sort((a, b) => b[1] - a[1]);
  const decision = sorted[0][0] as AIModelOutput["decision"];
  const confidence = Number((parts.reduce((acc, x) => acc + x.confidence, 0) / parts.length).toFixed(2));
  const riskScore = Number((parts.reduce((acc, x) => acc + x.riskScore, 0) / parts.length).toFixed(2));
  const remoteCount = parts.filter((row) => Boolean((row.metadata as Record<string, unknown> | undefined)?.remote)).length;
  const remoteCoverage = Number((remoteCount / Math.max(parts.length, 1)).toFixed(4));

  return {
    decision,
    confidence,
    targetPrice: parts[0].targetPrice,
    stopPrice: parts[0].stopPrice,
    estimatedDurationSec: Math.round(parts.reduce((acc, x) => acc + x.estimatedDurationSec, 0) / parts.length),
    reasoningShort: parts.map((x) => x.reasoningShort).join(" | ").slice(0, 250),
    riskScore,
    metadata: {
      components: parts.map((x) => ({ decision: x.decision, confidence: x.confidence })),
      remote: remoteCount > 0,
      remoteCount,
      remoteCoverage,
      degraded: remoteCount === 0,
    },
  };
}

async function analyzeLaneWithSingleProvider(
  input: AIAnalysisInput,
  lane: "technical" | "momentum" | "risk",
  providerId: string,
): Promise<AIProviderResult> {
  const providerConfig = getProviderConfigs().find((x) => x.id === providerId);
  if (!providerConfig) {
    return {
      providerId,
      providerName: providerId,
      ok: false,
      latencyMs: 0,
      error: `Provider config missing for ${providerId}`,
    };
  }
  const provider = createProviderAdapter(providerConfig);
  const start = Date.now();
  try {
    const output =
      lane === "technical"
        ? await withAiRetry(
            () => provider.analyzeTechnicalSignal(input),
            {
              context: `${provider.config.id}:technical`,
              timeoutMs: Math.max(11_000, provider.config.timeoutMs + 6_000),
              retries: 1,
            },
          )
        : lane === "momentum"
          ? await withAiRetry(
              () => provider.analyzeMomentumSignal(input),
              {
                context: `${provider.config.id}:momentum`,
                timeoutMs: Math.max(11_000, provider.config.timeoutMs + 6_000),
                retries: 1,
              },
            )
          : await withAiRetry(
              () => provider.analyzeRiskAssessment(input),
              {
                context: `${provider.config.id}:risk`,
                timeoutMs: Math.max(11_000, provider.config.timeoutMs + 6_000),
                retries: 0,
              },
            );
    return {
      providerId: provider.config.id,
      providerName: provider.config.name,
      ok: true,
      output,
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      providerId: provider.config.id,
      providerName: provider.config.name,
      ok: false,
      latencyMs: Date.now() - start,
      error: (error as Error).message,
    };
  }
}

export async function buildAIInput(symbol: string, strategyParams?: Record<string, unknown>, riskSettings?: AIAnalysisInput["riskSettings"]): Promise<AIAnalysisInput> {
  const normalized = symbol.toUpperCase();
  const [ticker, klines, orderBook, recentTrades, klines5m, klines15m, klines1h, klines4h, klines1d] = await Promise.all([
    getTicker(normalized),
    getKlines(normalized, "1m", 60),
    getOrderBook(normalized, 25),
    getRecentTrades(normalized, 80),
    getKlines(normalized, "5m", 80),
    getKlines(normalized, "15m", 80),
    getKlines(normalized, "1h", 80),
    getKlines(normalized, "4h", 80),
    getKlines(normalized, "1d", 80),
  ]);
  const mtf = buildMultiTimeframeAnalysis({
    m1: klines,
    m5: klines5m,
    m15: klines15m,
    h1: klines1h,
    h4: klines4h,
    d1: klines1d,
  });

  const bestBid = orderBook.bids[0]?.price ?? ticker.price;
  const bestAsk = orderBook.asks[0]?.price ?? ticker.price;
  const spread = Number((((bestAsk - bestBid) / Math.max(bestAsk, 1)) * 100).toFixed(4));
  const closeSeries = klines.map((x) => x.close);
  const mean = closeSeries.reduce((acc, v) => acc + v, 0) / Math.max(closeSeries.length, 1);
  const variance =
    closeSeries.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / Math.max(closeSeries.length, 1);
  const volatility = Number(((Math.sqrt(variance) / Math.max(mean, 1)) * 100).toFixed(4));

  const buyVolume = recentTrades
    .filter((x) => !x.isBuyerMaker)
    .reduce((acc, x) => acc + x.qty * x.price, 0);
  const sellVolume = recentTrades
    .filter((x) => x.isBuyerMaker)
    .reduce((acc, x) => acc + x.qty * x.price, 0);
  const bidDepth = orderBook.bids.reduce((acc, x) => acc + x.quantity * x.price, 0);
  const askDepth = orderBook.asks.reduce((acc, x) => acc + x.quantity * x.price, 0);
  const shortMomentumPercent =
    klines.length > 6
      ? Number((((klines[klines.length - 1].close - klines[klines.length - 6].close) / Math.max(klines[klines.length - 6].close, 1)) * 100).toFixed(4))
      : 0;
  const shortFlowImbalance = Number(
    ((buyVolume - sellVolume) / Math.max(buyVolume + sellVolume, 0.0001)).toFixed(4),
  );
  const trendAnchor = closeSeries[Math.max(0, closeSeries.length - 24)] ?? closeSeries[0] ?? ticker.price;
  const trendStrength =
    trendAnchor > 0
      ? Number((((ticker.price - trendAnchor) / trendAnchor)).toFixed(4))
      : 0;
  const marketRegime = detectMarketRegime({
    trendStrength,
    momentumPercent: Number(ticker.change24h ?? 0),
    shortMomentumPercent,
    volatilityPercent: volatility,
    spreadPercent: spread,
    fakeSpikeScore: Number(Math.max(0, Math.abs(Number(ticker.change24h ?? 0)) - 1.4).toFixed(4)),
    volume24h: ticker.volume24h,
    minVolumeThreshold: env.SCANNER_MIN_VOLUME_24H,
    shortFlowImbalance,
    newsSentiment: "NEUTRAL",
    socialSentimentScore: 50,
    btcDominanceBias: 0,
  });

  return {
    symbol: normalized,
    lastPrice: ticker.price,
    klines,
    volume24h: ticker.volume24h,
    orderBookSummary: {
      bestBid,
      bestAsk,
      bidDepth,
      askDepth,
    },
    recentTradesSummary: {
      buyVolume,
      sellVolume,
      buySellRatio: Number((buyVolume / Math.max(sellVolume, 0.0001)).toFixed(4)),
    },
    spread,
    volatility,
    marketSignals: {
      change24h: ticker.change24h,
      shortMomentumPercent,
      shortFlowImbalance,
      tradeVelocity: 0,
      btcDominanceBias: 0,
      socialSentimentScore: 50,
      newsSentiment: "NEUTRAL",
    },
    marketRegime: {
      mode: marketRegime.regime,
      confidenceScore: marketRegime.confidenceScore,
      reason: marketRegime.reason,
      marketSummary: marketRegime.marketSummary,
      selectedStrategy: marketRegime.selectedStrategy,
      allowedStrategyTypes: marketRegime.allowedStrategyTypes,
      forbiddenStrategyTypes: marketRegime.forbiddenStrategyTypes,
      tradingAggressiveness: marketRegime.tradingAggressiveness,
      entryThresholdScore: marketRegime.entryThresholdScore,
      openTradeAllowed: marketRegime.openTradeAllowed,
      tpMultiplier: marketRegime.tpMultiplier,
      slMultiplier: marketRegime.slMultiplier,
      riskMultiplier: marketRegime.riskMultiplier,
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

export async function analyzeTechnicalSignal(input: AIAnalysisInput): Promise<AIProviderResult[]> {
  const providers = getProviderConfigs().map(createProviderAdapter);
  return Promise.all(
    providers.map(async (provider) => {
      const start = Date.now();
      try {
        const output = await withAiRetry(
          () => provider.analyzeTechnicalSignal(input),
          {
            context: `${provider.config.id}:technical`,
            timeoutMs: Math.max(11_000, provider.config.timeoutMs + 6_000),
            retries: 1,
          },
        );
        return {
          providerId: provider.config.id,
          providerName: provider.config.name,
          ok: true,
          output,
          latencyMs: Date.now() - start,
        };
      } catch (error) {
        return {
          providerId: provider.config.id,
          providerName: provider.config.name,
          ok: false,
          latencyMs: Date.now() - start,
          error: (error as Error).message,
        };
      }
    }),
  );
}

export async function analyzeMomentumSignal(input: AIAnalysisInput): Promise<AIProviderResult[]> {
  const providers = getProviderConfigs().map(createProviderAdapter);
  return Promise.all(
    providers.map(async (provider) => {
      const start = Date.now();
      try {
        const output = await withAiRetry(
          () => provider.analyzeMomentumSignal(input),
          {
            context: `${provider.config.id}:momentum`,
            timeoutMs: Math.max(11_000, provider.config.timeoutMs + 6_000),
            retries: 1,
          },
        );
        return {
          providerId: provider.config.id,
          providerName: provider.config.name,
          ok: true,
          output,
          latencyMs: Date.now() - start,
        };
      } catch (error) {
        return {
          providerId: provider.config.id,
          providerName: provider.config.name,
          ok: false,
          latencyMs: Date.now() - start,
          error: (error as Error).message,
        };
      }
    }),
  );
}

export async function analyzeRiskAssessment(input: AIAnalysisInput): Promise<AIProviderResult[]> {
  const providers = getProviderConfigs().map(createProviderAdapter);
  return Promise.all(
    providers.map(async (provider) => {
      const start = Date.now();
      try {
        const output = await withAiRetry(
          () => provider.analyzeRiskAssessment(input),
          {
            context: `${provider.config.id}:risk`,
            timeoutMs: Math.max(11_000, provider.config.timeoutMs + 6_000),
            retries: 0,
          },
        );
        return {
          providerId: provider.config.id,
          providerName: provider.config.name,
          ok: true,
          output,
          latencyMs: Date.now() - start,
        };
      } catch (error) {
        return {
          providerId: provider.config.id,
          providerName: provider.config.name,
          ok: false,
          latencyMs: Date.now() - start,
          error: (error as Error).message,
        };
      }
    }),
  );
}

export async function runAIConsensus(
  symbol: string,
  strategyParams?: Record<string, unknown>,
  riskSettings?: AIAnalysisInput["riskSettings"],
): Promise<AIConsensusResult> {
  const input = await buildAIInput(symbol, strategyParams, riskSettings);
  return runAIConsensusFromInput(input);
}

export async function runAIConsensusFromInput(input: AIAnalysisInput): Promise<AIConsensusResult> {
  if (!Number.isFinite(input.lastPrice) || input.lastPrice <= 0) {
    const reason = "Invalid market price in AI input";
    pushLog("SIGNAL", `${input.symbol.toUpperCase()} AI consensus: NO_TRADE (invalid price)`);
    return {
      finalDecision: "NO_TRADE",
      finalConfidence: 0,
      finalRiskScore: 100,
      score: 0,
      explanation: reason,
      outputs: [],
      rejected: true,
      rejectReason: reason,
      generatedAt: new Date().toISOString(),
    };
  }

  const snapshotFlow =
    input.recentTradesSummary.buyVolume +
    input.recentTradesSummary.sellVolume +
    input.orderBookSummary.bidDepth +
    input.orderBookSummary.askDepth;
  if (snapshotFlow <= 0) {
    const reason = "Market snapshot degraded (trade/book flow unavailable)";
    pushLog("SIGNAL", `${input.symbol.toUpperCase()} AI consensus: NO_TRADE (degraded snapshot)`);
    return {
      finalDecision: "NO_TRADE",
      finalConfidence: 0,
      finalRiskScore: 100,
      score: 0,
      explanation: reason,
      outputs: [],
      rejected: true,
      rejectReason: reason,
      generatedAt: new Date().toISOString(),
    };
  }

  const snapshotTradeNotional = input.recentTradesSummary.buyVolume + input.recentTradesSummary.sellVolume;
  const snapshotBookNotional = input.orderBookSummary.bidDepth + input.orderBookSummary.askDepth;
  const snapshotNotional = Math.max(snapshotTradeNotional, snapshotBookNotional);
  const snapshotMinLiquidity = Math.max(1_500, env.SCANNER_MIN_VOLUME_24H * 0.003);
  const has24hLiquidity = input.volume24h >= env.SCANNER_MIN_VOLUME_24H;
  const hasReliableSnapshotLiquidity = snapshotNotional >= snapshotMinLiquidity;
  const isMajorSymbol = /^(BTC|ETH|BNB|SOL|XRP)/i.test(input.symbol);
  const bypassLowLiquidityGate = isMajorSymbol;

  if (!has24hLiquidity && !hasReliableSnapshotLiquidity && !bypassLowLiquidityGate) {
    const reason = `Liquidity below threshold (24h=${input.volume24h.toFixed(2)}, snapshot=${snapshotNotional.toFixed(2)})`;
    pushLog("SIGNAL", `${input.symbol.toUpperCase()} AI consensus: NO_TRADE (low liquidity)`);
    return {
      finalDecision: "NO_TRADE",
      finalConfidence: 0,
      finalRiskScore: 100,
      score: 0,
      explanation: reason,
      outputs: [],
      rejected: true,
      rejectReason: reason,
      generatedAt: new Date().toISOString(),
    };
  }
  if (!has24hLiquidity && !hasReliableSnapshotLiquidity && bypassLowLiquidityGate) {
    pushLog(
      "WARN",
      `${input.symbol.toUpperCase()} liquidity gate bypass (TRY/major). 24h=${input.volume24h.toFixed(2)} snapshot=${snapshotNotional.toFixed(2)}`,
    );
  }

  const safeInput = {
    symbol: input.symbol,
    lastPrice: input.lastPrice,
    spread: input.spread,
    volatility: input.volatility,
    volume24h: input.volume24h,
    klineCount: input.klines.length,
  };
  logger.info(
    safeInput,
    "AI analyze request",
  );

  const laneProviderMap = {
    technical: "provider-1",
    momentum: "provider-2",
    risk: "provider-3",
  } as const;
  const [technicalSingle, momentumSingle, riskSingle] = await Promise.all([
    withCircuitBreaker(
      "ai:technical",
      () => analyzeLaneWithSingleProvider(input, "technical", laneProviderMap.technical),
      { threshold: 4, cooldownMs: 20_000 },
    ),
    withCircuitBreaker(
      "ai:momentum",
      () => analyzeLaneWithSingleProvider(input, "momentum", laneProviderMap.momentum),
      { threshold: 4, cooldownMs: 20_000 },
    ),
    withCircuitBreaker(
      "ai:risk",
      () => analyzeLaneWithSingleProvider(input, "risk", laneProviderMap.risk),
      { threshold: 4, cooldownMs: 20_000 },
    ),
  ]);
  const technical = [technicalSingle];
  const momentum = [momentumSingle];
  const risk = [riskSingle];

  const merged = new Map<string, AIProviderResult[]>();
  for (const row of [...technical, ...momentum, ...risk]) {
    const prev = merged.get(row.providerId) ?? [];
    prev.push(row);
    merged.set(row.providerId, prev);
  }

  const aggregated: AIProviderResult[] = [];
  for (const [providerId, rows] of merged.entries()) {
    const okRows = rows.filter((x) => x.ok && x.output);
    if (okRows.length === 0) {
      aggregated.push({
        providerId,
        providerName: rows[0]?.providerName ?? providerId,
        ok: false,
        latencyMs: rows.reduce((acc, x) => acc + x.latencyMs, 0),
        error: rows.map((x) => x.error).filter(Boolean).join(" | "),
      });
      continue;
    }

    aggregated.push({
      providerId,
      providerName: rows[0]?.providerName ?? providerId,
      ok: true,
      output: aggregateModelOutputs(okRows.map((x) => x.output!)),
      latencyMs: rows.reduce((acc, x) => acc + x.latencyMs, 0),
    });
  }

  const consensus = buildHybridDecision({
    analysisInput: input,
    technicalResults: technical,
    momentumResults: momentum,
    riskResults: risk,
    allOutputs: aggregated,
  });
  const baseConsensus = summarizeConsensus(aggregated);
  const finalConsensus: AIConsensusResult = {
    ...consensus,
    finalConfidence: Number((((consensus.finalConfidence * 0.7) + (baseConsensus.finalConfidence * 0.3))).toFixed(2)),
    finalRiskScore: Number((((consensus.finalRiskScore * 0.8) + (baseConsensus.finalRiskScore * 0.2))).toFixed(2)),
  };
  const degradedProviders = aggregated.filter((x) => !x.ok);
  if (degradedProviders.length > 0) {
    pushLog(
      "WARN",
      `${input.symbol.toUpperCase()} AI provider degraded: ${degradedProviders
        .map((x) => `${x.providerName}:${x.error ?? "failed"}`)
        .join(" | ")}`,
    );
  }
  pushLog(
    "SIGNAL",
      `${input.symbol.toUpperCase()} AI consensus: ${finalConsensus.finalDecision} (${finalConsensus.finalConfidence}%)${
      finalConsensus.finalDecision === "NO_TRADE" && finalConsensus.rejectReason
        ? ` | reason=${finalConsensus.rejectReason}`
        : ""
    }`,
  );

  logger.info(
    {
      symbol: input.symbol,
      decision: finalConsensus.finalDecision,
      confidence: finalConsensus.finalConfidence,
      risk: finalConsensus.finalRiskScore,
      hybridPayload: finalConsensus.decisionPayload,
      roleScores: finalConsensus.roleScores,
      providerResults: aggregated.map((x) => ({
        providerId: x.providerId,
        ok: x.ok,
        latencyMs: x.latencyMs,
        decision: x.output?.decision ?? null,
        remote: Boolean((x.output?.metadata as Record<string, unknown> | undefined)?.remote),
      })),
      laneProviderMap,
    },
    "AI analyze response",
  );
  markHeartbeat({
    service: "ai-orchestrator",
    status: "UP",
    message: "AI consensus generated",
    details: {
      symbol: input.symbol,
      decision: finalConsensus.finalDecision,
      confidence: finalConsensus.finalConfidence,
    },
  });

  return finalConsensus;
}
