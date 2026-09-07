/**
 * Final engineering gate — gerçek production chain:
 * fixture → evaluator/router → admission → orchestrator → paper simulator → DB → partial → stop → settlement
 * Paper adapter / order-manager / muhasebe mock'lanmaz.
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFix02DisposablePostgres, type Fix02DisposablePostgres } from "./helpers/fix02-disposable-postgres";
import { runFix01StrategyEvaluationChain } from "@/src/server/execution/fix01-strategy-evaluation-chain";
import { evaluateCanonicalRegime } from "@/src/server/forensics/p4-regime-strategy-shadow";
import { evaluateEarlyAccelerationStrategy, buildEarlyStructuralInvalidation } from "@/src/server/profitability/pr02-early-evaluator";
import { buildPr04ExitMetadataFromSelectedSignal, bootstrapPr04ExitStateFromEntry } from "@/src/server/profitability/pr04-exit-bridge";
import { resetEarlySetupStoreForTests } from "@/src/server/profitability/pr02-early-setup";
import type { DeepMarketState } from "@/src/server/market-data/spine/events";
import type { ExitTickObservation } from "@/src/server/profitability/pr04-types";

const getTickerMock = vi.hoisted(() => vi.fn());
const deepStateRef = vi.hoisted(() => ({ value: null as import("@/src/server/market-data/spine/events").DeepMarketState | null }));

vi.mock("@/lib/config", () => ({
  env: {
    EXECUTION_MODE: "paper",
    BINANCE_PLATFORM: "tr",
    PAPER_INITIAL_BALANCE_TRY: 10_000,
    PAPER_INITIAL_BALANCE_USDT: 10_000,
    EXECUTION_BLOCK_WHEN_OPEN_POSITION: false,
    EXECUTION_ALLOW_MULTI_POSITIONS: true,
    EXECUTION_MAX_OPEN_POSITIONS: 5,
    EXECUTION_ENGINE_V2_ENABLED: false,
    LIVE_TRADING_PLATFORM_ENABLED: false,
    EXECUTION_SAME_COIN_COOLDOWN_SEC: 0,
    EXECUTION_FAST_MIN_CONFIDENCE: 50,
    EXECUTION_MIN_RR_RATIO: 1,
    EXECUTION_MIN_EDGE_MULTIPLIER: 1,
    EXECUTION_FULL_BALANCE_ENABLED: false,
    EXECUTION_DEFAULT_TAKE_PROFIT_PERCENT: 1.2,
    EXECUTION_DEFAULT_STOP_LOSS_PERCENT: 0.8,
    EXECUTION_DEFAULT_MAX_DURATION_SEC: 600,
    EXECUTION_TARGET_LONG_WINDOW_SEC: 1200,
    EXECUTION_TARGET_MIN_PROFIT_PERCENT: 0.5,
    EXECUTION_TARGET_MAX_PROFIT_PERCENT: 3,
    EXECUTION_BLOCK_HIGH_VOLATILITY_PERCENT: 5,
    EXECUTION_VARIANT_D_SHADOW_ENABLED: false,
    EXECUTION_VARIANT_D_ENABLED: false,
    RISK_TOTAL_CAPITAL_TRY: 100000,
    SCANNER_MIN_VOLUME_24H: 1000,
    SCANNER_SHORT_HORIZON_SEC: 30,
    EXECUTION_PUMP_STOP_LOSS_HIGH_SCORE: 80,
    EXECUTION_PUMP_STOP_LOSS_MID_SCORE: 60,
    EXECUTION_PUMP_STOP_LOSS_HIGH_PERCENT: 1,
    EXECUTION_PUMP_STOP_LOSS_MID_PERCENT: 1,
    EXECUTION_PUMP_STOP_LOSS_LOW_PERCENT: 1,
    EXECUTION_PUMP_MIN_STOP_LOSS_PERCENT: 0.5,
    AI_QUALITY_PROFILE: "normal",
    AI_SPOT_MIN_CONFIDENCE_ULTRA: 50,
    AI_ULTRA_MAX_RISK_SCORE_SPOT: 99,
    AI_LEVERAGE_MIN_CONFIDENCE_ULTRA: 50,
    AI_ULTRA_MAX_RISK_SCORE_LEVERAGE: 99,
    BINANCE_API_KEY: "",
    BINANCE_API_SECRET: "",
    BINANCE_ENV: "testnet",
  },
  isProd: false,
}));

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/services/log.service", () => ({ pushLog: vi.fn() }));
vi.mock("@/services/binance.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/binance.service")>();
  return {
    ...actual,
    calculateValidQuantity: vi.fn(async (_s: string, q: number) => q),
    cancelOrder: vi.fn(),
    estimateFees: vi.fn(async () => ({ estimatedTakerFee: 0.1 })),
    getAccountBalances: vi.fn(async () => []),
    getTicker: getTickerMock,
    getOrderStatus: vi.fn(async () => ({ status: "FILLED", executedQty: 1 })),
    placeLimitBuy: vi.fn(),
    placeLimitSell: vi.fn(),
    placeMarketBuy: vi.fn(),
    placeMarketBuyByQuote: vi.fn(),
    placeMarketSell: vi.fn(),
    resolveExchangeSymbol: vi.fn(async (symbol: string) => symbol),
    getExecutionVenueEligibility: vi.fn(async () => ({ executionVenueEligible: true })),
    getKlines: vi.fn().mockResolvedValue([]),
    getOrderBook: vi.fn().mockResolvedValue({
      bids: [{ price: 99.9, quantity: 10 }],
      asks: [{ price: 100.1, quantity: 10 }],
    }),
    validateSymbolFilters: vi.fn(async (_symbol: string, quantity: number, price: number) => ({
      ok: true,
      quantity,
      price,
      reasons: [],
    })),
  };
});
vi.mock("@/services/binance-global.service", () => ({
  calculateGlobalValidQuantity: vi.fn(async (_s: string, q: number) => q),
  getGlobalTicker: vi.fn(async () => ({ price: 100 })),
  isGlobalLeverageEnabled: vi.fn(() => false),
  placeGlobalMarketBuy: vi.fn(),
  placeGlobalMarketSell: vi.fn(),
  toGlobalLeverageSymbol: vi.fn((s: string) => s),
}));
vi.mock("@/src/server/execution/fix01-strategy-context-builder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/server/execution/fix01-strategy-context-builder")>();
  return {
    ...actual,
    buildStrategyEvaluationContexts: vi.fn((input) =>
      actual.buildStrategyEvaluationContexts({
        ...input,
        deepState: deepStateRef.value,
      }),
    ),
  };
});
vi.mock("@/src/server/execution/execution-event-bus", () => ({ publishExecutionEvent: vi.fn() }));
vi.mock("@/src/server/scanner", () => ({
  getScannerWorkerSnapshot: vi.fn(() => ({ detailed: null, updatedAt: null })),
  pauseScannerWorker: vi.fn(),
  pauseScannerWorkerUntilResume: vi.fn(),
  resumeScannerWorker: vi.fn(),
  runScannerPipeline: vi.fn(async () => ({ candidates: [] })),
}));
vi.mock("@/src/server/scanner/fast-entry.service", () => ({ getBestFastEntry: vi.fn(async () => null) }));
vi.mock("@/src/server/observability/trade-event-log", () => ({ logTradeEvent: vi.fn() }));
vi.mock("@/src/server/notifications/notification.service", () => ({ notifySystemEvent: vi.fn() }));
vi.mock("@/src/server/forensics/forensic-bridge.service", () => ({
  bridgeAiExecutionGate: vi.fn(),
  bridgeClosedTradePnl: vi.fn(),
  bridgeEntryTimingForensics: vi.fn(),
  bridgeExecutionCandidateForensic: vi.fn(),
  bridgeFeeEdgeMetrics: vi.fn(),
  bridgeFeeAwareEntryPolicy: vi.fn(),
  bridgeMeanReversionEntry: vi.fn(),
  bridgePaperFill: vi.fn(),
  bridgeStrategyDecision: vi.fn(),
  bridgeTdiDecision: vi.fn(),
}));
vi.mock("@/src/server/execution/position-monitor.service", () => ({
  isPositionMonitorActive: vi.fn(() => false),
  startPositionMonitor: vi.fn(),
  stopAllPositionMonitors: vi.fn(),
  stopPositionMonitor: vi.fn(),
}));
vi.mock("@/src/server/forensics/forensic-context", () => ({ getForensicSession: vi.fn(() => null) }));
vi.mock("@/src/server/forensics/fee-edge-metrics.service", () => ({ computeFeeEdgeMetrics: vi.fn(() => ({ estimatedRoundTripFees: 0.2 })) }));
vi.mock("@/src/server/forensics/decision-time-tdi-telemetry.service", () => ({
  attachPositionIdToSnapshot: vi.fn(async () => undefined),
  buildDecisionFeatureSnapshot: vi.fn(() => ({ roundId: "1", runId: "r-1", sessionId: "s-1", decisionTimestamp: new Date().toISOString() })),
}));
vi.mock("@/src/server/forensics/forensic-collector.service", () => ({ createCandidateId: vi.fn(() => "cand-fe") }));
vi.mock("@/src/server/execution-management/execution-replay.service", () => ({ replayExecutionRecord: vi.fn(async () => undefined) }));
vi.mock("@/src/server/market-data/spine/market-data-daemon", () => ({
  getMarketDataDaemon: vi.fn(() => ({
    getLatest: vi.fn(() => null),
    isFresh: vi.fn(() => true),
    getDeepState: vi.fn(() => deepStateRef.value),
    telemetry: vi.fn(() => ({})),
  })),
}));
vi.mock("@/src/server/execution/ai-execution-gate.service", () => ({
  resolveAiExecutionGatePolicy: vi.fn(() => "ADVISORY"),
  evaluateAiExecutionReadiness: vi.fn(() => ({
    verdict: "AI_GATE_PASS",
    policy: "ADVISORY",
    reasonCode: "AI_PASS",
    reasonDetail: "ok",
    aiRawDecision: "BUY",
    aiFinalDecision: "BUY",
    consensusDecision: "BUY",
    executionSide: "BUY",
    timestamp: new Date().toISOString(),
  })),
}));
vi.mock("@/src/server/risk/canonical-risk-decision.service", () => ({
  evaluateCanonicalRiskDecision: vi.fn(async () => ({ verdict: "ALLOW", reasonCodes: [], reasons: [], metrics: {}, timestamp: new Date().toISOString() })),
}));
vi.mock("@/src/server/execution-safety/pre-trade-validator.service", () => ({
  runPreTradeSafetyValidation: vi.fn(async () => ({ passed: true, safetyId: "safe-1", blockedBy: null, rejectReason: null })),
}));
vi.mock("@/src/server/execution/signal-quality-gate.service", () => ({
  evaluateSignalQualityGate: vi.fn(() => ({
    ok: true,
    qualityScore: 80,
    weightedTotal: 80,
    minimumRequiredScore: 50,
    criteriaScores: {},
    scoreBreakdown: {},
    confidenceTier: "HIGH",
    decision: "ALLOW",
    whyAccepted: ["ok"],
    whyRejected: [],
    strengths: [],
    reasons: [],
    weights: {},
  })),
}));
vi.mock("@/src/server/execution/smart-entry-engine.service", () => ({
  evaluateSmartEntryEngine: vi.fn(async () => ({ pass: true, reason: "ok", details: {} })),
}));
vi.mock("@/src/server/orchestration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/server/orchestration")>();
  return {
    ...actual,
    evaluateOrchestration: vi.fn(async () => ({
      action: "ALLOW",
      vetoReasons: [],
      persisted: true,
      orchestrationScore: 1,
      suppressionScore: 0,
      uncertaintyScore: 0,
      edgeHealthScore: 1,
      clusterRiskScore: 0,
      confidenceAdjusted: 80,
      riskMultiplier: 1,
    })),
    persistOrchestrationEnvelope: vi.fn(async () => ({ persisted: true })),
  };
});
vi.mock("@/src/server/recovery/failsafe-recovery.service", () => ({
  getSafeModeState: vi.fn(async () => ({ enabled: false })),
  persistAnalysisState: vi.fn(async () => undefined),
  claimIdempotentExecutionIntent: vi.fn(async () => ({ claimed: true, existing: null })),
  getIdempotentExecution: vi.fn(async () => null),
  setIdempotentExecution: vi.fn(async () => undefined),
  setSafeModeState: vi.fn(async () => undefined),
}));
vi.mock("@/src/server/candidate/candidate-store.service", () => ({
  getCanonicalCandidateStore: vi.fn(() => ({
    getCandidate: vi.fn(() => ({ candidateId: "cand-fe-chain" })),
    transitionCandidate: vi.fn(),
    registerExecutionIntent: vi.fn(() => ({ ok: true })),
  })),
}));
vi.mock("@/src/server/hot-path/execution-attempt-lock.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/server/hot-path/execution-attempt-lock.service")>();
  return {
    ...actual,
    claimCanonicalExecutionAttempt: vi.fn(() => ({ ok: true })),
    claimDurableCanonicalExecutionAttempt: vi.fn(async () => ({ ok: true, fenceToken: "fence-1" })),
  };
});
vi.mock("@/src/server/trading-core/protection/failsafe-state", () => ({ tradingFailsafeState: { snapshot: () => ({ maxDrawdownPercent: 0 }) } }));
vi.mock("@/src/server/execution-management/unified-execution-pipeline.service", () => ({
  resolveUnifiedExecutionPlan: vi.fn(async (input?: { quoteSpend?: number }) => {
    const quoteSpend = input?.quoteSpend ?? 1000;
    const quantity = Number((quoteSpend / 100).toFixed(8));
    return {
      ok: true,
      quantity,
      quoteSpend,
      validation: { ok: true, reasons: [], marketPrice: 100, notional: quoteSpend, adjustedQuantity: quantity },
    };
  }),
}));
vi.mock("@/src/server/execution/order-validation.layer", () => ({
  validatePreTrade: vi.fn(async (_input?: { quoteSpend?: number }) => {
    const quoteSpend = _input?.quoteSpend ?? 1000;
    const quantity = Number((quoteSpend / 100).toFixed(8));
    return { ok: true, reasons: [], marketPrice: 100, notional: quoteSpend, adjustedQuantity: quantity };
  }),
}));
vi.mock("@/src/server/execution/execution-intelligence.service", () => ({
  buildExecutionTelemetry: vi.fn(() => ({ fillStatus: "FILLED", slippagePct: 0, fillTimeMs: 10 })),
  evaluatePreSubmitExecution: vi.fn(() => ({ allowed: true, depthCoverage: 1, estimatedSlippagePct: 0 })),
  resolveAdaptiveRetryPolicy: vi.fn(() => ({ shouldRetry: false, backoffMs: 0 })),
}));
vi.mock("@/src/server/metrics/self-optimization.service", () => ({
  evaluateAdaptiveCandidate: vi.fn(async () => ({ ok: true, score: 1, reason: "ok", components: {} })),
}));
vi.mock("@/src/server/execution/paper-persistence-reconciliation.service", () => ({
  markPaperPersistenceReconciliation: vi.fn(async () => ({ positionMarked: true, reconciliationPersisted: true })),
}));
vi.mock("@/src/server/execution/fee-profile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/server/execution/fee-profile")>();
  return {
    ...actual,
    resolveRoundTripTakerFeePercent: vi.fn(() => 0.2),
  };
});
vi.mock("@/src/server/execution/smart-targeting.service", () => ({
  resolvePartialTakeProfitPlan: vi.fn(() => ({ tiers: [] })),
  resolveSmartTakeProfitPercent: vi.fn((input: { baseTpPercent: number }) => input.baseTpPercent ?? 1),
}));
vi.mock("@/src/server/execution/smart-exit-engine.service", () => ({
  buildInitialSmartExitPlan: vi.fn(() => ({ adaptiveTp: 1.2 })),
}));
vi.mock("@/src/server/execution/risk-efficiency.service", () => ({
  resolveRiskEfficiencyAdjustment: vi.fn((input: { notional: number; quantity: number; baseStopLossPercent: number }) => ({
    portfolioBlocked: false,
    adjustedNotional: input.notional,
    adjustedQuantity: input.quantity,
    stopLossPercent: input.baseStopLossPercent,
    notionalMultiplier: 1,
    portfolioAction: "PASS",
    portfolioAllocation: {},
    stopLossSource: "BASE",
    factors: {},
  })),
  resolveVolatilityAwareStopLossPercent: vi.fn((input: { baseStopLossPercent: number }) => ({
    stopLossPercent: input.baseStopLossPercent,
  })),
}));
vi.mock("@/src/server/execution/profit-thresholds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/server/execution/profit-thresholds")>();
  return {
    ...actual,
    shouldRejectHighRiskLowConfidenceEntry: vi.fn(() => ({ reject: false, reason: null })),
  };
});
vi.mock("@/src/server/config/strategy-runtime.service", () => ({
  getRuntimeStrategyParams: vi.fn(async () => ({ trailingStartPercent: 0.6, trailingGapPercent: 0.3 })),
}));
vi.mock("@/src/server/trading-core/feedback-loop", () => ({ feedbackLoopEngine: { rejectTrade: vi.fn(async () => undefined) } }));
vi.mock("@/src/server/repositories/risk.repository", () => ({
  getRiskConfigByUser: vi.fn(async () => ({ metadata: {} })),
  getConsecutiveLossCount: vi.fn(async () => 0),
}));
vi.mock("@/src/server/risk", () => ({
  evaluateRuntimeRisk: vi.fn(async () => ({ shouldClose: false })),
  getEffectiveRiskConfig: vi.fn(async () => ({ maxOpenPositions: 5, apiFailureBreaker: 3, consecutiveLossBreaker: 3 })),
  pauseSystemByRisk: vi.fn(),
  registerDomainApiFailure: vi.fn(async () => ({ count: 0 })),
  resetDomainApiFailure: vi.fn(async () => undefined),
  resetApiFailure: vi.fn(async () => undefined),
  resumeSystem: vi.fn(),
}));
vi.mock("@/src/server/trading-core/self-learning/learning-store", () => ({
  getCrossModeLearningPolicy: vi.fn(async () => null),
  getImmediateLearningRiskPolicy: vi.fn(async () => null),
  resolveAdaptiveAdjustment: vi.fn(() => ({ allowed: true, minScoreDelta: 0 })),
  resolveImmediateLearningRiskAdjustment: vi.fn(() => ({ allowed: true, minScoreDelta: 0, reason: "ok" })),
}));

let disposable: Fix02DisposablePostgres | null = null;
let prisma: typeof import("@/src/server/db/prisma").prisma;
const baseNow = Date.parse("2026-09-06T10:00:00.000Z");
const marketEventAt = new Date(baseNow - 20_000).toISOString();
const evaluatedAt = new Date(baseNow).toISOString();

const orchestratorCandidate = {
  rank: 1,
  context: {
    symbol: "BTCTRY",
    lastPrice: 100,
    change24h: 1.2,
    volume24h: 12_000_000,
    volumeSpikePercent: 0.25,
    spreadPercent: 0.02,
    volatilityPercent: 0.35,
    momentumPercent: 0.55,
    orderBookImbalance: 0.15,
    buyPressure: 0.25,
    shortCandleSignal: 0.6,
    fakeSpikeScore: 0.05,
    pumpIntensity: 0.15,
    pumpRisk: 0.08,
    tradable: true,
    rejectReasons: [],
    metadata: {
      opportunityCandidateId: "cand-fe-chain",
      opportunityLifecycleId: "life-fe",
      firstDetectionPrice: 100.2,
      sourceType: "SYNTHETIC_FIXTURE",
      marketDataTimestamp: marketEventAt,
      strategyStatus: "PAPER_EXPERIMENT",
      shortMomentumPercent: 0.35,
      shortFlowImbalance: 0.1,
      tradeVelocity: 0.85,
      priceAcceleration: 0.8,
      volumeAcceleration: 0.78,
      relativeStrength: 0.75,
      exhaustion: 0.15,
      retracement: 0.2,
      breakoutHeld: true,
      rangeScore: 0.35,
      distanceFromMean: 0.25,
      flowRecovery: 0.75,
      trendStrength: 0.85,
      volatilityRatio: 0.3,
      regimeTransitionProbability: 0.1,
      regimeChaosProbability: 0.05,
      pumpScore: 0.15,
      expectedMovePercent: 2.5,
      takerFeePercent: 0.1,
      strategyProfitBuffer: 0.2,
      expectedSlippageBps: 3,
      bidDepth: 600_000,
      askDepth: 550_000,
      liquidityScore: 85,
      marketRegime: "TREND_UP",
      marketRegimeStrategy: "early_acceleration",
      marketRegimeOpenTradeAllowed: true,
    },
  },
  score: {
    symbol: "BTCTRY",
    score: 82,
    confidence: 84,
    status: "QUALIFIED" as const,
    reasons: [],
    metrics: {
      momentum: 1,
      microMomentum: 1,
      volume: 1,
      spread: 1,
      volatility: 1,
      orderBook: 1,
      pressure: 1,
      microFlow: 1,
      velocity: 1,
      candle: 1,
      fakeSpikePenalty: 0,
      liquidityPenalty: 0,
      pumpBoost: 0,
      pumpRiskPenalty: 0,
    },
  },
  ai: {
    finalDecision: "BUY" as const,
    finalConfidence: 86,
    finalRiskScore: 18,
    score: 86,
    explanation: "fixture",
    outputs: [{
      providerId: "p",
      providerName: "p",
      ok: true,
      output: { decision: "BUY", confidence: 86, targetPrice: null, stopPrice: null, estimatedDurationSec: 600, reasoningShort: "ok", riskScore: 18, metadata: {} },
      latencyMs: 10,
      healthState: "HEALTHY",
    }],
    rejected: false,
    generatedAt: evaluatedAt,
    analysisScorecard: {
      symbol: "BTCTRY",
      currentPrice: 100,
      direction: "BUY",
      confidenceScore: 86,
      expectedMovePercent: 2.2,
      expectedMoveRange: { min: 1, max: 3 },
      targetSellPercent: 1.2,
      initialStopPercent: 0.6,
      trailingStartPercent: 0.6,
      trailingGapPercent: 0.3,
      riskLevel: "LOW",
      reasons: [],
      invalidationReason: null,
      timeHorizonMinutes: 10,
    },
  },
};

function earlyTrades() {
  const rows = [];
  for (let i = 0; i < 30; i++) {
    const t = baseNow - 58_000 + i * 1_800;
    rows.push({
      type: "trade" as const,
      symbol: "BTCTRY",
      price: 100 + i * 0.02,
      quantity: 1,
      quoteNotional: 140 + i,
      eventTime: t,
      tradeTime: t,
      receiveTime: t,
      buyerMaker: i % 5 === 0,
      takerSide: (i % 5 === 0 ? "SELL" : "BUY") as "BUY" | "SELL",
      source: "memory" as const,
    });
  }
  for (let i = 0; i < 12; i++) {
    const t = baseNow - 4_500 + i * 400;
    rows.push({
      type: "trade" as const,
      symbol: "BTCTRY",
      price: 100.6 + i * 0.03,
      quantity: 1,
      quoteNotional: 180 + i * 5,
      eventTime: t,
      tradeTime: t,
      receiveTime: t,
      buyerMaker: false,
      takerSide: "BUY" as const,
      source: "memory" as const,
    });
  }
  return rows;
}

function book(price = 101.2) {
  return {
    symbol: "BTCTRY",
    bestBid: price - 0.02,
    bestBidQty: 2,
    bestAsk: price + 0.02,
    bestAskQty: 2,
    spreadAbsolute: 0.04,
    spreadBps: 4,
    eventTime: baseNow,
    lastUpdateAt: baseNow,
    stale: false,
  };
}

function breakoutCandles() {
  const base = baseNow;
  const mk = (i: number, o: number, h: number, l: number, c: number) => {
    const openTime = base - (10 - i) * 30_000;
    const closeTime = openTime + 30_000;
    return { openTime, closeTime, open: o, high: h, low: l, close: c, volume: 1000, closed: true, availableAt: closeTime };
  };
  return [
    mk(0, 98, 99, 97.5, 98.5),
    mk(1, 98.5, 99.2, 98.2, 99),
    mk(2, 99, 99.6, 98.8, 99.4),
    mk(3, 99.2, 100, 99, 99.8),
    mk(4, 99.5, 99.7, 99.1, 99.3),
    mk(5, 99.2, 99.5, 99, 99.2),
    mk(6, 99.5, 101.5, 99.4, 101.3),
    mk(7, 101.2, 101.4, 99.9, 100.8),
    mk(8, 100.7, 101.8, 100.5, 101.5),
    mk(9, 101.4, 102, 101.2, 101.9),
  ];
}

function deepState(): DeepMarketState {
  const candles = breakoutCandles();
  return {
    symbol: "BTCTRY",
    venue: "BINANCE",
    recentTrades: earlyTrades(),
    klines1m: candles.map((c) => ({
      openTime: c.openTime,
      closeTime: c.closeTime,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      closed: c.closed,
      eventAt: c.closeTime,
      availableAt: c.availableAt,
    })),
    bookTicker: book(101.2),
    lastPrice: 101.2,
    lastUpdateAt: baseNow,
  };
}

function strategyInput() {
  return {
    candidateId: "cand-fe-chain",
    sourceType: "SYNTHETIC_FIXTURE" as const,
    marketEventAt,
    evaluatedAt,
    velocity: 0.85,
    acceleration: 0.8,
    volumeAcceleration: 0.78,
    relativeStrength: 0.75,
    spreadBps: 8,
    liquidityScore: 80,
    exhaustion: 0.15,
    momentum: 0.8,
    retracement: 0.2,
    breakoutHeld: true,
    rangeScore: 0.35,
    distanceFromMean: 0.25,
    flowRecovery: 0.75,
    entrySpread: 0.05,
    entrySlippage: 0.03,
    entryFee: 0.1,
    exitSpread: 0.05,
    exitSlippage: 0.03,
    exitFee: 0.1,
    strategyProfitBuffer: 0.2,
    expectedMovePercent: 2.5,
  };
}

function bullRegime() {
  return evaluateCanonicalRegime({
    marketEventAt,
    detectedAt: evaluatedAt,
    trend: 0.85,
    volatility: 0.3,
    momentum: 0.85,
    transitionProbability: 0.1,
    chaosProbability: 0.05,
    pumpScore: 0.15,
  });
}

function obs(mark: number, offsetMs: number): ExitTickObservation {
  const t = baseNow + offsetMs;
  return { eventId: `evt-fe-${t}`, eventAtMs: t, availableAtMs: t, markPrice: mark, bid: mark - 0.1, ask: mark + 0.1, high: mark + 0.2, low: mark - 0.2, closed: true, stale: false, dataGap: false };
}

async function readFinancialSnapshot(userId: string, positionId?: string) {
  const { getPaperAccount } = await import("@/src/server/simulation/paper-trading.service");
  const { resolveBalancesForMode } = await import("@/src/server/execution-management/balance-resolver.service");
  const { syncPaperPortfolio } = await import("@/src/server/paper-validation/paper-portfolio.service");
  const account = await getPaperAccount(userId);
  const balances = await resolveBalancesForMode({ userId, mode: "paper", quoteAsset: "TRY", baseAsset: "BTC" });
  const portfolio = await syncPaperPortfolio(userId);
  const position = positionId ? await prisma.position.findUnique({ where: { id: positionId } }) : null;
  const bundle = positionId
    ? await prisma.positionExitPersistedState.findUnique({ where: { positionId } })
    : null;
  const state = (bundle?.state as Record<string, unknown> | null) ?? null;
  const executionCount = positionId
    ? await prisma.tradeExecution.count({ where: { tradeOrder: { positionId } } })
    : 0;
  const settlementReceiptCount = positionId
    ? await prisma.positionSettlementFill.count({ where: { positionId } })
    : 0;
  return {
    availableCashTry: Number(account.balances.TRY ?? 0),
    availableCashResolved: Number(balances.availableQuote ?? balances.availableBalance ?? 0),
    btcBalance: Number(account.balances.BTC ?? 0),
    lockedBalance: Number(portfolio.lockedBalance ?? 0),
    positionQty: Number(position?.quantity ?? 0),
    reservedSellQty: Number((state as { reservedSellQuantity?: number } | null)?.reservedSellQuantity ?? 0),
    unrealizedPnl: Number(portfolio.unrealizedPnl ?? position?.unrealizedPnl ?? 0),
    equity: Number(portfolio.balance ?? 0),
    executionCount,
    settlementReceiptCount,
    entryFeeAllocated: Number(((position?.metadata as Record<string, unknown> | null)?.entryFeeAllocated ?? 0) as number),
  };
}

describe.sequential("Final engineering production chain", () => {
  beforeAll(async () => {
    disposable = await createFix02DisposablePostgres();
    vi.resetModules();
    prisma = (await import("@/src/server/db/prisma")).prisma;
    await import("@/src/server/execution/fix02-exit-persistence.service");
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    if (disposable) await disposable.cleanup();
  }, 60_000);

  beforeEach(async () => {
    resetEarlySetupStoreForTests();
    vi.clearAllMocks();
    getTickerMock.mockImplementation(async () => ({ symbol: "BTCTRY", price: 100, change24h: 0, volume24h: 0 }));
    process.env.EXECUTION_PR04_EXIT_EVAL_ENABLED = "true";
    process.env.EXECUTION_PR04_EXIT_ROUTING_ENABLED = "true";
    process.env.PAPER_INITIAL_BALANCE_TRY = "10000";
    await prisma.positionSettlementFill.deleteMany();
    await prisma.positionExitPersistedState.deleteMany();
    await prisma.profitLossRecord.deleteMany();
    await prisma.paperTrade.deleteMany();
    await prisma.tradeExecution.deleteMany();
    await prisma.tradeOrder.deleteMany();
    await prisma.position.deleteMany();
    await prisma.appSetting.deleteMany({ where: { key: { startsWith: "paper.account." } } });
    await prisma.exchangeConnection.deleteMany();
    await prisma.user.deleteMany();
  });

  it("fixture → evaluator/router/admission → orchestrator → gerçek paper → partial → stop → authoritative cash/exposure", async () => {
    const early = evaluateEarlyAccelerationStrategy(strategyInput(), bullRegime(), {
      trades: earlyTrades(),
      book: book(101.2),
      baselinePrice: 100,
      firstDetectionPrice: 100.2,
      lifecycleId: "life-fe",
      nowMs: baseNow,
    });
    expect(early.trigger.triggered).toBe(true);

    deepStateRef.value = deepState();

    const { runFix01StrategyEvaluationChain } = await import("@/src/server/execution/fix01-strategy-evaluation-chain");
    const chain = runFix01StrategyEvaluationChain({
      symbol: "BTCTRY",
      venue: "BINANCE",
      candidateId: "cand-fe-chain",
      lifecycleId: "life-fe",
      featureSnapshotId: "feat-fe",
      decisionAtMs: baseNow,
      strategyInput: strategyInput(),
      regime: bullRegime(),
      deepState: deepState(),
      baselinePrice: 100,
      firstDetectionPrice: 100.2,
    });
    expect(chain.selectedSignal).not.toBeNull();
    expect(chain.router.preferredStrategy).toBeTruthy();

    const suffix = crypto.randomUUID().slice(0, 8);
    const user = await prisma.user.create({
      data: { email: `fe-${suffix}@example.com`, username: `fe_${suffix}`, passwordHash: "hash", status: "ACTIVE" },
    });
    await prisma.exchangeConnection.create({
      data: { userId: user.id, exchange: "BINANCE", name: "paper", apiKeyMasked: "x", apiSecretEncrypted: "y", isSandbox: true, status: "CONNECTED" },
    });
    await prisma.tradingPair.upsert({
      where: { symbol: "BTCTRY" },
      update: {},
      create: { symbol: "BTCTRY", baseAsset: "BTC", quoteAsset: "TRY" },
    });
    const { resetPaperAccount } = await import("@/src/server/simulation/paper-trading.service");
    await resetPaperAccount(user.id);

    const before = await readFinancialSnapshot(user.id);
    expect(before.availableCashTry).toBeCloseTo(10_000, 2);
    expect(before.btcBalance).toBeCloseTo(0, 8);
    expect(before.positionQty).toBe(0);

    const { executeAnalyzeAndTrade } = await import("@/src/server/execution/execution-orchestrator.service");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(baseNow);
    const entry = await executeAnalyzeAndTrade({
      userId: user.id,
      executionMode: "paper",
      learningLane: true,
      requestedSymbol: "BTCTRY",
      requestedQuoteAmountTry: 8_000,
      preselectedCandidate: orchestratorCandidate as never,
      campaignId: `cmp-fe-${suffix}`,
      roundId: "1",
      runId: "run-fe",
      sessionId: `sess-fe-${suffix}`,
    });
    nowSpy.mockRestore();
    expect(entry.opened, JSON.stringify(entry)).toBe(true);
    expect(entry.positionId).toBeTruthy();

    const positionId = entry.positionId!;
    const afterEntry = await readFinancialSnapshot(user.id, positionId);
    expect(afterEntry.positionQty).toBeGreaterThan(0);
    expect(afterEntry.availableCashTry).toBeLessThan(before.availableCashTry);
    expect(afterEntry.btcBalance).toBeGreaterThan(0);
    expect(afterEntry.executionCount).toBeGreaterThanOrEqual(1);

    const opened = await prisma.position.findUnique({ where: { id: positionId } });
    expect(opened).not.toBeNull();
    const entryPrice = Number(opened!.entryPrice);
    const entryQty = Number(opened!.quantity);
    const entryFee = Number(((opened!.metadata as Record<string, unknown> | null)?.entryFeeTotal ?? 0) as number);
    const invalidation = buildEarlyStructuralInvalidation({
      baselinePrice: 100,
      firstDetectionPrice: 100.2,
      latestPrice: entryPrice * 1.015,
      asOfMs: baseNow,
    });
    const selectedSignal = chain.selectedSignal!;
    const exitSnapshot = buildPr04ExitMetadataFromSelectedSignal({
      positionId,
      selectedSignal: { ...selectedSignal, invalidation },
      takeProfitPercent: 50,
      exitPolicyId: "STRUCTURAL_PARTIAL_TRAIL",
    });
    await prisma.positionExitPersistedState.deleteMany({ where: { positionId } });
    bootstrapPr04ExitStateFromEntry({
      snapshot: exitSnapshot,
      side: "LONG",
      entryPrice,
      quantity: entryQty,
      entryFee,
      openedAtMs: opened!.openedAt.getTime(),
    });
    const { bootstrapExitPersistenceAtEntry } = await import("@/src/server/execution/fix02-exit-persistence.service");
    await bootstrapExitPersistenceAtEntry({
      userId: user.id,
      positionId,
      selectedSignal,
      snapshot: exitSnapshot,
      side: "LONG",
      entryFills: [{ price: entryPrice, quantity: entryQty, fee: entryFee, atMs: opened!.openedAt.getTime() }],
      entryFee,
      ownerExecutionId: `exec-fe-${suffix}`,
    });

    const partialMark = Number((entryPrice * 1.026).toFixed(4));
    getTickerMock.mockImplementation(async (symbol: string) => ({
      symbol,
      price: partialMark,
      change24h: 0,
      volume24h: 0,
    }));
    const { processFix02Pr04ExitTick } = await import("@/src/server/execution/fix02-exit-routing.service");
    const partial = await processFix02Pr04ExitTick({
      executionId: `exec-fe-${suffix}`,
      positionId,
      userId: user.id,
      side: "LONG",
      mode: "paper",
      observation: obs(partialMark, 2_000),
    });
    expect(partial.partial, JSON.stringify(partial)).toBe(true);
    const afterPartial = await readFinancialSnapshot(user.id, positionId);
    expect(afterPartial.positionQty).toBeGreaterThan(0);
    expect(afterPartial.positionQty).toBeLessThan(afterEntry.positionQty);
    expect(afterPartial.settlementReceiptCount).toBe(1);
    expect(afterPartial.btcBalance).toBeLessThan(afterEntry.btcBalance);

    getTickerMock.mockImplementation(async (symbol: string) => ({
      symbol,
      price: 90,
      change24h: 0,
      volume24h: 0,
    }));
    const stop = await processFix02Pr04ExitTick({
      executionId: `exec-fe-${suffix}`,
      positionId,
      userId: user.id,
      side: "LONG",
      mode: "paper",
      observation: obs(90, 3_000),
    });
    expect(stop.closed).toBe(true);
    const afterStop = await readFinancialSnapshot(user.id, positionId);
    expect(afterStop.positionQty).toBe(0);
    expect(afterStop.settlementReceiptCount).toBe(2);
    expect(afterStop.reservedSellQty).toBe(0);
    expect(afterStop.btcBalance).toBeCloseTo(0, 6);

    const closed = await prisma.position.findUnique({ where: { id: positionId } });
    expect(closed?.status).toBe("CLOSED");
    const fills = await prisma.positionSettlementFill.findMany({ where: { positionId } });
    expect(fills).toHaveLength(2);
    const dupReplay = await processFix02Pr04ExitTick({
      executionId: `exec-fe-${suffix}`,
      positionId,
      userId: user.id,
      side: "LONG",
      mode: "paper",
      observation: obs(90, 4_000),
    });
    expect(dupReplay.closed).toBe(false);
    const afterDup = await readFinancialSnapshot(user.id, positionId);
    expect(afterDup.settlementReceiptCount).toBe(afterStop.settlementReceiptCount);
    expect(afterDup.executionCount).toBe(afterStop.executionCount);
  }, 120_000);

  it("iki worker aynı miktarda satmaya çalışırken order-manager tek satışa izin verir", async () => {
    const { settleOpenPosition } = await import("@/src/server/execution/post-trade-settlement.service");
    const suffix = crypto.randomUUID().slice(0, 8);
    const user = await prisma.user.create({
      data: { email: `fe2-${suffix}@example.com`, username: `fe2_${suffix}`, passwordHash: "hash", status: "ACTIVE" },
    });
    const conn = await prisma.exchangeConnection.create({
      data: { userId: user.id, exchange: "BINANCE", name: "paper", apiKeyMasked: "x", apiSecretEncrypted: "y", isSandbox: true, status: "CONNECTED" },
    });
    const pair = await prisma.tradingPair.upsert({
      where: { symbol: "BTCTRY" },
      update: {},
      create: { symbol: "BTCTRY", baseAsset: "BTC", quoteAsset: "TRY" },
    });
    const position = await prisma.position.create({
      data: {
        userId: user.id,
        exchangeConnectionId: conn.id,
        tradingPairId: pair.id,
        side: "LONG",
        status: "OPEN",
        entryPrice: 100,
        quantity: 1,
        openedAt: new Date(baseNow),
        metadata: { mode: "live", executionId: `exec-fe2-${suffix}` },
      },
    });
    await prisma.tradeOrder.create({
      data: {
        userId: user.id,
        exchangeConnectionId: conn.id,
        tradingPairId: pair.id,
        positionId: position.id,
        side: "SELL",
        type: "MARKET",
        quantity: 1,
        status: "NEW",
      },
    });
    const binance = await import("@/services/binance.service");
    const sellSpy = vi.spyOn(binance, "placeMarketSell");
    sellSpy.mockResolvedValue({ orderId: "live-1", clientOrderId: "c1", symbol: "BTCTRY", side: "SELL", type: "MARKET", status: "FILLED", executedQty: 1, price: 99 });
    const [first, second] = await Promise.all([
      settleOpenPosition({ executionId: `exec-fe2-a-${suffix}`, positionId: position.id, reason: "STOP_LOSS", mode: "live", requestedCloseQuantity: 1 }),
      settleOpenPosition({ executionId: `exec-fe2-b-${suffix}`, positionId: position.id, reason: "STOP_LOSS", mode: "live", requestedCloseQuantity: 1 }),
    ]);
    const blocked = [first, second].filter((r) => !((r as { closed?: boolean }).closed || (r as { partial?: boolean }).partial));
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(sellSpy.mock.calls.length).toBeLessThanOrEqual(1);
    expect(await prisma.tradeOrder.count({ where: { positionId: position.id, side: "SELL" } })).toBe(1);
  }, 60_000);
});
