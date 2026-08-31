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
import { buildIndicatorSnapshot } from "@/src/server/ai/indicator-suite";
import { buildMultiTimeframeAnalysis } from "@/src/server/ai/multi-timeframe.service";
import { detectMarketRegime } from "@/src/server/scanner/market-regime.service";
import { recordRegimeStability } from "@/src/server/scanner/regime-stability.service";
import { collectPreTradeFuturesIntelligence } from "@/src/server/futures/futures-intelligence.service";
import {
  attachProviderHealthState,
  buildAllProvidersDegradedConsensusResult,
  classifyProviderHealthState,
  consensusVoteLabel,
  evaluateProviderHealthGate,
} from "@/src/server/ai/ai-provider-health.service";
import { throwIfAborted, yieldAsyncStackUnwind, runOnFreshStack } from "@/src/server/execution/cancellable-work.service";
import { withBoundedPrisma } from "@/src/server/execution/bounded-prisma.service";
import { CooperativeAsyncCancelledError, CooperativeAsyncTimeoutError } from "@/src/server/execution/cooperative-async.types";
import { markHeartbeat } from "@/src/server/observability/heartbeat";
import { withCircuitBreaker } from "@/src/server/resilience/circuit-breaker";
import { isTransientPrismaConnectivityError } from "@/src/server/db/transient-prisma-error";
import { logTradeEvent } from "@/src/server/observability/trade-event-log";
import { buildAnalysisScorecard } from "@/src/server/ai/analysis-scorecard.service";
import { buildShortTermReport } from "@/src/server/ai/short-term-report.service";
import { normalizeAiModelOutput } from "@/src/server/ai/normalize-model-output";
import { withAiRetry } from "@/src/server/ai/utils";
import {
  getProviderRegistryEntry,
  recordProviderOutcome,
  resetStaleProviderHealth,
} from "@/src/server/ai/ai-provider-health-registry.service";
import {
  applyAiPerformanceWeights,
  ensureAiPerformanceEvaluator,
  recordAiPerformancePrediction,
} from "@/src/server/ai/ai-performance.service";
import {
  adjustConfidenceWithAnalysisMemory,
  recordAIAnalysisPrediction,
} from "@/src/server/ai/ai-analysis-memory.service";
import { getRuntimeExecutionContext } from "@/src/server/repositories/execution.repository";
import {
  createDecisionId,
  observeAiDecision,
} from "@/src/server/observability/decision-observability.service";
import { getActiveDecisionId } from "@/src/server/observability/decision-trace-context";
import { adjudicateWithMasterDecisionEngine } from "@/src/server/decision-engine/master-decision-engine.service";
import { applyConfidenceCalibrationToDecision, mapPersistedCalibrationBins } from "@/src/server/ai/confidence-calibration-intelligence.service";
import { listConfidenceCalibration } from "@/src/server/learning-engine/learning-engine.repository";
import { bridgeAiProviderResult, bridgeConsensusResult } from "@/src/server/forensics/forensic-bridge.service";
import { createCandidateId } from "@/src/server/forensics/forensic-collector.service";
import { recordConsensusAudit } from "@/src/server/forensics/ai-runtime.service";
import { STALL_ERROR_CODES } from "@/src/server/forensics/stall-error-taxonomy";
import type { AIAnalysisInput, AIConsensusResult, AIModelOutput, AIProviderResult } from "@/src/types/ai";

function aggregateModelOutputs(parts: AIModelOutput[], input: AIAnalysisInput): AIModelOutput {
  const decisionCount = { BUY: 0, SELL: 0, HOLD: 0, NO_TRADE: 0 } as Record<AIModelOutput["decision"], number>;
  for (const p of parts) decisionCount[p.decision] += 1;

  const sorted = Object.entries(decisionCount).sort((a, b) => b[1] - a[1]);
  const decision = sorted[0][0] as AIModelOutput["decision"];
  const confidence = Number((parts.reduce((acc, x) => acc + x.confidence, 0) / parts.length).toFixed(2));
  const riskScore = Number((parts.reduce((acc, x) => acc + x.riskScore, 0) / parts.length).toFixed(2));
  const remoteCount = parts.filter((row) => Boolean((row.metadata as Record<string, unknown> | undefined)?.remote)).length;
  const remoteCoverage = Number((remoteCount / Math.max(parts.length, 1)).toFixed(4));

  const directional = parts.find((x) => x.decision === decision && x.targetPrice && x.stopPrice);
  const reference = directional ?? parts.find((x) => x.targetPrice && x.stopPrice) ?? parts[0];
  const durationSamples = parts
    .filter((x) => x.decision === decision || x.decision === "HOLD" || x.decision === "NO_TRADE")
    .map((x) => x.estimatedDurationSec)
    .filter((x) => Number.isFinite(x) && x > 0);
  const output = {
    decision,
    confidence,
    targetPrice: reference?.targetPrice ?? null,
    stopPrice: reference?.stopPrice ?? null,
    estimatedDurationSec: Math.round(
      (durationSamples.length > 0 ? durationSamples : parts.map((x) => x.estimatedDurationSec))
        .reduce((acc, x) => acc + x, 0) / Math.max(durationSamples.length || parts.length, 1),
    ),
    reasoningShort: parts.map((x) => x.reasoningShort).join(" | ").slice(0, 250),
    riskScore,
    metadata: {
      components: parts.map((x) => ({ decision: x.decision, confidence: x.confidence })),
      remote: remoteCount > 0,
      remoteCount,
      remoteCoverage,
      degraded: remoteCount === 0,
    },
  } satisfies AIModelOutput;
  return normalizeAiModelOutput({
    output,
    analysisInput: input,
    minProfitPercent: Math.max(0.25, env.EXECUTION_TARGET_MIN_PROFIT_PERCENT),
    maxDurationSec: 1800,
  }) ?? output;
}

