import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFix02DisposablePostgres, requireFix02DatabaseUrl, type Fix02DisposablePostgres } from "./helpers/fix02-disposable-postgres";
import { runFix01StrategyEvaluationChain } from "@/src/server/execution/fix01-strategy-evaluation-chain";
import {
  freezeSelectedStrategySignal,
  resolveInvalidationFromSelectedSignal,
} from "@/src/server/execution/fix01-selected-signal";
import { buildPr04ExitMetadataFromSelectedSignal } from "@/src/server/profitability/pr04-exit-bridge";
import { evaluateEarlyAccelerationStrategy, buildEarlyStructuralInvalidation } from "@/src/server/profitability/pr02-early-evaluator";
import { resetEarlySetupStoreForTests } from "@/src/server/profitability/pr02-early-setup";
import { evaluateMomentumContinuationStrategy } from "@/src/server/profitability/pr03-momentum-evaluator";
import { resetMomentumSetupStoreForTests } from "@/src/server/profitability/pr03-momentum-setup";
import { evaluateBreakoutRetestStrategy } from "@/src/server/profitability/pr03-breakout-evaluator";
import { resetBreakoutSetupStoreForTests } from "@/src/server/profitability/pr03-breakout-setup";
import {
  evaluateCanonicalRegime,
  routeStrategiesWithDetails,
  type StrategyInput,
} from "@/src/server/forensics/p4-regime-strategy-shadow";
import type { DeepMarketState } from "@/src/server/market-data/spine/events";
import type { CausalCandle } from "@/src/server/profitability/pr03-types";
import { loadPr05ReplayPackage } from "@/src/server/profitability/pr05-replay-package-loader";
import { loadEngineeringReplayPackageInput } from "@/src/server/profitability/pr05-data-inventory";
import {
  runCausalEntryShiftNegativeControl,
  shuffleClosedPnlPermutation,
} from "@/src/server/profitability/pr05-negative-control";
import {
  runMatchedExitComparison,
  runPr05EngineeringFixtureComparison,
} from "@/src/server/profitability/pr05-offline-comparison";
import { buildQa12FinalAssessment } from "@/src/server/forensics/qa12-final-assessment";
import { renderQa12AssessmentMarkdown } from "@/src/server/forensics/qa12-final-assessment";

const baseNow = Date.parse("2026-09-06T10:00:00.000Z");
const marketEventAt = new Date(baseNow - 20_000).toISOString();
const evaluatedAt = new Date(baseNow).toISOString();

let disposable: Fix02DisposablePostgres | null = null;
let prisma: typeof import("@/src/server/db/prisma").prisma;

const paperCloseMock = vi.fn();
const getTickerMock = vi.fn();

vi.mock("@/services/binance.service", () => ({
  getTicker: getTickerMock,
  placeMarketSell: vi.fn(),
  placeMarketBuy: vi.fn(),
  placeMarketSellEmergency: vi.fn(),
  placeMarketBuyEmergency: vi.fn(),
  getOrderStatus: vi.fn(),
  getOrderStatusByClientOrderId: vi.fn(),
  estimateFees: vi.fn().mockResolvedValue({ estimatedTakerFee: 0.1 }),
  getAccountBalances: vi.fn().mockResolvedValue([{ asset: "BTC", free: 10 }]),
  getKlines: vi.fn().mockResolvedValue([]),
  getOrderBook: vi.fn().mockResolvedValue({ bids: [], asks: [] }),
}));

vi.mock("@/src/server/exchange-simulator/paper-exchange-adapter.service", () => ({
  executePaperCloseOrderViaSimulator: paperCloseMock,
}));

vi.mock("@/src/server/execution/execution-event-bus", () => ({ publishExecutionEvent: vi.fn() }));
vi.mock("@/src/server/scanner/scanner-worker.service", () => ({ resumeScannerWorker: vi.fn(), pauseScannerWorkerUntilResume: vi.fn() }));
vi.mock("@/src/server/observability/trade-event-log", () => ({ logTradeEvent: vi.fn() }));
vi.mock("@/src/server/notifications/notification.service", () => ({ notifySystemEvent: vi.fn() }));
vi.mock("@/src/server/forensics/forensic-bridge.service", () => ({ bridgeClosedTradePnl: vi.fn() }));
vi.mock("@/src/server/execution/order-manager.service", () => ({
  ensureSingleActiveExitOrder: vi.fn().mockResolvedValue({ allowed: true, pending: null }),
}));
vi.mock("@/src/server/repositories/risk.repository", () => ({ getConsecutiveLossCount: vi.fn().mockResolvedValue(0) }));
vi.mock("@/src/server/risk", () => ({ getEffectiveRiskConfig: vi.fn().mockResolvedValue({ consecutiveLossBreaker: 3 }) }));

