/**
 * Canonical selection → handoff → AI hydration → orchestrator → risk → paper execution
 * Uses disposable PostgreSQL and production services. AI provider is the only consensus mock boundary.
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFix02DisposablePostgres, type Fix02DisposablePostgres } from "./helpers/fix02-disposable-postgres";
import { resetCanonicalCandidateStoreForTests } from "@/src/server/candidate/candidate-store.service";
import {
  attachCanonicalHandoff,
  buildCanonicalHandoffMetadata,
  validateCanonicalHandoffRecord,
} from "@/src/server/execution/canonical-handoff.service";
import {
  buildAiConsensus,
  buildHandoffCandidate,
  buildScannerCandidateWithoutAi,
  CHAIN_CANDIDATE_ID,
  CHAIN_SYMBOL,
  seedExecutionReadyCandidate,
} from "./helpers/canonical-paper-chain-fixtures";

const getTickerMock = vi.hoisted(() => vi.fn());
const runAiConsensusMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/config", () => ({
  env: {
    EXECUTION_MODE: "paper",
    BINANCE_PLATFORM: "tr",
    PAPER_INITIAL_BALANCE_TRY: 10_000,
    PAPER_INITIAL_BALANCE_USDT: 10_000,
    EXECUTION_BLOCK_WHEN_OPEN_POSITION: false,
    EXECUTION_ALLOW_MULTI_POSITIONS: true,
    EXECUTION_MAX_OPEN_POSITIONS: 3,
    EXECUTION_ENGINE_V2_ENABLED: false,
    LIVE_TRADING_ENABLED: false,
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
    AI_QUALITY_PROFILE: "normal",
    BINANCE_API_KEY: "",
    BINANCE_API_SECRET: "",
    BINANCE_ENV: "testnet",
  },
  isProd: false,
}));

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/services/log.service", () => ({ pushLog: vi.fn() }));
vi.mock("@/src/server/ai/analysis-orchestrator", () => ({
  runAIConsensusFromInput: runAiConsensusMock,
}));
vi.mock("@/src/server/scanner/ai-request-formatter", () => ({
  formatAIRequest: vi.fn(async () => ({ symbol: CHAIN_SYMBOL })),
}));
vi.mock("@/src/server/config/strategy-runtime.service", () => ({
  getRuntimeStrategyParams: vi.fn(async () => ({ trailingStartPercent: 0.6, trailingGapPercent: 0.3 })),
}));
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
      bids: [{ price: 99.9, quantity: 1000 }],
      asks: [{ price: 100.1, quantity: 1000 }],
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
vi.mock("@/src/server/execution/execution-event-bus", () => ({ publishExecutionEvent: vi.fn() }));
vi.mock("@/src/server/scanner", () => ({
  getScannerWorkerSnapshot: vi.fn(() => ({ detailed: null, updatedAt: null })),
  pauseScannerWorker: vi.fn(),
  pauseScannerWorkerUntilResume: vi.fn(),
  resumeScannerWorker: vi.fn(),
  runScannerPipeline: vi.fn(async () => ({ candidates: [] })),
}));
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
  bridgeRiskSizing: vi.fn(),
  bridgeStrategyDecision: vi.fn(),
  bridgeTdiDecision: vi.fn(),
}));
vi.mock("@/src/server/execution/execution-intelligence.service", () => ({
  buildExecutionTelemetry: vi.fn(() => ({ fillStatus: "FILLED", slippagePct: 0, fillTimeMs: 10 })),
  evaluatePreSubmitExecution: vi.fn(() => ({ allowed: true, depthCoverage: 1, estimatedSlippagePct: 0.1 })),
  resolveAdaptiveRetryPolicy: vi.fn(() => ({ shouldRetry: false, backoffMs: 0 })),
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
vi.mock("@/src/server/forensics/forensic-collector.service", () => ({ createCandidateId: vi.fn(() => CHAIN_CANDIDATE_ID) }));
vi.mock("@/src/server/execution-management/execution-replay.service", () => ({ replayExecutionRecord: vi.fn(async () => undefined) }));
vi.mock("@/src/server/market-data/spine/market-data-daemon", () => ({
  getMarketDataDaemon: vi.fn(() => ({
    getLatest: vi.fn(() => null),
    isFresh: vi.fn(() => true),
    getDeepState: vi.fn(() => null),
    telemetry: vi.fn(() => ({})),
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
vi.mock("@/src/server/execution/paper-persistence-reconciliation.service", () => ({
  markPaperPersistenceReconciliation: vi.fn(async () => ({ positionMarked: true, reconciliationPersisted: true })),
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
vi.mock("@/src/server/execution/smart-targeting.service", () => ({
  resolvePartialTakeProfitPlan: vi.fn(() => ({ tiers: [] })),
  resolveSmartTakeProfitPercent: vi.fn((input: { baseTpPercent: number }) => input.baseTpPercent ?? 1),
}));
vi.mock("@/src/server/execution/smart-exit-engine.service", () => ({
  buildInitialSmartExitPlan: vi.fn(() => ({ adaptiveTp: 1.2 })),
}));
vi.mock("@/src/server/risk/canonical-risk-decision.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/server/risk/canonical-risk-decision.service")>();
  return {
    ...actual,
    evaluateCanonicalRiskDecision: vi.fn(async () => ({
      verdict: "ALLOW",
      reasonCodes: [],
      reasons: [],
      metrics: {},
      timestamp: new Date().toISOString(),
      candidateId: CHAIN_CANDIDATE_ID,
    })),
  };
});
vi.mock("@/src/server/execution-safety/pre-trade-validator.service", () => ({
  runPreTradeSafetyValidation: vi.fn(async () => ({ passed: true, safetyId: "safe-1", blockedBy: null, rejectReason: null })),
}));
vi.mock("@/src/server/execution/smart-entry-engine.service", () => ({
  evaluateSmartEntryEngine: vi.fn(async () => ({ pass: true, reason: "ok", details: {} })),
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
vi.mock("@/src/server/recovery/failsafe-recovery.service", () => ({
  getSafeModeState: vi.fn(async () => ({ enabled: false })),
  persistAnalysisState: vi.fn(async () => undefined),
  claimIdempotentExecutionIntent: vi.fn(async () => ({ claimed: true, existing: null })),
  getIdempotentExecution: vi.fn(async () => null),
  setIdempotentExecution: vi.fn(async () => undefined),
  setSafeModeState: vi.fn(async () => undefined),
}));
vi.mock("@/src/server/execution/signal-quality-gate.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/server/execution/signal-quality-gate.service")>();
  return {
    ...actual,
    evaluateSignalQualityGate: vi.fn(() => ({
      ok: true,
      qualityScore: 80,
      weightedTotal: 80,
      minimumRequiredScore: 60,
      criteriaScores: {},
      scoreBreakdown: {},
      confidenceTier: "HIGH_CONFIDENCE",
      decision: "APPROVE",
      whyAccepted: ["integration-fixture"],
      whyRejected: [],
      strengths: [],
      reasons: [],
      weights: {
        marketRegimeAlignment: 0.1,
        higherTimeframeTrendAlignment: 0.12,
        technicalSetupQuality: 0.13,
        entryTimingQuality: 0.1,
        volumeConfirmation: 0.1,
        momentumQuality: 0.1,
        liquiditySafety: 0.1,
        newsSentimentAlignment: 0.08,
        volatilitySuitability: 0.08,
        riskRewardQuality: 0.09,
      },
    })),
  };
});
vi.mock("@/src/server/metrics/self-optimization.service", () => ({
  evaluateAdaptiveCandidate: vi.fn(async () => ({ ok: true, score: 80, reason: "ok", components: {} })),
}));
vi.mock("@/src/server/orchestration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/server/orchestration")>();
  return {
    ...actual,
    evaluateOrchestration: vi.fn(async () => ({
      action: "ALLOW",
      vetoReasons: [],
      persisted: true,
      orchestrationScore: 85,
      suppressionScore: 0,
      uncertaintyScore: 0,
      edgeHealthScore: 80,
      clusterRiskScore: 0,
      confidenceAdjusted: 86,
      riskMultiplier: 1,
    })),
    persistOrchestrationEnvelope: vi.fn(async () => ({ persisted: true })),
  };
});
vi.mock("@/src/server/trading-core/self-learning/learning-store", () => ({
  getCrossModeLearningPolicy: vi.fn(async () => null),
  getImmediateLearningRiskPolicy: vi.fn(async () => null),
  resolveAdaptiveAdjustment: vi.fn(() => ({ allowed: true, minScoreDelta: 0 })),
  resolveImmediateLearningRiskAdjustment: vi.fn(() => ({ allowed: true, minScoreDelta: 0, reason: "ok" })),
}));

let disposable: Fix02DisposablePostgres | null = null;
let prisma: typeof import("@/src/server/db/prisma").prisma;

async function seedUser() {
  const suffix = crypto.randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: { email: `cpc-${suffix}@example.com`, username: `cpc_${suffix}`, passwordHash: "hash", status: "ACTIVE" },
  });
  const connection = await prisma.exchangeConnection.create({
    data: { userId: user.id, exchange: "BINANCE", name: "paper", apiKeyMasked: "x", apiSecretEncrypted: "y", isSandbox: true, status: "CONNECTED" },
  });
  await prisma.tradingPair.upsert({
    where: { symbol: CHAIN_SYMBOL },
    update: {},
    create: { symbol: CHAIN_SYMBOL, baseAsset: "BTC", quoteAsset: "TRY" },
  });
  const { resetPaperAccount } = await import("@/src/server/simulation/paper-trading.service");
  await resetPaperAccount(user.id);
  return { user, connection };
}

describe.sequential("canonical paper full chain (disposable PostgreSQL)", () => {
  beforeAll(async () => {
    disposable = await createFix02DisposablePostgres();
    vi.resetModules();
    prisma = (await import("@/src/server/db/prisma")).prisma;
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    if (disposable) await disposable.cleanup();
  }, 60_000);

  beforeEach(async () => {
    resetCanonicalCandidateStoreForTests();
    vi.clearAllMocks();
    getTickerMock.mockImplementation(async () => ({ symbol: CHAIN_SYMBOL, price: 100, change24h: 0, volume24h: 0 }));
    runAiConsensusMock.mockResolvedValue(buildAiConsensus());
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

  it("CASE 1 — valid BUY path via canonical handoff hydration (no manual .ai inject)", async () => {
    const { user } = await seedUser();
    const record = seedExecutionReadyCandidate();
    const selected = buildHandoffCandidate(record);
    expect(selected.ai).toBeUndefined();
    const validation = validateCanonicalHandoffRecord(
      (selected.context.metadata as Record<string, unknown>).canonicalHandoff as never,
      CHAIN_SYMBOL,
    );
    expect(validation.ok).toBe(true);

    const { executeAnalyzeAndTrade } = await import("@/src/server/execution/execution-orchestrator.service");
    const result = await executeAnalyzeAndTrade({
      userId: user.id,
      executionMode: "paper",
      learningLane: true,
      requestedSymbol: CHAIN_SYMBOL,
      requestedQuoteAmountTry: 2_000,
      preselectedCandidate: selected,
      campaignId: "cmp-case-1",
      roundId: "1",
      runId: "run-case-1",
      sessionId: "sess-case-1",
    });

    expect(runAiConsensusMock).toHaveBeenCalled();
    expect(result.opened, JSON.stringify(result)).toBe(true);
    expect(result.executionId).toBeTruthy();
    expect(result.positionId).toBeTruthy();

    const orders = await prisma.tradeOrder.count({ where: { userId: user.id } });
    const executions = await prisma.tradeExecution.count({ where: { tradeOrder: { userId: user.id } } });
    const positions = await prisma.position.count({ where: { userId: user.id, status: "OPEN" } });
    expect(orders).toBeGreaterThan(0);
    expect(executions).toBeGreaterThan(0);
    expect(positions).toBe(1);
  }, 120_000);

  it("CASE 2 — AI NO_TRADE produces rejection without paper order", async () => {
    runAiConsensusMock.mockResolvedValue(
      buildAiConsensus({
        finalDecision: "NO_TRADE",
        finalConfidence: 35,
        analysisScorecard: {
          symbol: CHAIN_SYMBOL,
          currentPrice: 100,
          direction: "WAIT",
          confidenceScore: 35,
          expectedMovePercent: 0,
          expectedMoveRange: { min: 0, max: 0 },
          targetSellPercent: 0,
          initialStopPercent: 0,
          trailingStartPercent: 0,
          trailingGapPercent: 0,
          riskLevel: "MEDIUM",
          reasons: ["low volume"],
          invalidationReason: null,
          timeHorizonMinutes: 10,
        },
      }),
    );
    const { user } = await seedUser();
    const record = seedExecutionReadyCandidate();
    const selected = buildHandoffCandidate(record);
    const { executeAnalyzeAndTrade } = await import("@/src/server/execution/execution-orchestrator.service");
    const result = await executeAnalyzeAndTrade({
      userId: user.id,
      executionMode: "paper",
      learningLane: true,
      requestedSymbol: CHAIN_SYMBOL,
      requestedQuoteAmountTry: 1_000,
      preselectedCandidate: selected,
      campaignId: "cmp-case-2",
    });
    expect(result.opened).toBe(false);
    expect(result.rejected).toBe(true);
    expect(String(result.rejectReason ?? "").toUpperCase()).toMatch(/NO_TRADE|LOW_CONFIDENCE|AI/);
    const orders = await prisma.tradeOrder.count({ where: { userId: user.id } });
    expect(orders).toBe(0);
  });

  it("CASE 3 — entry quality rejection with structured reason", async () => {
    runAiConsensusMock.mockResolvedValue(
      buildAiConsensus({
        finalDecision: "BUY",
        finalConfidence: 50,
        finalRiskScore: 100,
        analysisScorecard: {
          symbol: CHAIN_SYMBOL,
          currentPrice: 100,
          direction: "BUY",
          confidenceScore: 50,
          expectedMovePercent: 1,
          expectedMoveRange: { min: 0, max: 2 },
          targetSellPercent: 1,
          initialStopPercent: 0.5,
          trailingStartPercent: 0.3,
          trailingGapPercent: 0.2,
          riskLevel: "LOW",
          reasons: [],
          invalidationReason: null,
          timeHorizonMinutes: 10,
        },
      }),
    );
    const { user } = await seedUser();
    const record = seedExecutionReadyCandidate();
    const selected = buildHandoffCandidate(record);
    const { executeAnalyzeAndTrade } = await import("@/src/server/execution/execution-orchestrator.service");
    const result = await executeAnalyzeAndTrade({
      userId: user.id,
      executionMode: "paper",
      learningLane: true,
      requestedSymbol: CHAIN_SYMBOL,
      requestedQuoteAmountTry: 1_000,
      preselectedCandidate: selected,
      campaignId: "cmp-case-3",
    });
    expect(result.opened).toBe(false);
    expect(String(result.rejectReason ?? "")).toContain("Entry quality");
    expect(String(result.rejectReason ?? "")).not.toContain("UNCLASSIFIED_TERMINAL_REASON");
    const orders = await prisma.tradeOrder.count({ where: { userId: user.id } });
    expect(orders).toBe(0);
  });

  it("CASE 4 — risk rejection when max open positions reached", async () => {
    const { user, connection } = await seedUser();
    const pair = await prisma.tradingPair.findUnique({ where: { symbol: CHAIN_SYMBOL } });
    for (let i = 0; i < 3; i++) {
      await prisma.position.create({
        data: {
          userId: user.id,
          exchangeConnectionId: connection.id,
          tradingPairId: pair!.id,
          side: "LONG",
          status: "OPEN",
          quantity: 0.01,
          entryPrice: 100,
          metadata: { mode: "paper", campaignId: "cmp-other" },
        },
      });
    }
    const { evaluatePreTradeRisk } = await import("@/src/server/risk/risk-evaluation.service");
    const risk = await evaluatePreTradeRisk({
      userId: user.id,
      symbol: CHAIN_SYMBOL,
      confidencePercent: 80,
      spreadPercent: 0.02,
      liquidity24h: 1_000_000,
      expectedProfitPercent: 1,
      slippagePercent: 0.1,
      volatilityPercent: 0.3,
      riskPerTradePercent: 0.5,
      stopLossConfigured: true,
    });
    expect(risk.ok).toBe(false);
    expect(risk.reasons.join(" ").toLowerCase()).toMatch(/max open positions/);
  });

  it("CASE 5 — expired canonical candidate rejected at handoff", async () => {
    const { user } = await seedUser();
    const store = (await import("@/src/server/candidate/candidate-store.service")).getCanonicalCandidateStore();
    const now = Date.now();
    store.createCandidate({
      candidateId: CHAIN_CANDIDATE_ID,
      symbol: CHAIN_SYMBOL,
      lane: "STEADY",
      detectedAt: now - 120_000,
      detectedPrice: 100,
      ttlMs: 1_000,
    });
    store.updateCandidate(CHAIN_CANDIDATE_ID, { state: "EXECUTION_READY", expiresAt: now - 1_000 });
    const record = store.getCandidate(CHAIN_CANDIDATE_ID)!;
    const selected = buildHandoffCandidate(record);
    const validation = validateCanonicalHandoffRecord(
      (selected.context.metadata as Record<string, unknown>).canonicalHandoff as never,
      CHAIN_SYMBOL,
    );
    expect(validation.ok).toBe(false);
    if (!validation.ok) expect(validation.reasonCode).toMatch(/HANDOFF_CANDIDATE_EXPIRED/);

    const { executeAnalyzeAndTrade } = await import("@/src/server/execution/execution-orchestrator.service");
    const result = await executeAnalyzeAndTrade({
      userId: user.id,
      executionMode: "paper",
      learningLane: true,
      requestedSymbol: CHAIN_SYMBOL,
      requestedQuoteAmountTry: 1_000,
      preselectedCandidate: selected,
      campaignId: "cmp-case-5",
    });
    expect(result.opened).toBe(false);
    expect(String(result.rejectReason ?? "")).toMatch(/HANDOFF_CANDIDATE_EXPIRED|HANDOFF_/);
    expect(runAiConsensusMock).not.toHaveBeenCalled();
  });

  it("CASE 6 — identity mismatch rejected safely", async () => {
    const { user } = await seedUser();
    const store = (await import("@/src/server/candidate/candidate-store.service")).getCanonicalCandidateStore();
    const now = Date.now();
    store.createCandidate({
      candidateId: CHAIN_CANDIDATE_ID,
      symbol: "ETHTRY",
      lane: "STEADY",
      detectedAt: now,
      detectedPrice: 100,
    });
    store.updateCandidate(CHAIN_CANDIDATE_ID, { state: "EXECUTION_READY", expiresAt: now + 600_000 });
    const record = store.getCandidate(CHAIN_CANDIDATE_ID)!;
    const handoff = buildCanonicalHandoffMetadata({
      candidateId: CHAIN_CANDIDATE_ID,
      symbol: CHAIN_SYMBOL,
      record: { ...record, state: "EXECUTION_READY", lastUpdatedAt: now, expiresAt: now + 600_000 },
    });
    const selected = attachCanonicalHandoff(buildScannerCandidateWithoutAi(), handoff);
    const validation = validateCanonicalHandoffRecord(handoff, CHAIN_SYMBOL);
    expect(validation.ok).toBe(false);
    if (!validation.ok) expect(validation.reasonCode).toBe("HANDOFF_IDENTITY_MISMATCH");

    const { executeAnalyzeAndTrade } = await import("@/src/server/execution/execution-orchestrator.service");
    const result = await executeAnalyzeAndTrade({
      userId: user.id,
      executionMode: "paper",
      learningLane: true,
      requestedSymbol: CHAIN_SYMBOL,
      requestedQuoteAmountTry: 1_000,
      preselectedCandidate: selected,
      campaignId: "cmp-case-6",
    });
    expect(result.opened).toBe(false);
    expect(String(result.rejectReason ?? "")).toMatch(/HANDOFF_IDENTITY_MISMATCH|HANDOFF_/);
    expect(runAiConsensusMock).not.toHaveBeenCalled();
  });
});