function getAiProviderCursor() {
  const globalRef = globalThis as typeof globalThis & { __aiProviderCursor?: number };
  if (typeof globalRef.__aiProviderCursor !== "number") {
    globalRef.__aiProviderCursor = 0;
  }
  return globalRef;
}

function buildLaneProviderMap() {
  const enabled = getProviderConfigs().map((x) => x.id);
  const baseProviders = enabled.length > 0 ? enabled : ["provider-1", "provider-2", "provider-3"];
  const hasOpenAi = baseProviders.includes("provider-1");
  const hasClaude = baseProviders.includes("provider-2");
  const hasGemini = baseProviders.includes("provider-3");
  const cursorRef = getAiProviderCursor();
  const cursor = cursorRef.__aiProviderCursor ?? 0;
  cursorRef.__aiProviderCursor = cursor + 1;

  if (baseProviders.length >= 3 && hasOpenAi && hasClaude && hasGemini) {
    // Claude'u ciddi dusur: 4 analizde 1 kez momentum lane.
    const biasStep = cursor % 4;
    const base = {
      technical: "provider-1",
      momentum: "provider-1",
      risk: "provider-3",
    } as const;
    if (biasStep === 0) {
      return { ...base, momentum: "provider-2" } as const;
    }
    return base;
  }

  const providers = baseProviders.length > 0 ? baseProviders : ["provider-1"];
  const rotation = [0, 1, 2].map((idx) => providers[(cursor + idx) % providers.length]);
  return {
    technical: rotation[0] ?? providers[0],
    momentum: rotation[1] ?? rotation[0] ?? providers[0],
    risk: rotation[2] ?? rotation[0] ?? providers[0],
  } as const;
}

export function resolveAiLaneProviders() {
  const laneProviderMap = buildLaneProviderMap();
  const configs = getProviderConfigs();
  const modelFor = (providerId: string) => configs.find((row) => row.id === providerId)?.model;
  return {
    laneProviderMap,
    primaryProvider: laneProviderMap.technical,
    primaryModel: modelFor(laneProviderMap.technical),
    models: {
      technical: modelFor(laneProviderMap.technical),
      momentum: modelFor(laneProviderMap.momentum),
      risk: modelFor(laneProviderMap.risk),
    },
  };
}

export type AIConsensusOptions = {
  signal?: AbortSignal;
};

const STACK_DEPTH_SOFT_LIMIT = 70;
const STACK_DEPTH_HARD_LIMIT = 110;

class AIStackDepthGuardError extends Error {
  readonly code = "AI_STACK_DEPTH_GUARD";
  readonly phase: string;
  readonly stackDepth: number;

  constructor(phase: string, stackDepth: number, reason: string) {
    super(`AI_STACK_DEPTH_GUARD:${phase}:${reason}`);
    this.name = "AIStackDepthGuardError";
    this.phase = phase;
    this.stackDepth = stackDepth;
  }
}

function currentStackDepth() {
  const stack = new Error().stack;
  if (!stack) return 0;
  return stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at ")).length;
}

function resolveFailoverProviderChain(primaryProviderId: string): string[] {
  const enabled = getProviderConfigs().map((row) => row.id);
  if (enabled.length <= 1) return [primaryProviderId];
  return [primaryProviderId, ...enabled.filter((id) => id !== primaryProviderId)];
}

async function analyzeLaneWithSingleProvider(
  input: AIAnalysisInput,
  lane: "technical" | "momentum" | "risk",
  providerId: string,
  candidateId: string,
  signal?: AbortSignal,
): Promise<AIProviderResult> {
  const chain = resolveFailoverProviderChain(providerId);
  let lastResult: AIProviderResult | null = null;
  for (let index = 0; index < chain.length; index += 1) {
    const activeProviderId = chain[index]!;
    const result = await executeLaneProviderCall(input, lane, activeProviderId, candidateId, signal, {
      failoverFrom: index > 0 ? providerId : undefined,
      failoverAttempt: index,
      skipForensicBridge: index < chain.length - 1,
    });
    lastResult = result;
    if (result.remoteOk) return result;
    if (index < chain.length - 1) {
      logger.warn(
        {
          lane,
          primaryProviderId: providerId,
          failoverProviderId: chain[index + 1],
          healthState: result.healthState,
        },
        "AI lane provider degraded; attempting failover provider",
      );
    }
  }
  return lastResult!;
}