function baseStrategyInput(overrides?: Partial<StrategyInput>): StrategyInput {
  return {
    candidateId: "cand-pfqa",
    sourceType: "SYNTHETIC_FIXTURE",
    marketEventAt,
    evaluatedAt,
    velocity: 0.8,
    acceleration: 0.7,
    volumeAcceleration: 0.75,
    relativeStrength: 0.7,
    spreadBps: 8,
    liquidityScore: 72,
    exhaustion: 0.2,
    momentum: 0.75,
    retracement: 0.3,
    breakoutHeld: true,
    rangeScore: 0.4,
    distanceFromMean: 0.3,
    flowRecovery: 0.7,
    entrySpread: 0.05,
    entrySlippage: 0.03,
    entryFee: 0.1,
    exitSpread: 0.05,
    exitSlippage: 0.03,
    exitFee: 0.1,
    strategyProfitBuffer: 0.2,
    expectedMovePercent: 2.5,
    ...overrides,
  };
}

function bullRegime() {
  return evaluateCanonicalRegime({
    marketEventAt,
    detectedAt: evaluatedAt,
    trend: 0.8,
    volatility: 0.3,
    momentum: 0.8,
    transitionProbability: 0.1,
    chaosProbability: 0.05,
    pumpScore: 0.2,
  });
}

function candle(index: number, o: number, h: number, l: number, c: number): CausalCandle {
  const openTime = baseNow - (10 - index) * 30_000;
  const closeTime = openTime + 30_000;
  return { openTime, closeTime, open: o, high: h, low: l, close: c, volume: 1000, closed: true, availableAt: closeTime };
}

function breakoutCandles(): CausalCandle[] {
  return [
    candle(0, 98, 99, 97.5, 98.5),
    candle(1, 98.5, 99.2, 98.2, 99),
    candle(2, 99, 99.6, 98.8, 99.4),
    candle(3, 99.2, 100, 99, 99.8),
    candle(4, 99.5, 99.7, 99.1, 99.3),
    candle(5, 99.2, 99.5, 99, 99.2),
    candle(6, 99.5, 101.5, 99.4, 101.3),
    candle(7, 101.2, 101.4, 99.9, 100.8),
    candle(8, 100.7, 101.8, 100.5, 101.5),
    candle(9, 101.4, 102, 101.2, 101.9),
  ];
}

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

