import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const idempotency = new Map<string, Record<string, unknown>>();
  const events: Array<Record<string, unknown>> = [];
  return {
    idempotency,
    events,
    liveSubmitCount: 0,
    paperOrderCount: 0,
    paperFillCount: 0,
    tradeExecutionCount: 0,
    positionCount: 0,
    orderCount: 0,
    timeoutMode: false,
  };
});

const candidate = {
  rank: 1,
  context: {
    symbol: "BTCTRY",
    lastPrice: 100,
    change24h: 1,
    volume24h: 10_000_000,
    volumeSpikePercent: 0.2,
    spreadPercent: 0.02,
    volatilityPercent: 0.3,
    momentumPercent: 0.4,
    orderBookImbalance: 0.1,
    buyPressure: 0.2,
    shortCandleSignal: 0.5,
    fakeSpikeScore: 0.1,
    pumpIntensity: 0.2,
    pumpRisk: 0.1,
    tradable: true,
    rejectReasons: [],
    metadata: {
      opportunityCandidateId: "cand-1",
      shortMomentumPercent: 0.2,
      shortFlowImbalance: 0.05,
      tradeVelocity: 0.2,
      bidDepth: 500_000,
      askDepth: 500_000,
      liquidityScore: 80,
      marketRegime: "RANGE_SIDEWAYS",
      marketRegimeStrategy: "default",
    },
  },
  score: {
    symbol: "BTCTRY",
    score: 80,
    confidence: 82,
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
    finalConfidence: 85,
    finalRiskScore: 20,
    score: 85,
    explanation: "strong setup",
    outputs: [{ providerId: "p", providerName: "p", ok: true, output: { decision: "BUY", confidence: 85, targetPrice: null, stopPrice: null, estimatedDurationSec: 600, reasoningShort: "ok", riskScore: 20, metadata: {} }, latencyMs: 10, healthState: "HEALTHY" }],
    rejected: false,
    generatedAt: new Date().toISOString(),
    analysisScorecard: {
      symbol: "BTCTRY",
      currentPrice: 100,
      direction: "BUY",
      confidenceScore: 85,
      expectedMovePercent: 2,
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

vi.mock("@/lib/config", () => ({
  env: {
    EXECUTION_MODE: "paper",
    BINANCE_PLATFORM: "tr",
    EXECUTION_BLOCK_WHEN_OPEN_POSITION: false,
    EXECUTION_ALLOW_MULTI_POSITIONS: true,
    EXECUTION_MAX_OPEN_POSITIONS: 5,
    EXECUTION_ENGINE_V2_ENABLED: false,
    LIVE_TRADING_PLATFORM_ENABLED: false,
    EXECUTION_SAME_COIN_COOLDOWN_SEC: 0,
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
  },
  isProd: false,
}));

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/services/log.service", () => ({ pushLog: vi.fn() }));
vi.mock("@/services/binance.service", () => ({
  calculateValidQuantity: vi.fn(async (_s: string, q: number) => q),
  cancelOrder: vi.fn(),
  estimateFees: vi.fn(async () => ({ estimatedTakerFee: 0.1 })),
  getAccountBalances: vi.fn(async () => []),
  getTicker: vi.fn(async () => ({ price: 100 })),
  getOrderStatus: vi.fn(async () => ({ status: "FILLED", executedQty: 1 })),
  placeLimitBuy: vi.fn(async () => {
    state.liveSubmitCount += 1;
    return { orderId: "live-limit-buy" };
  }),
  placeLimitSell: vi.fn(async () => {
    state.liveSubmitCount += 1;
    return { orderId: "live-limit-sell" };
  }),
  placeMarketBuy: vi.fn(async () => {
    state.liveSubmitCount += 1;
    return { orderId: "live-market-buy" };
  }),
  placeMarketBuyByQuote: vi.fn(async () => {
    state.liveSubmitCount += 1;
    return { orderId: "live-market-buy-quote" };
  }),
  placeMarketSell: vi.fn(async () => {
    state.liveSubmitCount += 1;
    return { orderId: "live-market-sell" };
  }),
  resolveExchangeSymbol: vi.fn(async (symbol: string) => symbol),
  getExecutionVenueEligibility: vi.fn(async () => ({ executionVenueEligible: true })),
}));
vi.mock("@/services/binance-global.service", () => ({
  calculateGlobalValidQuantity: vi.fn(async (_s: string, q: number) => q),
  getGlobalTicker: vi.fn(async () => ({ price: 100 })),
  isGlobalLeverageEnabled: vi.fn(() => false),
  placeGlobalMarketBuy: vi.fn(),
  placeGlobalMarketSell: vi.fn(),
  toGlobalLeverageSymbol: vi.fn((s: string) => s),
}));

vi.mock("@/src/server/repositories/execution.repository", () => ({
  bindDecisionFeatureSnapshotPositionId: vi.fn(async () => undefined),
  getRuntimeExecutionContext: vi.fn(async () => ({ user: { id: "u-1" }, connection: { id: "c-1" } })),
  getEmergencyStopState: vi.fn(async () => false),
  listOpenPositionsByUser: vi.fn(async () => []),
  getExecutionPolicySetting: vi.fn(async () => ({})),
  ensureTradingPair: vi.fn(async () => ({ id: "pair-1", symbol: "BTCTRY", quoteAsset: "TRY", baseAsset: "BTC" })),
  createTradeSignalFromConsensus: vi.fn(async () => ({ id: "sig-1" })),
  createTradeOrder: vi.fn(async () => {
    state.orderCount += 1;
    return { id: `order-${state.orderCount}` };
  }),
  addTradeExecution: vi.fn(async () => {
    state.tradeExecutionCount += 1;
  }),
  createPosition: vi.fn(async () => {
    state.positionCount += 1;
    return { id: `pos-${state.positionCount}`, side: "LONG", openedAt: new Date() };
  }),
  attachOrderToPosition: vi.fn(async () => undefined),
  findTradeOrderById: vi.fn(),
  findLatestClosedPositionBySymbol: vi.fn(async () => null),
  getPositionById: vi.fn(async () => ({ id: "pos-1", metadata: {} })),
  setEmergencyStopState: vi.fn(),
  updateOrderStatus: vi.fn(),
  updatePositionMarkPrice: vi.fn(),
}));

vi.mock("@/src/server/candidate/candidate-store.service", () => ({
  getCanonicalCandidateStore: vi.fn(() => ({
    getCandidate: vi.fn(() => ({ candidateId: "cand-1" })),
    transitionCandidate: vi.fn(),
    registerExecutionIntent: vi.fn(() => ({ ok: true })),
  })),
}));
vi.mock("@/src/server/hot-path/execution-attempt-lock.service", () => ({
  claimCanonicalExecutionAttempt: vi.fn(() => ({ ok: true })),
}));
vi.mock("@/src/server/exchange-simulator/paper-exchange-adapter.service", () => ({
  executePaperOrderViaExchangeSimulator: vi.fn(async () => {
    state.paperOrderCount += 1;
    if (state.timeoutMode) {
      throw new Error("TIMEOUT paper simulation");
    }
    return {
      orderId: `paper-order-${state.paperOrderCount}`,
      clientOrderId: `paper-order-${state.paperOrderCount}`,
      symbol: "BTCTRY",
      side: "BUY",
      type: "MARKET",
      status: "FILLED",
      executedQty: 1,
      price: 100,
      metadata: { simulationId: "sim-1", fillCount: 1 },
    };
  }),
}));
vi.mock("@/src/server/paper-validation/paper-trade-recorder.service", () => ({
  recordPaperFillEvent: vi.fn(async () => {
    state.paperFillCount += 1;
  }),
}));

vi.mock("@/src/server/recovery/failsafe-recovery.service", () => ({
  getSafeModeState: vi.fn(async () => ({ enabled: false })),
  persistAnalysisState: vi.fn(async () => undefined),
  claimIdempotentExecutionIntent: vi.fn(async (userId: string, key: string, executionId: string) => {
    const storageKey = `${userId}:${key}`;
    const existing = state.idempotency.get(storageKey) ?? null;
    if (existing) return { claimed: false, existing };
    const row = { executionId, executionState: "IN_PROGRESS", opened: false, rejected: false };
    state.idempotency.set(storageKey, row);
    return { claimed: true, existing: null };
  }),
  getIdempotentExecution: vi.fn(async (userId: string, key: string) => state.idempotency.get(`${userId}:${key}`) ?? null),
  setIdempotentExecution: vi.fn(async (userId: string, key: string, value: Record<string, unknown>) => {
    state.idempotency.set(`${userId}:${key}`, value);
  }),
  setSafeModeState: vi.fn(async () => undefined),
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
vi.mock("@/src/server/metrics/self-optimization.service", () => ({
  evaluateAdaptiveCandidate: vi.fn(async () => ({ ok: true, score: 1, reason: "ok", components: {} })),
}));
vi.mock("@/src/server/orchestration", () => ({
  evaluateOrchestration: vi.fn(async () => ({ action: "ALLOW", vetoReasons: [], persisted: true, orchestrationScore: 1, suppressionScore: 0, uncertaintyScore: 0, edgeHealthScore: 1, clusterRiskScore: 0, confidenceAdjusted: 80, riskMultiplier: 1 })),
}));
vi.mock("@/src/server/execution/execution-intelligence.service", () => ({
  buildExecutionTelemetry: vi.fn(() => ({ fillStatus: "FILLED", slippagePct: 0, fillTimeMs: 10 })),
  evaluatePreSubmitExecution: vi.fn(() => ({ allowed: true, depthCoverage: 1, estimatedSlippagePct: 0 })),
  resolveAdaptiveRetryPolicy: vi.fn(() => ({ shouldRetry: false, backoffMs: 0 })),
}));
vi.mock("@/src/server/execution-management/unified-execution-pipeline.service", () => ({
  resolveUnifiedExecutionPlan: vi.fn(async () => ({ ok: true, quantity: 1, quoteSpend: 100, validation: { ok: true, reasons: [], marketPrice: 100, notional: 100, adjustedQuantity: 1 } })),
}));
vi.mock("@/src/server/execution/order-validation.layer", () => ({
  validatePreTrade: vi.fn(async () => ({ ok: true, reasons: [], marketPrice: 100, notional: 100, adjustedQuantity: 1 })),
}));
vi.mock("@/src/server/execution/execution-event-bus", () => ({
  publishExecutionEvent: vi.fn((event: Record<string, unknown>) => state.events.push(event)),
}));
vi.mock("@/src/server/repositories/risk.repository", () => ({
  getRiskConfigByUser: vi.fn(async () => ({ metadata: {} })),
  getConsecutiveLossCount: vi.fn(async () => 0),
}));
vi.mock("@/src/server/repositories/log.repository", () => ({
  addSystemLog: vi.fn(async () => undefined),
}));
vi.mock("@/src/server/repositories/audit.repository", () => ({
  addAuditLog: vi.fn(async () => undefined),
}));
vi.mock("@/src/server/risk", () => ({
  evaluateRuntimeRisk: vi.fn(async () => ({ shouldClose: false })),
  getEffectiveRiskConfig: vi.fn(async () => ({ maxOpenPositions: 5, apiFailureBreaker: 3 })),
  pauseSystemByRisk: vi.fn(),
  registerDomainApiFailure: vi.fn(async () => ({ count: 0 })),
  resetDomainApiFailure: vi.fn(async () => undefined),
  resetApiFailure: vi.fn(async () => undefined),
  resumeSystem: vi.fn(),
}));

vi.mock("@/src/server/notifications/notification.service", () => ({ notifySystemEvent: vi.fn(async () => undefined) }));
vi.mock("@/src/server/trading-core/feedback-loop", () => ({ feedbackLoopEngine: { rejectTrade: vi.fn(async () => undefined) } }));
vi.mock("@/src/server/observability/trade-lifecycle", () => ({ logTradeLifecycle: vi.fn(async () => undefined) }));
vi.mock("@/src/server/observability/trade-event-log", () => ({ logTradeEvent: vi.fn(async () => undefined) }));
vi.mock("@/src/server/observability/heartbeat", () => ({ markHeartbeat: vi.fn() }));
vi.mock("@/src/server/observability/decision-observability.service", () => ({
  beginDecisionTrace: vi.fn(() => ({})),
  observeDeferredExecutionResult: vi.fn(),
  observeTradeDecision: vi.fn(),
  recordDecisionTimelineEvent: vi.fn(),
}));
vi.mock("@/src/server/observability/decision-trace-context", () => ({ runWithDecisionTrace: vi.fn(async (_ctx: unknown, fn: () => Promise<unknown>) => fn()) }));
vi.mock("@/src/server/execution/position-monitor.service", () => ({
  isPositionMonitorActive: vi.fn(() => false),
  startPositionMonitor: vi.fn(),
  stopAllPositionMonitors: vi.fn(),
  stopPositionMonitor: vi.fn(),
}));
vi.mock("@/src/server/execution/post-trade-settlement.service", () => ({
  settleOpenPosition: vi.fn(async () => ({ closed: true })),
  syncUnrealizedPnl: vi.fn(async () => null),
}));
vi.mock("@/src/server/forensics/forensic-context", () => ({ getForensicSession: vi.fn(() => null) }));
vi.mock("@/src/server/forensics/forensic-bridge.service", () => ({
  bridgeAiExecutionGate: vi.fn(),
  bridgeEntryTimingForensics: vi.fn(),
  bridgeExecutionCandidateForensic: vi.fn(),
  bridgeFeeEdgeMetrics: vi.fn(),
  bridgeFeeAwareEntryPolicy: vi.fn(),
  bridgeMeanReversionEntry: vi.fn(),
  bridgeStrategyDecision: vi.fn(),
  bridgeTdiDecision: vi.fn(),
}));
vi.mock("@/src/server/forensics/fee-edge-metrics.service", () => ({ computeFeeEdgeMetrics: vi.fn(() => ({ estimatedRoundTripFees: 0.2 })) }));
vi.mock("@/src/server/forensics/decision-time-tdi-telemetry.service", () => ({
  attachPositionIdToSnapshot: vi.fn(async () => undefined),
  buildDecisionFeatureSnapshot: vi.fn(() => ({ roundId: "1", runId: "r-1", sessionId: "s-1", decisionTimestamp: new Date().toISOString() })),
}));
vi.mock("@/src/server/forensics/forensic-collector.service", () => ({ createCandidateId: vi.fn(() => "cand-1") }));
vi.mock("@/src/server/execution/paper-persistence-reconciliation.service", () => ({ markPaperPersistenceReconciliation: vi.fn(async () => ({ positionMarked: true, reconciliationPersisted: true })) }));
vi.mock("@/src/server/execution-management/execution-replay.service", () => ({ replayExecutionRecord: vi.fn(async () => undefined) }));
vi.mock("@/src/server/scanner", () => ({
  getScannerWorkerSnapshot: vi.fn(() => ({ detailed: null, updatedAt: null })),
  pauseScannerWorker: vi.fn(),
  pauseScannerWorkerUntilResume: vi.fn(),
  resumeScannerWorker: vi.fn(),
  runScannerPipeline: vi.fn(async () => ({ candidates: [] })),
}));
vi.mock("@/src/server/scanner/fast-entry.service", () => ({ getBestFastEntry: vi.fn(async () => ({ selected: candidate })) }));
vi.mock("@/src/server/scanner/market-context-builder", () => ({ buildMarketContext: vi.fn(async () => null) }));
vi.mock("@/src/server/scanner/signal-scoring.engine", () => ({ scoreContext: vi.fn(() => ({ score: 70, confidence: 70 })) }));
vi.mock("@/src/server/scanner/momentum-breakout.service", () => ({ evaluateMomentumBreakout: vi.fn(() => false) }));
vi.mock("@/src/server/config/strategy-runtime.service", () => ({ getRuntimeStrategyParams: vi.fn(async () => ({ trailingStartPercent: 0.6, trailingGapPercent: 0.3 })) }));
vi.mock("@/src/server/execution/authority-counters.service", () => ({ recordLearningEvaluation: vi.fn() }));
vi.mock("@/src/server/execution/fee-profile", () => ({ resolveRoundTripTakerFeePercent: vi.fn(() => 0.2) }));
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
vi.mock("@/src/server/execution/profit-thresholds", () => ({
  shouldRejectHighRiskLowConfidenceEntry: vi.fn(() => ({ reject: false, reason: null })),
}));
vi.mock("@/src/server/trading-core/protection/failsafe-state", () => ({ tradingFailsafeState: { snapshot: () => ({ maxDrawdownPercent: 0 }) } }));
vi.mock("@/src/server/trading-core/self-learning/learning-store", () => ({
  getCrossModeLearningPolicy: vi.fn(async () => null),
  getImmediateLearningRiskPolicy: vi.fn(async () => null),
  resolveAdaptiveAdjustment: vi.fn(() => ({ allowed: true, minScoreDelta: 0 })),
  resolveImmediateLearningRiskAdjustment: vi.fn(() => ({ allowed: true, minScoreDelta: 0, reason: "ok" })),
}));

describe("P0 orchestrator deterministic proofs", () => {
  beforeEach(() => {
    state.idempotency.clear();
    state.events.length = 0;
    state.liveSubmitCount = 0;
    state.paperOrderCount = 0;
    state.paperFillCount = 0;
    state.tradeExecutionCount = 0;
    state.positionCount = 0;
    state.orderCount = 0;
    state.timeoutMode = false;
  });

  it("P0-B01: opens deterministic paper position via executeAnalyzeAndTrade", async () => {
    const { executeAnalyzeAndTrade } = await import("@/src/server/execution/execution-orchestrator.service");
    const result = await executeAnalyzeAndTrade({
      executionMode: "paper",
      learningLane: true,
      requestedSymbol: "BTCTRY",
      requestedQuoteAmountTry: 1000,
      preselectedCandidate: candidate as never,
      campaignId: "cmp-1",
      roundId: "1",
      runId: "run-1",
      sessionId: "sess-1",
    });

    expect(result.opened).toBe(true);
    expect(result.positionId).toBeTruthy();
    expect(state.paperOrderCount).toBe(1);
    expect(state.paperFillCount).toBeGreaterThanOrEqual(1);
    expect(state.orderCount).toBe(1);
    expect(state.tradeExecutionCount).toBe(1);
    expect(state.positionCount).toBe(1);
    expect(state.liveSubmitCount).toBe(0);
  }, 20_000);

  it("P0-B07: timeout keeps idempotent intent in-progress and blocks duplicate retry", async () => {
    state.timeoutMode = true;
    const { executeAnalyzeAndTrade } = await import("@/src/server/execution/execution-orchestrator.service");
    const first = await executeAnalyzeAndTrade({
      executionMode: "paper",
      learningLane: true,
      requestedSymbol: "BTCTRY",
      requestedQuoteAmountTry: 1000,
      preselectedCandidate: candidate as never,
      campaignId: "cmp-2",
      roundId: "1",
      runId: "run-2",
      sessionId: "sess-2",
    });
    expect(first.opened).toBe(false);
    expect(first.rejected).toBe(true);

    const second = await executeAnalyzeAndTrade({
      executionMode: "paper",
      learningLane: true,
      requestedSymbol: "BTCTRY",
      requestedQuoteAmountTry: 1000,
      preselectedCandidate: candidate as never,
      campaignId: "cmp-2",
      roundId: "1",
      runId: "run-2",
      sessionId: "sess-2",
    });

    expect(second.opened).toBe(false);
    expect(second.rejected).toBe(true);
    expect(state.paperOrderCount).toBeLessThanOrEqual(1);
    expect(state.paperFillCount).toBeLessThanOrEqual(1);
    expect(state.positionCount).toBeLessThanOrEqual(1);
    expect(state.liveSubmitCount).toBe(0);
    expect(state.events.some((event) => event.stage === "PAPER_ORDER_SIMULATION_FAILED")).toBe(true);
  }, 20_000);
});