async function executeLaneProviderCall(
  input: AIAnalysisInput,
  lane: "technical" | "momentum" | "risk",
  providerId: string,
  candidateId: string,
  signal?: AbortSignal,
  failoverMeta?: { failoverFrom?: string; failoverAttempt?: number; skipForensicBridge?: boolean },
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
  const requestStartedAt = new Date(start).toISOString();
  const healthBefore = getProviderRegistryEntry(provider.config.id);
  resetStaleProviderHealth(provider.config.id);
  try {
    const output =
      lane === "technical"
        ? await withAiRetry(
            () => provider.analyzeTechnicalSignal(input),
            {
              context: `${provider.config.id}:technical`,
              timeoutMs: Math.max(11_000, provider.config.timeoutMs + 6_000),
              retries: 1,
              signal,
            },
          )
        : lane === "momentum"
          ? await withAiRetry(
              () => provider.analyzeMomentumSignal(input),
              {
                context: `${provider.config.id}:momentum`,
                timeoutMs: Math.max(11_000, provider.config.timeoutMs + 6_000),
                retries: 1,
                signal,
              },
            )
          : await withAiRetry(
              () => provider.analyzeRiskAssessment(input),
              {
                context: `${provider.config.id}:risk`,
                timeoutMs: Math.max(16_000, provider.config.timeoutMs + 9_000),
                retries: 0,
                signal,
              },
            );
    if (!output) {
      throw new Error("Remote AI returned empty output");
    }
    const result = {
      providerId: provider.config.id,
      providerName: provider.config.name,
      ok: true,
      remoteOk: Boolean(output.metadata?.remoteOk ?? output.metadata?.remote ?? false),
      degraded: Boolean(output.metadata?.degraded ?? !output.metadata?.remote),
      failureCategory: typeof output.metadata?.failureCategory === "string" ? output.metadata.failureCategory : undefined,
      model: provider.config.model,
      output,
      latencyMs: Date.now() - start,
    };
    const finalized = attachProviderHealthState(result);
    const registryAfter = recordProviderOutcome({
      providerId: finalized.providerId,
      ok: finalized.ok,
      remoteOk: Boolean(finalized.remoteOk),
      healthState: finalized.healthState ?? classifyProviderHealthState(finalized),
      error: finalized.failureCategory,
    });
    const requestEndedAt = new Date().toISOString();
    await logTradeEvent({
      symbol: input.symbol,
      eventType: "AI_PROVIDER_RESULT",
      newValue: {
        providerId: finalized.providerId,
        providerName: finalized.providerName,
        model: finalized.model,
        lane,
        ok: true,
        remoteOk: finalized.remoteOk,
        degraded: finalized.degraded,
        failureCategory: finalized.failureCategory,
        latencyMs: finalized.latencyMs,
        healthBefore: healthBefore.healthState,
        healthAfter: registryAfter.healthState,
      },
    });
    if (!failoverMeta?.skipForensicBridge) {
      bridgeAiProviderResult({
        candidateId,
        symbol: input.symbol,
        provider: finalized.providerId,
        model: finalized.model,
        latencyMs: finalized.latencyMs,
        ok: finalized.ok,
        remote: Boolean(finalized.remoteOk),
        degraded: finalized.degraded,
        healthState: finalized.healthState,
        reason: finalized.failureCategory,
        healthBefore: healthBefore.healthState,
        healthAfter: registryAfter.healthState,
        requestStartedAt,
        requestEndedAt,
        responseReceived: true,
        errorType: finalized.failureCategory,
        retryCount: 0,
        finalHealth: registryAfter.healthState,
      });
    }
    return finalized;
  } catch (error) {
    if (error instanceof CooperativeAsyncCancelledError || error instanceof CooperativeAsyncTimeoutError) {
      throw error;
    }
    const result = {
      providerId: provider.config.id,
      providerName: provider.config.name,
      ok: false,
      remoteOk: false,
      degraded: true,
      failureCategory: (error as Error).message.toLowerCase().includes("timeout")
        ? "timeout"
        : (error as Error).message.toLowerCase().includes("json")
          ? "json_output"
          : "remote",
      model: provider.config.model,
      latencyMs: Date.now() - start,
      error: (error as Error).message,
    };
    const finalized = attachProviderHealthState(result);
    const registryAfter = recordProviderOutcome({
      providerId: finalized.providerId,
      ok: false,
      remoteOk: false,
      healthState: finalized.healthState ?? classifyProviderHealthState(finalized),
      error: finalized.error,
      failureCategory: finalized.failureCategory,
    });
    const requestEndedAt = new Date().toISOString();
    await logTradeEvent({
      symbol: input.symbol,
      eventType: "AI_PROVIDER_RESULT",
      reason: finalized.error,
      newValue: {
        providerId: finalized.providerId,
        providerName: finalized.providerName,
        model: finalized.model,
        lane,
        ok: false,
        remoteOk: false,
        degraded: true,
        failureCategory: finalized.failureCategory,
        latencyMs: finalized.latencyMs,
        healthBefore: healthBefore.healthState,
        healthAfter: registryAfter.healthState,
      },
    });
    if (!failoverMeta?.skipForensicBridge) {
      bridgeAiProviderResult({
        candidateId,
        symbol: input.symbol,
        provider: finalized.providerId,
        model: finalized.model,
        latencyMs: finalized.latencyMs,
        ok: false,
        remote: false,
        degraded: true,
        healthState: finalized.healthState,
        reason: finalized.error,
        healthBefore: healthBefore.healthState,
        healthAfter: registryAfter.healthState,
        requestStartedAt,
        requestEndedAt,
        responseReceived: false,
        errorCode: finalized.failureCategory,
        errorType: finalized.failureCategory,
        retryCount: lane === "risk" ? 0 : 1,
        finalHealth: registryAfter.healthState,
      });
    }
    return finalized;
  }
}