function buyFlowTrades(count = 20) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const t = baseNow - (count - i) * 1_000;
    rows.push({
      type: "trade" as const,
      symbol: "BTCTRY",
      price: 101 + i * 0.01,
      quantity: 1,
      quoteNotional: 150,
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

function deepState(input: { trades?: DeepMarketState["recentTrades"]; candles?: CausalCandle[]; book?: DeepMarketState["bookTicker"] | null }) {
  return {
    symbol: "BTCTRY",
    venue: "BINANCE",
    recentTrades: input.trades ?? [],
    klines1m: (input.candles ?? []).map((c) => ({
      openTime: c.openTime,
      closeTime: c.closeTime,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    })),
    bookTicker: input.book ?? null,
    lastPrice: 101.5,
    lastUpdateAt: baseNow,
  } satisfies DeepMarketState;
}

beforeEach(() => {
  resetEarlySetupStoreForTests();
  resetMomentumSetupStoreForTests();
  resetBreakoutSetupStoreForTests();
  vi.clearAllMocks();
  getTickerMock.mockResolvedValue({ symbol: "BTCTRY", price: 112, change24h: 0, volume24h: 0 });
  paperCloseMock.mockImplementation(async (args: { quantity: number }) => ({
    orderId: `paper-${Date.now()}`,
    clientOrderId: `client-${Date.now()}`,
    symbol: "BTCTRY",
    side: "SELL",
    type: "MARKET",
    status: "FILLED",
    executedQty: args.quantity,
    price: 112,
    dryRun: true,
    fee: 0.05,
    metadata: { fee: 0.05, feeAsset: "QUOTE", simulationId: `sim-${Date.now()}` },
  }));
});

describe("POST-FIX final QA — FIX01 production chain", () => {
  it("chain 1 EARLY context → selected signal → entry metadata with invalidation", () => {
    const early = evaluateEarlyAccelerationStrategy(baseStrategyInput(), bullRegime(), {
      trades: earlyTrades(),
      book: book(101.2),
      baselinePrice: 100,
      firstDetectionPrice: 100.2,
      lifecycleId: "lc-pfqa-early",
      nowMs: baseNow,
    });
    expect(early.trigger.triggered).toBe(true);
    expect(early.invalidation?.reasonCode).toBe("EARLY_BASELINE_STRUCTURE_BREACH");
    const frozen = freezeSelectedStrategySignal("EARLY_ACCELERATION", early);
    const meta = buildPr04ExitMetadataFromSelectedSignal({ positionId: "pos-early", selectedSignal: frozen });
    expect(meta.strategyId).toBe("EARLY_ACCELERATION");
    expect(meta.structuralInvalidation?.reasonCode).toBe("EARLY_BASELINE_STRUCTURE_BREACH");
    expect(resolveInvalidationFromSelectedSignal(frozen)?.invalidationThreshold).toBe(early.invalidation?.invalidationThreshold);
  });

  it("chain 2 empty context does not silently use fixture fallback", () => {
    const result = runFix01StrategyEvaluationChain({
      symbol: "BTCTRY",
      venue: "BINANCE",
      candidateId: "cand-empty",
      lifecycleId: "lc-empty",
      featureSnapshotId: "snap-empty",
      decisionAtMs: baseNow,
      strategyInput: baseStrategyInput(),
      regime: bullRegime(),
      deepState: deepState({ trades: [], candles: [], book: null }),
      baselinePrice: 100,
      firstDetectionPrice: 100.2,
    });
    expect(result.router.strategyDetails.EARLY_ACCELERATION?.trigger.reasonCodes).toContain("PRODUCER_CONTEXT_MISSING");
    expect(result.selectedSignal).toBeNull();
    expect(result.entryMetadata).toBeNull();
  });

  it("chain 3 BREAKOUT selected signal preserves strategyId/signalId/setupId", () => {
    const router = routeStrategiesWithDetails(
      {
        ...baseStrategyInput(),
        strategyContext: { candles: breakoutCandles(), trades: buyFlowTrades(20), lifecycleId: "lc-pfqa-bo", nowMs: baseNow },
      },
      bullRegime(),
    );
    const breakout = router.strategyDetails.BREAKOUT_RETEST;
    expect(breakout?.trigger.triggered).toBe(true);
    const frozen = freezeSelectedStrategySignal("BREAKOUT_RETEST", breakout!);
    const meta = buildPr04ExitMetadataFromSelectedSignal({ positionId: "pos-bo", selectedSignal: frozen });
    expect(meta.strategyId).toBe("BREAKOUT_RETEST");
    expect(meta.entrySignalId).toBe(breakout?.trigger.signalId);
    expect(meta.setupId).toBe(breakout?.setupId);
    expect(meta.structuralInvalidation?.reasonCode).toBe("LEVEL_HOLD_BREACH");
  });

  it("chain 4 missing producer context yields no selected signal", () => {
    const result = runFix01StrategyEvaluationChain({
      symbol: "BTCTRY",
      venue: "BINANCE",
      candidateId: "cand-no-entry",
      lifecycleId: "lc-no-entry",
      featureSnapshotId: "snap-no-entry",
      decisionAtMs: baseNow,
      strategyInput: baseStrategyInput(),
      regime: bullRegime(),
      deepState: deepState({ trades: [], candles: [], book: null }),
      baselinePrice: 100,
      firstDetectionPrice: 100.2,
    });
    expect(result.router.strategyDetails.EARLY_ACCELERATION?.trigger.triggered).toBe(false);
    expect(result.router.strategyDetails.MOMENTUM_CONTINUATION?.trigger.triggered).toBe(false);
    expect(result.router.strategyDetails.BREAKOUT_RETEST?.trigger.triggered).toBe(false);
    expect(result.selectedSignal).toBeNull();
    expect(result.entryMetadata).toBeNull();
  });
});

describe("POST-FIX final QA — FIX02 PostgreSQL chain", () => {
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
    await prisma.positionExitPersistedState.deleteMany();
    await prisma.position.deleteMany();
    await prisma.tradeOrder.deleteMany();
    await prisma.profitLossRecord.deleteMany();
    await prisma.appSetting.deleteMany();
    await prisma.exchangeConnection.deleteMany();
    await prisma.user.deleteMany();
    process.env.EXECUTION_PR04_EXIT_EVAL_ENABLED = "true";
    process.env.EXECUTION_PR04_EXIT_ROUTING_ENABLED = "true";
    const { resetExitPolicyStoreForTests } = await import("@/src/server/profitability/pr04-exit-evaluator");
    resetExitPolicyStoreForTests();
  });

  it("chain 5 EARLY invalidation snapshot → DB persist → restart restore → partial settlement", async () => {
    requireFix02DatabaseUrl();
    const suffix = crypto.randomUUID().slice(0, 8);
    const user = await prisma.user.create({
      data: { email: `pfqa-${suffix}@example.com`, username: `pfqa_${suffix}`, passwordHash: "hash" },
    });
    const conn = await prisma.exchangeConnection.create({
      data: { userId: user.id, exchange: "BINANCE", name: "paper", apiKeyMasked: "x", apiSecretEncrypted: "y", isSandbox: true },
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
        metadata: { mode: "paper", executionId: `exec-${suffix}`, strategyId: "EARLY_ACCELERATION" },
      },
    });
    const invalidation = buildEarlyStructuralInvalidation({
      baselinePrice: 100,
      firstDetectionPrice: 100.2,
      latestPrice: 101.5,
      asOfMs: baseNow,
    });
    const { bootstrapExitPersistenceAtEntry, loadPersistedExitBundle, restoreExitPolicyStateFromDb } = await import(
      "@/src/server/execution/fix02-exit-persistence.service"
    );
    const { buildExitPolicySnapshotAtEntry, resetExitPolicyStoreForTests } = await import(
      "@/src/server/profitability/pr04-exit-evaluator"
    );
    const { processFix02Pr04ExitTick } = await import("@/src/server/execution/fix02-exit-routing.service");
    const snapshot = buildExitPolicySnapshotAtEntry({
      positionId: position.id,
      strategyId: "EARLY_ACCELERATION",
      entryPolicyVersion: "pr02-v1",
      entrySignalId: "sig-early",
      setupId: "setup-early",
      exitPolicyId: "STRUCTURAL_PARTIAL_TRAIL",
      experimentalMode: true,
      takeProfitPercent: 50,
      invalidation,
      boundAtMs: baseNow,
    });
    await bootstrapExitPersistenceAtEntry({
      userId: user.id,
      positionId: position.id,
      selectedSignal: null,
      snapshot,
      side: "LONG",
      entryFills: [{ price: 100, quantity: 1, fee: 0.1, atMs: baseNow }],
      entryFee: 0.1,
      ownerExecutionId: `exec-${suffix}`,
    });
    const bundle = await loadPersistedExitBundle(position.id);
    expect(bundle?.snapshot.structuralInvalidation?.reasonCode).toBe("EARLY_BASELINE_STRUCTURE_BREACH");
    resetExitPolicyStoreForTests();
    const restored = await restoreExitPolicyStateFromDb(position.id);
    expect(restored?.timeAnchorMs).toBe(bundle?.state.timeAnchorMs);
    const routed = await processFix02Pr04ExitTick({
      executionId: `exec-${suffix}`,
      positionId: position.id,
      userId: user.id,
      side: "LONG",
      mode: "paper",
      observation: {
        eventId: `evt-${suffix}`,
        eventAtMs: baseNow + 2000,
        availableAtMs: baseNow + 2000,
        markPrice: 103,
        bid: 102.9,
        ask: 103.1,
        high: 103.2,
        low: 102.5,
        closed: true,
        stale: false,
        dataGap: false,
      },
    });
    const after = await prisma.position.findUnique({ where: { id: position.id } });
    expect(routed.partial || routed.handled).toBe(true);
    expect(after?.status).toBe("OPEN");
    expect((after?.quantity ?? 0) < 1).toBe(true);
  });

  it("chain 6 duplicate settlement fill is idempotent", async () => {
    requireFix02DatabaseUrl();
    const { applyPartialPositionClose } = await import("@/src/server/repositories/execution.repository");
    const suffix = crypto.randomUUID().slice(0, 8);
    const user = await prisma.user.create({
      data: { email: `dup-${suffix}@example.com`, username: `dup_${suffix}`, passwordHash: "hash" },
    });
    const conn = await prisma.exchangeConnection.create({
      data: { userId: user.id, exchange: "BINANCE", name: "paper", apiKeyMasked: "x", apiSecretEncrypted: "y", isSandbox: true },
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
        metadata: {},
      },
    });
    await applyPartialPositionClose({
      positionId: position.id,
      fillPrice: 110,
      filledQuantity: 0.4,
      realizedPnlDelta: 4,
      feeDelta: 0.1,
      settlementFillId: "pfqa-fill-dup",
    });
    const first = await prisma.position.findUnique({ where: { id: position.id } });
    await applyPartialPositionClose({
      positionId: position.id,
      fillPrice: 110,
      filledQuantity: 0.4,
      realizedPnlDelta: 4,
      feeDelta: 0.1,
      settlementFillId: "pfqa-fill-dup",
    });
    const second = await prisma.position.findUnique({ where: { id: position.id } });
    expect(second?.quantity).toBe(first?.quantity);
    expect(second?.realizedPnl).toBe(first?.realizedPnl);
  });

  it("chain 7 wrong owner cannot release durable claim", async () => {
    requireFix02DatabaseUrl();
    const user = await prisma.user.create({
      data: { email: `own-${crypto.randomUUID()}@example.com`, username: `own_${crypto.randomUUID().slice(0, 8)}`, passwordHash: "hash" },
    });
    const { claimDurableCanonicalExecutionAttempt, releaseDurableCanonicalExecutionAttempt } = await import(
      "@/src/server/hot-path/execution-attempt-lock.service"
    );
    const claim = await claimDurableCanonicalExecutionAttempt({
      userId: user.id,
      candidateId: "BTC:pfqa",
      executionId: "exec-owner-pfqa",
      executionMode: "paper",
      venue: "BINANCE_TR",
    });
    expect(claim.ok).toBe(true);
    const release = await releaseDurableCanonicalExecutionAttempt({
      userId: user.id,
      candidateId: "BTC:pfqa",
      executionId: "exec-wrong-owner",
      executionMode: "paper",
      venue: "BINANCE_TR",
    });
    expect(release.ok).toBe(false);
  });
});