export async function buildAIInput(symbol: string, strategyParams?: Record<string, unknown>, riskSettings?: AIAnalysisInput["riskSettings"]): Promise<AIAnalysisInput> {
  const normalized = symbol.toUpperCase();
  const [ticker, klines, orderBook, recentTrades, klines5m, klines15m, klines1h, klines4h, klines1d] = await Promise.all([
    getTicker(normalized),
    getKlines(normalized, "1m", 240),
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
  const close1mNow = klines[klines.length - 1]?.close ?? ticker.price;
  const close1mPrev = klines[klines.length - 2]?.close ?? close1mNow;
  const change1m = close1mPrev > 0 ? ((close1mNow - close1mPrev) / close1mPrev) * 100 : 0;
  const close5mNow = klines5m[klines5m.length - 1]?.close ?? close1mNow;
  const close5mPrev = klines5m[klines5m.length - 2]?.close ?? close5mNow;
  const change5m = close5mPrev > 0 ? ((close5mNow - close5mPrev) / close5mPrev) * 100 : 0;
  const close15mNow = klines15m[klines15m.length - 1]?.close ?? close1mNow;
  const close15mPrev = klines15m[klines15m.length - 2]?.close ?? close15mNow;
  const change15m = close15mPrev > 0 ? ((close15mNow - close15mPrev) / close15mPrev) * 100 : 0;
  const recentVolumes = klines.slice(-22).map((x) => x.volume);
  const lastVolume = recentVolumes[recentVolumes.length - 1] ?? 0;
  const avgVolume =
    recentVolumes.length > 1
      ? recentVolumes.slice(0, -1).reduce((acc, v) => acc + v, 0) / Math.max(recentVolumes.length - 1, 1)
      : 0;
  const volumeSpikeRatio = avgVolume > 0 ? lastVolume / avgVolume : 0;
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
  const macroNewsSentiment = env.MACRO_NEWS_SENTIMENT;
  const macroHighImpactNews = env.MACRO_HIGH_IMPACT_NEWS;
  const macroUncertaintyLevel = env.MACRO_UNCERTAINTY_LEVEL;
  const btcDominanceBias = env.MACRO_BTC_DOMINANCE_BIAS;
  const futuresIntel = await collectPreTradeFuturesIntelligence({
    symbol: normalized,
    lastPrice: ticker.price,
    priceChangePercent: Number(ticker.change24h ?? 0),
    shortMomentumPercent,
  }).catch(() => null);

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
    newsSentiment: macroNewsSentiment,
    socialSentimentScore: 50,
    btcDominanceBias,
    futuresRiskScore: futuresIntel?.futuresRiskScore,
    leverageStressScore: futuresIntel?.leverageStressScore,
    squeezeProbability: futuresIntel?.squeezeProbability,
    leveragedTrapProbability: futuresIntel?.leveragedTrapProbability,
    oiPriceDivergenceScore: futuresIntel?.oiPriceDivergenceScore,
    manipulationPressureScore: futuresIntel?.manipulationPressureScore,
    futuresIntent: futuresIntel?.futuresIntent,
  });
  const regimeStability = recordRegimeStability({
    symbol: normalized,
    marketRegime,
    trendStrength,
    momentumPercent: Number(ticker.change24h ?? 0),
    shortMomentumPercent,
    volatilityPercent: volatility,
    spreadPercent: spread,
    fakeSpikeScore: Number(Math.max(0, Math.abs(Number(ticker.change24h ?? 0)) - 1.4).toFixed(4)),
    pumpRisk: futuresIntel?.manipulationPressureScore ?? 0,
    futuresRiskScore: futuresIntel?.futuresRiskScore,
    leverageStressScore: futuresIntel?.leverageStressScore,
  });
  const adjustedRegimeConfidence = Number(
    Math.max(
      35,
      Math.min(
        98,
        marketRegime.confidenceScore -
          Math.max(0, regimeStability.transitionProbability * 0.12 + regimeStability.flipRisk * 0.1 + regimeStability.chaosProbability * 0.08 - regimeStability.stabilityScore * 0.06),
      ),
    ).toFixed(2),
  );
  const adjustedRiskMultiplier = Number(
    Math.max(
      0.18,
      Math.min(
        1.18,
        marketRegime.riskMultiplier *
          (regimeStability.stabilityScore >= 72 ? 1.04 : 1) *
          (1 - regimeStability.transitionProbability * 0.0025) *
          (1 - regimeStability.chaosProbability * 0.002),
      ),
    ).toFixed(4),
  );

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
      change1m: Number(change1m.toFixed(4)),
      change5m: Number(change5m.toFixed(4)),
      change15m: Number(change15m.toFixed(4)),
      shortMomentumPercent,
      shortFlowImbalance,
      tradeVelocity: 0,
      volumeSpikeRatio: Number(volumeSpikeRatio.toFixed(4)),
      btcDominanceBias,
      socialSentimentScore: 50,
      newsSentiment: macroNewsSentiment,
      macroHighImpactNews,
      macroUncertaintyLevel,
      futuresIntent: futuresIntel?.futuresIntent ?? "NEUTRAL",
      futuresRiskScore: futuresIntel?.futuresRiskScore ?? 0,
      futuresRiskSummary: futuresIntel?.summary ?? "Futures intelligence not available",
      regimeStabilityScore: regimeStability.stabilityScore,
      regimeAgeSec: regimeStability.regimeAgeSec,
      regimeTransitionProbability: regimeStability.transitionProbability,
      regimeFlipRisk: regimeStability.flipRisk,
      regimeChaosProbability: regimeStability.chaosProbability,
      regimePersistenceScore: regimeStability.persistenceScore,
      regimeSwitchCount10m: regimeStability.switchCount10m,
      regimeLifecyclePhase: regimeStability.lifecyclePhase,
      regimeChopWarning: regimeStability.chopWarning,
      regimeUnstableBreakoutCondition: regimeStability.unstableBreakoutCondition,
      leverageStressScore: futuresIntel?.leverageStressScore ?? 0,
      squeezeProbability: futuresIntel?.squeezeProbability ?? 0,
      leveragedTrapProbability: futuresIntel?.leveragedTrapProbability ?? 0,
      positioningPressure: futuresIntel?.positioningPressure ?? 50,
      aggressivePositioningScore: futuresIntel?.aggressivePositioningScore ?? 50,
      oiPriceDivergenceScore: futuresIntel?.oiPriceDivergenceScore ?? 0,
      manipulationPressureScore: futuresIntel?.manipulationPressureScore ?? 0,
      overcrowdedLongScore: futuresIntel?.overcrowdedLongScore ?? 0,
      overcrowdedShortScore: futuresIntel?.overcrowdedShortScore ?? 0,
      fundingRate: futuresIntel?.fundingRate ?? 0,
      fundingDelta: futuresIntel?.fundingDelta ?? 0,
      openInterest: futuresIntel?.openInterest ?? 0,
      openInterestDelta: futuresIntel?.openInterestDelta ?? 0,
      longShortRatio: futuresIntel?.longShortRatio ?? 0,
      longShortRatioDelta: futuresIntel?.longShortRatioDelta ?? 0,
      liquidationImbalance: futuresIntel?.liquidationImbalance ?? 0,
      liquidationMagnetPrice: futuresIntel?.nearestLiquidationMagnetPrice ?? 0,
      liquidationMagnetDistancePercent: futuresIntel?.liquidationMagnetDistancePercent ?? 0,
    },
    marketRegime: {
      mode: marketRegime.regime,
      confidenceScore: adjustedRegimeConfidence,
      reason: regimeStability.lifecyclePhase === "STABLE"
        ? marketRegime.reason
        : `${marketRegime.reason} Stability=${regimeStability.lifecyclePhase}, transition=${regimeStability.transitionProbability}.`,
      marketSummary: regimeStability.lifecyclePhase === "STABLE"
        ? marketRegime.marketSummary
        : `${marketRegime.marketSummary} Regime stability: ${regimeStability.lifecyclePhase}.`,
      selectedStrategy: marketRegime.selectedStrategy,
      allowedStrategyTypes: marketRegime.allowedStrategyTypes,
      forbiddenStrategyTypes: marketRegime.forbiddenStrategyTypes,
      tradingAggressiveness: marketRegime.tradingAggressiveness,
      entryThresholdScore: marketRegime.entryThresholdScore,
      openTradeAllowed: marketRegime.openTradeAllowed,
      tpMultiplier: marketRegime.tpMultiplier,
      slMultiplier: marketRegime.slMultiplier,
      riskMultiplier: adjustedRiskMultiplier,
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
            timeoutMs: Math.max(16_000, provider.config.timeoutMs + 9_000),
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

export async function runAIConsensusFromInput(
  input: AIAnalysisInput,
  options?: AIConsensusOptions,
): Promise<AIConsensusResult> {
  const result = await runAIConsensusFromInputImpl(input, options);
  try {
    observeAiDecision({
      decisionId: getActiveDecisionId() ?? createDecisionId(),
      symbol: input.symbol,
      input,
      result,
    });
  } catch (error) {
    const message = (error as Error).message;
    logger.warn(
      {
        symbol: input.symbol,
        error: message,
      },
      "AI decision observability failed; consensus result preserved",
    );
  }
  return result;
}

export async function runLegacyAIConsensusFromInput(
  input: AIAnalysisInput,
  options?: AIConsensusOptions,
): Promise<AIConsensusResult> {
  return runAIConsensusFromInputImpl(input, options);
}

async function runAIConsensusFromInputImpl(
  input: AIAnalysisInput,
  options?: AIConsensusOptions,
): Promise<AIConsensusResult> {
  const signal = options?.signal ?? input.runtimeControl?.abortSignal;
  const phaseTraces: NonNullable<AIAnalysisInput["consensusTelemetry"]>["phaseTraces"] = [];
  const appendPhaseTrace = (
    phase: string,
    freshStackUsed: boolean,
    phaseDurationMs: number,
    stackDepth: number,
    depthRiskStatus: "OK" | "RISKY" | "GUARDED",
  ) => {
    phaseTraces?.push({
      phase,
      freshStackUsed,
      phaseDurationMs,
      depthRiskStatus,
      stackDepth,
    });
  };
  const runGuardedSyncPhase = async <T>(
    phase: string,
    fn: () => T,
    freshStackUsed = true,
  ): Promise<T> => {
    const stackDepth = currentStackDepth();
    const startedAt = Date.now();
    if (stackDepth >= STACK_DEPTH_HARD_LIMIT) {
      appendPhaseTrace(phase, freshStackUsed, 0, stackDepth, "GUARDED");
      throw new AIStackDepthGuardError(phase, stackDepth, "stack_depth_threshold_reached");
    }
    try {
      const value = freshStackUsed ? await runOnFreshStack(fn) : fn();
      appendPhaseTrace(
        phase,
        freshStackUsed,
        Date.now() - startedAt,
        stackDepth,
        stackDepth >= STACK_DEPTH_SOFT_LIMIT ? "RISKY" : "OK",
      );
      return value;
    } catch (error) {
      if (error instanceof RangeError) {
        appendPhaseTrace(phase, freshStackUsed, Date.now() - startedAt, stackDepth, "GUARDED");
        throw new AIStackDepthGuardError(phase, stackDepth, error.message);
      }
      throw error;
    }
  };
  const runGuardedAsyncPhase = async <T>(
    phase: string,
    fn: () => Promise<T>,
  ): Promise<T> => {
    const stackDepth = currentStackDepth();
    const startedAt = Date.now();
    if (stackDepth >= STACK_DEPTH_HARD_LIMIT) {
      appendPhaseTrace(phase, false, 0, stackDepth, "GUARDED");
      throw new AIStackDepthGuardError(phase, stackDepth, "stack_depth_threshold_reached");
    }
    try {
      const value = await fn();
      appendPhaseTrace(
        phase,
        false,
        Date.now() - startedAt,
        stackDepth,
        stackDepth >= STACK_DEPTH_SOFT_LIMIT ? "RISKY" : "OK",
      );
      return value;
    } catch (error) {
      if (error instanceof RangeError) {
        appendPhaseTrace(phase, false, Date.now() - startedAt, stackDepth, "GUARDED");
        throw new AIStackDepthGuardError(phase, stackDepth, error.message);
      }
      throw error;
    }
  };
  throwIfAborted(signal, "AI consensus aborted");
  const now = Date.now();
  const lastKlineClose = input.klines[input.klines.length - 1]?.closeTime ?? 0;
  const klineAgeSec = lastKlineClose ? Math.floor((now - lastKlineClose) / 1000) : null;
  if (input.klines.length < 20 || (klineAgeSec !== null && klineAgeSec > 180)) {
    const reason = "Kline data missing or stale";
    pushLog("SIGNAL", `${input.symbol.toUpperCase()} AI consensus: NO_TRADE (kline missing)`);
    await logTradeEvent({
      symbol: input.symbol,
      eventType: "AI_ANALYSIS_RESULT",
      reason,
      aiConfidence: 0,
      price: input.lastPrice,
      newValue: { decision: "NO_TRADE" },
    });
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
  if (!Number.isFinite(input.lastPrice) || input.lastPrice <= 0) {
    const reason = "Invalid market price in AI input";
    pushLog("SIGNAL", `${input.symbol.toUpperCase()} AI consensus: NO_TRADE (invalid price)`);
    await logTradeEvent({
      symbol: input.symbol,
      eventType: "AI_ANALYSIS_RESULT",
      reason,
      aiConfidence: 0,
      price: input.lastPrice,
      newValue: { decision: "NO_TRADE" },
    });
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
  const degradedSnapshot = snapshotFlow <= 0;
  if (degradedSnapshot) {
    pushLog("WARN", `${input.symbol.toUpperCase()} market snapshot degraded; analysis continues in safe mode`);
  }

  const bookMid =
    input.orderBookSummary.bestBid > 0 && input.orderBookSummary.bestAsk > 0
      ? (input.orderBookSummary.bestBid + input.orderBookSummary.bestAsk) / 2
      : input.lastPrice;
  const bookDeviation =
    input.lastPrice > 0 ? Math.abs(((bookMid - input.lastPrice) / input.lastPrice) * 100) : 0;
  const tradeFlow = input.recentTradesSummary.buyVolume + input.recentTradesSummary.sellVolume;
  const bookLiquidity = input.orderBookSummary.bidDepth + input.orderBookSummary.askDepth;
  if (bookDeviation >= 0.8 && tradeFlow > 0 && bookLiquidity > 0) {
    const reason = "Order book price diverged";
    pushLog("SIGNAL", `${input.symbol.toUpperCase()} AI consensus: NO_TRADE (book deviation)`);
    await logTradeEvent({
      symbol: input.symbol,
      eventType: "AI_ANALYSIS_RESULT",
      reason,
      aiConfidence: 0,
      price: input.lastPrice,
      newValue: { decision: "NO_TRADE" },
    });
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
  if (bookDeviation >= 0.8) {
    pushLog("WARN", `${input.symbol.toUpperCase()} orderbook deviation high (${bookDeviation.toFixed(2)}%); analysis continues`);
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
    await logTradeEvent({
      symbol: input.symbol,
      eventType: "AI_ANALYSIS_RESULT",
      reason,
      aiConfidence: 0,
      price: input.lastPrice,
      newValue: { decision: "NO_TRADE" },
    });
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
  await logTradeEvent({
    symbol: input.symbol,
    eventType: "AI_ANALYSIS_STARTED",
    price: input.lastPrice,
    newValue: safeInput,
  });
  logger.info(
    safeInput,
    "AI analyze request",
  );

  const laneProviderMap = buildLaneProviderMap();
  const consensusStarted = Date.now();
  const consensusCandidateId = createCandidateId(input.symbol, "ai");
  const snapshotBuildStarted = Date.now();
  const indicatorSnapshot =
    input.indicatorSnapshot ??
    (await runGuardedSyncPhase("indicator_snapshot", () => Object.freeze(buildIndicatorSnapshot(input))));
  const indicatorSnapshotBuildMs = input.indicatorSnapshot ? 0 : Date.now() - snapshotBuildStarted;
  const consensusInput: AIAnalysisInput = {
    ...input,
    runtimeControl: {
      ...input.runtimeControl,
      abortSignal: signal,
    },
    indicatorSnapshot,
    consensusTelemetry: {
      indicatorSnapshotBuildCount: input.indicatorSnapshot ? 0 : 1,
      indicatorSnapshotBuildMs,
      phaseTraces,
    },
  };
  await yieldAsyncStackUnwind();
  throwIfAborted(signal, "AI consensus pre-lane aborted");
  let technicalSingle: AIProviderResult;
  let momentumSingle: AIProviderResult;
  let riskSingle: AIProviderResult;
  try {
    [technicalSingle, momentumSingle, riskSingle] = await Promise.all([
      runGuardedAsyncPhase("technical_specialist", () =>
        withCircuitBreaker(
          "ai:technical",
          () => analyzeLaneWithSingleProvider(consensusInput, "technical", laneProviderMap.technical, consensusCandidateId, signal),
          { threshold: 4, cooldownMs: 20_000 },
        ),
      ),
      runGuardedAsyncPhase("momentum_specialist", () =>
        withCircuitBreaker(
          "ai:momentum",
          () => analyzeLaneWithSingleProvider(consensusInput, "momentum", laneProviderMap.momentum, consensusCandidateId, signal),
          { threshold: 4, cooldownMs: 20_000 },
        ),
      ),
      runGuardedAsyncPhase("risk_specialist", () =>
        withCircuitBreaker(
          "ai:risk",
          () => analyzeLaneWithSingleProvider(consensusInput, "risk", laneProviderMap.risk, consensusCandidateId, signal),
          { threshold: 4, cooldownMs: 20_000 },
        ),
      ),
    ]);
  } catch (error) {
    if (error instanceof CooperativeAsyncCancelledError || signal?.aborted) {
      recordConsensusAudit({
        symbol: input.symbol,
        candidateId: consensusCandidateId,
        consensusStart: new Date(consensusStarted).toISOString(),
        consensusEnd: new Date().toISOString(),
        durationMs: Date.now() - consensusStarted,
        status: "CONSENSUS_TIMEOUT",
        reasonDetail: (error as Error).message,
      });
      throw error;
    }
    recordConsensusAudit({
      symbol: input.symbol,
      candidateId: consensusCandidateId,
      consensusStart: new Date(consensusStarted).toISOString(),
      consensusEnd: new Date().toISOString(),
      durationMs: Date.now() - consensusStarted,
      status: "CONSENSUS_FAILED",
      reasonDetail: (error as Error).message,
    });
    throw new Error(`${STALL_ERROR_CODES.CONSENSUS_FAILED}: ${(error as Error).message}`);
  }
  const technical = [technicalSingle];
  const momentum = [momentumSingle];
  const risk = [riskSingle];

  const providerHealthEval = evaluateProviderHealthGate(
    [technicalSingle, momentumSingle, riskSingle],
    new Date(consensusStarted).toISOString(),
  );
  consensusInput.consensusTelemetry = {
    ...consensusInput.consensusTelemetry,
    ...providerHealthEval.telemetry,
    aiPath: providerHealthEval.aiPath,
    healthyProviderCount: providerHealthEval.counts.HEALTHY,
    degradedProviderCount: providerHealthEval.counts.DEGRADED,
    unavailableProviderCount:
      providerHealthEval.counts.UNAVAILABLE +
      providerHealthEval.counts.TIMEOUT +
      providerHealthEval.counts.INVALID_RESPONSE +
      providerHealthEval.counts.RATE_LIMITED +
      providerHealthEval.counts.ABORTED,
  };

  if (providerHealthEval.gate === "ALL_DEGRADED" || providerHealthEval.eligibleForConsensus.length === 0) {
    const degradedLaneOutputs = [technicalSingle, momentumSingle, riskSingle].map((row) =>
      attachProviderHealthState(row),
    );
    const degradedConsensus = buildAllProvidersDegradedConsensusResult({
      symbol: input.symbol,
      outputs: degradedLaneOutputs,
      health: providerHealthEval,
    });
    degradedConsensus.consensusTelemetry = consensusInput.consensusTelemetry;
    bridgeConsensusResult({
      symbol: input.symbol,
      consensus: degradedConsensus,
      providers: degradedLaneOutputs,
      masterRuleId: "AI_PROVIDER_DEGRADED",
    });
    recordConsensusAudit({
      symbol: input.symbol,
      candidateId: consensusCandidateId,
      consensusStart: new Date(consensusStarted).toISOString(),
      consensusEnd: new Date().toISOString(),
      durationMs: Date.now() - consensusStarted,
      providerVotes: Object.fromEntries(
        degradedLaneOutputs.map((row) => [row.providerId, consensusVoteLabel(row)]),
      ),
      finalDecision: degradedConsensus.finalDecision,
      confidence: degradedConsensus.finalConfidence,
      status: "AI_PROVIDER_DEGRADED",
      reasonDetail: degradedConsensus.explanation,
    });
    await logTradeEvent({
      symbol: input.symbol,
      eventType: "AI_ANALYSIS_RESULT",
      reason: degradedConsensus.explanation,
      aiConfidence: 0,
      price: input.lastPrice,
      newValue: { decision: degradedConsensus.finalDecision, aiPath: providerHealthEval.aiPath },
    });
    pushLog(
      "WARN",
      `${input.symbol.toUpperCase()} AI_PROVIDER_DEGRADED: consensus suppressed (${providerHealthEval.gate})`,
    );
    return degradedConsensus;
  }

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
      aggregated.push(
        attachProviderHealthState({
          providerId,
          providerName: rows[0]?.providerName ?? providerId,
          ok: false,
          latencyMs: rows.reduce((acc, x) => acc + x.latencyMs, 0),
          error: rows.map((x) => x.error).filter(Boolean).join(" | "),
        }),
      );
      continue;
    }

    aggregated.push(
      attachProviderHealthState({
        providerId,
        providerName: rows[0]?.providerName ?? providerId,
        ok: true,
        output: aggregateModelOutputs(okRows.map((x) => x.output!), input),
        latencyMs: rows.reduce((acc, x) => acc + x.latencyMs, 0),
        remoteOk: okRows.some((x) => x.remoteOk),
        degraded: okRows.every((x) => x.degraded),
      }),
    );
  }

  const runtimeContext = await withBoundedPrisma(
    "ai-consensus.getRuntimeExecutionContext",
    () => getRuntimeExecutionContext(),
    undefined,
    { signal },
  ).catch((error) => {
    if (isTransientPrismaConnectivityError(error)) {
      pushLog(
        "WARN",
        `${input.symbol.toUpperCase()} AI memory path degraded: MEMORY_UNAVAILABLE (runtime context read transiently failed)`,
      );
      return null;
    }
    throw error;
  });
  const user = runtimeContext?.user;
  throwIfAborted(signal, "AI consensus post-lane aborted");
  const weightedAggregated = user
    ? await applyAiPerformanceWeights(user.id, aggregated)
    : aggregated.map((row) => ({ ...row }));
  await yieldAsyncStackUnwind();
  throwIfAborted(signal, "AI consensus pre-hybrid aborted");
  const hybridStarted = Date.now();
  const consensus = await runGuardedSyncPhase("hybrid_decision", () =>
    buildHybridDecision({
      analysisInput: consensusInput,
      technicalResults: technical,
      momentumResults: momentum,
      riskResults: risk,
      allOutputs: weightedAggregated,
    }),
  );
  const hybridDecisionMs = Date.now() - hybridStarted;
  consensusInput.consensusTelemetry = {
    ...consensusInput.consensusTelemetry,
    hybridDecisionMs,
    consensusAssemblyMs: Date.now() - consensusStarted,
  };
  await yieldAsyncStackUnwind();
  throwIfAborted(signal, "AI consensus post-hybrid aborted");
  const baseConsensus = summarizeConsensus(weightedAggregated);
  const finalConsensus: AIConsensusResult = {
    ...consensus,
    finalConfidence: adjustConfidenceWithAnalysisMemory(
      Number((((consensus.finalConfidence * 0.7) + (baseConsensus.finalConfidence * 0.3))).toFixed(2)),
      input.analysisMemory,
    ),
    finalRiskScore: Number((((consensus.finalRiskScore * 0.8) + (baseConsensus.finalRiskScore * 0.2))).toFixed(2)),
  };
  finalConsensus.analysisScorecard = await runGuardedSyncPhase("analysis_scorecard", () =>
    buildAnalysisScorecard(consensusInput, finalConsensus),
  );
  if (!user) {
    finalConsensus.explanation = `${finalConsensus.explanation} | MEMORY_UNAVAILABLE:NO_OPINION`;
  }
  finalConsensus.consensusTelemetry = consensusInput.consensusTelemetry;
  bridgeConsensusResult({
    symbol: input.symbol,
    consensus: finalConsensus,
    providers: weightedAggregated,
    masterRuleId: finalConsensus.decisionPayload?.consensusEngine?.finalDecision,
    providerHealthGate: providerHealthEval.gate,
  });
  if (finalConsensus.decisionPayload) {
    finalConsensus.decisionPayload.shortTermReport = await runGuardedSyncPhase("short_term_report", () =>
      buildShortTermReport(consensusInput, finalConsensus),
    );
  }
  if (user) {
    ensureAiPerformanceEvaluator(user.id);
    await recordAiPerformancePrediction({
      userId: user.id,
      symbol: input.symbol,
      entryPrice: input.lastPrice,
      outputs: weightedAggregated,
    }).catch(() => null);
    await recordAIAnalysisPrediction({
      userId: user.id,
      analysisInput: input,
      result: finalConsensus,
    });
  }
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
      providerCount: aggregated.length,
      remoteProviderCount: aggregated.filter((row) =>
        Boolean((row.output?.metadata as Record<string, unknown> | undefined)?.remote),
      ).length,
      degradedProviderCount: degradedProviders.length,
      roleScoreKeys: Object.keys(finalConsensus.roleScores ?? {}),
      hasDecisionPayload: Boolean(finalConsensus.decisionPayload),
      consensusTelemetry: consensusInput.consensusTelemetry,
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

  await logTradeEvent({
    symbol: input.symbol,
    eventType: "AI_ANALYSIS_RESULT",
    reason: finalConsensus.explanation,
    aiConfidence: finalConsensus.finalConfidence,
    price: input.lastPrice,
    newValue: {
      decision: finalConsensus.finalDecision,
      confidence: finalConsensus.finalConfidence,
      riskScore: finalConsensus.finalRiskScore,
    },
  });

  const adjudicated = await runGuardedAsyncPhase("master_adjudication", () =>
    adjudicateWithMasterDecisionEngine({
      decisionId: getActiveDecisionId() ?? createDecisionId(),
      input,
      legacyResult: finalConsensus,
      providerResults: weightedAggregated,
    }),
  );

  const persistedCalibration = await listConfidenceCalibration().catch((error) => {
    if (isTransientPrismaConnectivityError(error)) {
      pushLog(
        "WARN",
        `${input.symbol.toUpperCase()} confidence calibration unavailable: MEMORY_UNAVAILABLE/NO_OPINION`,
      );
      return [];
    }
    throw error;
  });
  const calibrationBins = mapPersistedCalibrationBins(persistedCalibration);

  const calibrated = applyConfidenceCalibrationToDecision({
    result: adjudicated,
    providerResults: weightedAggregated,
    bins: calibrationBins.length ? calibrationBins : undefined,
    marketRegime: input.marketRegime?.mode,
  });
  calibrated.consensusTelemetry = consensusInput.consensusTelemetry;
  if (calibrated.decisionPayload && typeof calibrated.decisionPayload === "object") {
    (calibrated.decisionPayload as Record<string, unknown>).consensusTelemetry =
      consensusInput.consensusTelemetry;
  }
  recordConsensusAudit({
    symbol: input.symbol,
    candidateId: consensusCandidateId,
    consensusStart: new Date(consensusStarted).toISOString(),
    consensusEnd: new Date().toISOString(),
    durationMs: Date.now() - consensusStarted,
    providerVotes: weightedAggregated.map((row) => ({
      provider: row.providerName,
      decision: row.output?.decision,
      weight: row.output?.confidence,
    })),
    finalDecision: calibrated.finalDecision,
    confidence: calibrated.finalConfidence,
    status: "COMPLETED",
  });
  return calibrated;
}