describe("POST-FIX final QA — FIX03 offline and assessment", () => {
  it("chain 8 replay loader → engineering comparison → assessment", () => {
    const loaded = loadPr05ReplayPackage({ packageId: "engineering-synthetic-v1" });
    expect(loaded.status).toBe("LOADED");
    expect(loaded.fitnessForMarketExperiment).toBe("NOT_FIT");
    const pkg = loadEngineeringReplayPackageInput();
    expect(pkg).not.toBeNull();
    const report = runPr05EngineeringFixtureComparison({
      datasetId: pkg!.datasetId,
      manifests: pkg!.manifests,
      ticksByManifestId: pkg!.ticksByManifestId,
      recordedMarketData: false,
      policyIds: ["STRUCTURAL_STOP_TARGET"],
    });
    expect(report.matchedExitOutcomes[0]?.symbol).toBe("BTCTRY");
    expect(report.portfolioOutcomes.length).toBeGreaterThan(0);
    const nc = runCausalEntryShiftNegativeControl({
      datasetId: pkg!.datasetId,
      manifests: pkg!.manifests,
      ticksByManifestId: pkg!.ticksByManifestId,
      policyIds: ["STRUCTURAL_STOP_TARGET"],
      seed: 42,
      iterations: 3,
    });
    expect(nc.method).toBe("CAUSAL_ENTRY_TIME_SHIFT");
    if (nc.procedureApplied) {
      expect(nc.implementationVerdict).toBe("PASS");
    } else {
      expect(nc.implementationVerdict).toBe("INSUFFICIENT_DATA");
    }
    const perm = shuffleClosedPnlPermutation({
      outcomes: runMatchedExitComparison({
        datasetId: pkg!.datasetId,
        manifests: pkg!.manifests,
        ticksByManifestId: pkg!.ticksByManifestId,
        policyIds: ["STRUCTURAL_STOP_TARGET"],
        recordedMarketData: false,
      }).outcomes,
      seed: 1,
      iterations: 2,
      shiftBlocks: 1,
    });
    expect(perm.method).toBe("PNL_PERMUTATION_NON_CAUSAL");
    expect(perm.procedureApplied).toBe(false);
    const assessment = buildQa12FinalAssessment({
      headCommit: "pfqa",
      worktreeFingerprint: "dirty",
      openCritical: 0,
      openHigh: 1,
      requiredChecksNotRun: ["MARKET_REPLAY_EXPERIMENT"],
      pr05Report: report,
      fix01Passed: true,
      fix02Passed: true,
    });
    expect(assessment.verdicts.FINAL_ENGINEERING_VERDICT).toBe("PARTIAL");
    expect(assessment.verdicts.PROFITABILITY_EVIDENCE).toBe("NOT_ESTABLISHED");
    const md = renderQa12AssessmentMarkdown(assessment);
    expect(md).toContain("OVERALL_QA_STATUS");
    expect(md).toContain(String(assessment.verdicts.OVERALL_QA_STATUS));
  });

  it("chain 9 0 CRITICAL + 4 HIGH cannot yield unconditional PASS", () => {
    const assessment = buildQa12FinalAssessment({
      headCommit: "pfqa",
      worktreeFingerprint: "dirty",
      openCritical: 0,
      openHigh: 4,
      requiredChecksNotRun: [],
    });
    expect(assessment.verdicts.FINAL_ENGINEERING_VERDICT).not.toBe("PASS");
  });
});
