/**
 * Corrections Final QA — adversarial verification for Düzeltme 1/2 + 2/2.
 * Scope: settlement integration (DB-seeded position), not full live entry orchestrator.
 */
import crypto from "node:crypto";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFix02DisposablePostgres, type Fix02DisposablePostgres } from "./helpers/fix02-disposable-postgres";
import {
  filterTradesAtDecision,
  klinesToCausalCandles,
} from "@/src/server/execution/fix01-strategy-context-builder";
import type { MarketTradeEvent } from "@/src/server/market-data/spine/events";
import { MarketStateStore } from "@/src/server/market-data/spine/market-state-store";
import { buildEarlyStructuralInvalidation } from "@/src/server/profitability/pr02-early-evaluator";
import { buildCounterfactualEntryShift } from "@/src/server/profitability/pr05-negative-control";
import { buildMatchedEntryManifest } from "@/src/server/profitability/pr04-matched-entry-manifest";
import { buildRiskReference } from "@/src/server/profitability/pr04-structural-stop";
import { runPortfolioReplay } from "@/src/server/profitability/pr05-portfolio-replay";
import { stepPr04ExitReplayTick, createPr04ExitReplaySession } from "@/src/server/profitability/pr04-replay";
import type { ExitTickObservation } from "@/src/server/profitability/pr04-types";

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
  estimateFees: vi.fn().mockResolvedValue({ estimatedTakerFee: 0.12 }),
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
  ensureSingleActiveExitOrder: vi.fn().mockImplementation(async () => ({ allowed: true, pending: null })),
}));
vi.mock("@/src/server/repositories/risk.repository", () => ({ getConsecutiveLossCount: vi.fn().mockResolvedValue(0) }));
vi.mock("@/src/server/risk", () => ({ getEffectiveRiskConfig: vi.fn().mockResolvedValue({ consecutiveLossBreaker: 3 }) }));

const baseNow = Date.parse("2026-09-06T10:00:00.000Z");
const HOUR = 3_600_000;
const MIN = 60_000;

function obs(mark: number, offsetMs: number): ExitTickObservation {
  const t = baseNow + offsetMs;
  return {
    eventId: `evt:${t}:${mark}`,
    eventAtMs: t,
    availableAtMs: t,
    markPrice: mark,
    bid: mark - 0.1,
    ask: mark + 0.1,
    high: mark + 0.2,
    low: mark - 0.2,
    closed: true,
    stale: false,
    dataGap: false,
  };
}

async function seedOpenPosition(quantity = 1) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: { email: `cfqa-${suffix}@example.com`, username: `cfqa_${suffix}`, passwordHash: "hash" },
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
      quantity,
      openedAt: new Date(baseNow),
      metadata: { mode: "paper", executionId: `exec-${suffix}` },
    },
  });
  return { user, position, suffix };
}

async function bootstrapPartialTrailExit(input: {
  userId: string;
  positionId: string;
  suffix: string;
  entryQuantity: number;
  invalidation?: ReturnType<typeof buildEarlyStructuralInvalidation>;
}) {
  const { bootstrapExitPersistenceAtEntry } = await import("@/src/server/execution/fix02-exit-persistence.service");
  const { buildExitPolicySnapshotAtEntry } = await import("@/src/server/profitability/pr04-exit-evaluator");
  const snapshot = buildExitPolicySnapshotAtEntry({
    positionId: input.positionId,
    strategyId: "EARLY_ACCELERATION",
    entryPolicyVersion: "pr02-v1",
    entrySignalId: "sig-cfqa",
    setupId: "setup-cfqa",
    exitPolicyId: "STRUCTURAL_PARTIAL_TRAIL",
    experimentalMode: true,
    takeProfitPercent: 50,
    invalidation: input.invalidation ?? null,
    boundAtMs: baseNow,
  });
  await bootstrapExitPersistenceAtEntry({
    userId: input.userId,
    positionId: input.positionId,
    selectedSignal: null,
    snapshot,
    side: "LONG",
    entryFills: [{ price: 100, quantity: input.entryQuantity, fee: 0.1, atMs: baseNow }],
    entryFee: 0.1,
    ownerExecutionId: `exec-${input.suffix}`,
  });
}

describe("Corrections Final QA — PostgreSQL adversarial", () => {
  beforeAll(async () => {
    disposable = await createFix02DisposablePostgres();
    vi.resetModules();
    prisma = (await import("@/src/server/db/prisma")).prisma;
  }, 120_000);

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    if (disposable) await disposable.cleanup();
  }, 60_000);

  beforeEach(async () => {
    const { resetExitPolicyStoreForTests } = await import("@/src/server/profitability/pr04-exit-evaluator");
    const { resetSettlementFillTransactionHooksForTests } = await import(
      "@/src/server/execution/canonical-settlement-fill.service"
    );
    resetExitPolicyStoreForTests();
    resetSettlementFillTransactionHooksForTests();
    vi.clearAllMocks();
    getTickerMock.mockResolvedValue({ symbol: "BTCTRY", price: 90, change24h: 0, volume24h: 0 });
    paperCloseMock.mockImplementation(async (args: { quantity: number }) => ({
      orderId: `paper-${Date.now()}`,
      clientOrderId: `client-${Date.now()}`,
      symbol: "BTCTRY",
      side: "SELL",
      type: "MARKET",
      status: "FILLED",
      executedQty: args.quantity,
      price: 90,
      dryRun: true,
      fee: 0.08,
      metadata: { fee: 0.08 },
    }));
    await prisma.positionSettlementFill.deleteMany();
    await prisma.positionExitPersistedState.deleteMany();
    await prisma.profitLossRecord.deleteMany();
    await prisma.tradeExecution.deleteMany();
    await prisma.tradeOrder.deleteMany();
    await prisma.position.deleteMany();
    await prisma.exchangeConnection.deleteMany();
    await prisma.user.deleteMany();
    process.env.EXECUTION_PR04_EXIT_EVAL_ENABLED = "true";
    process.env.EXECUTION_PR04_EXIT_ROUTING_ENABLED = "true";
  });

  it("ADV-STOP-01 partial 0.5 terminal then stop at 90 closes with correct DB state", async () => {
    const { getExitPolicyState } = await import("@/src/server/profitability/pr04-exit-evaluator");
    const { processFix02Pr04ExitTick } = await import("@/src/server/execution/fix02-exit-routing.service");
    const entryQuantity = 2;
    const partialSellQty = 0.5;
    const { user, position, suffix } = await seedOpenPosition(entryQuantity);
    const invalidation = buildEarlyStructuralInvalidation({
      baselinePrice: 100,
      firstDetectionPrice: 100.2,
      latestPrice: 101.5,
      asOfMs: baseNow,
    });
    await bootstrapPartialTrailExit({
      userId: user.id,
      positionId: position.id,
      suffix,
      entryQuantity,
      invalidation,
    });
    const stateBefore = getExitPolicyState(position.id)!;
    stateBefore.activeStopPrice = 99;

    const partial = await processFix02Pr04ExitTick({
      executionId: `exec-${suffix}`,
      positionId: position.id,
      userId: user.id,
      side: "LONG",
      mode: "paper",
      observation: obs(103, 2_000),
    });
    const afterPartial = await prisma.position.findUnique({ where: { id: position.id } });
    const partialState = getExitPolicyState(position.id)!;
    const partialFills = await prisma.positionSettlementFill.findMany({ where: { positionId: position.id } });
    const partialOrders = await prisma.tradeOrder.findMany({ where: { positionId: position.id } });

    expect(partial.reasonCode).not.toBe("ORDER_IN_FLIGHT");
    expect(partial.partial).toBe(true);
    expect(afterPartial?.status).toBe("OPEN");
    expect(afterPartial?.quantity).toBeCloseTo(entryQuantity - partialSellQty, 4);
    expect(partialState.orderState).toBe("NONE");
    expect(partialState.reservedSellQuantity).toBe(0);
    expect(partialFills).toHaveLength(1);
    expect(partialFills[0]?.executedQty).toBeCloseTo(partialSellQty, 4);
    expect(partialOrders).toHaveLength(1);
    expect(partialOrders[0]?.quantity).toBeCloseTo(partialSellQty, 4);
    expect(partialOrders[0]?.fee).toBeGreaterThan(0);

    const stop = await processFix02Pr04ExitTick({
      executionId: `exec-${suffix}`,
      positionId: position.id,
      userId: user.id,
      side: "LONG",
      mode: "paper",
      observation: obs(90, 3_000),
    });
    const closed = await prisma.position.findUnique({ where: { id: position.id } });
    const pnlRows = await prisma.profitLossRecord.findMany({ where: { positionId: position.id } });
    const allFills = await prisma.positionSettlementFill.findMany({ where: { positionId: position.id } });
    const exitState = getExitPolicyState(position.id)!;

    expect(stop.reasonCode).not.toBe("ORDER_IN_FLIGHT");
    expect(stop.decisionKind).toBe("STRUCTURAL_STOP");
    expect(stop.closed).toBe(true);
    expect(closed?.status).toBe("CLOSED");
    expect(closed?.quantity).toBe(0);
    expect(pnlRows.length).toBeGreaterThanOrEqual(2);
    expect(allFills.length).toBeGreaterThanOrEqual(1);
    expect(exitState.exitFills.length).toBeGreaterThanOrEqual(2);
    expect(exitState.exitFills.at(-1)?.price).toBe(90);
    expect(exitState.exitFills.at(-1)?.fee).toBe(0.08);
  }, 45_000);

  it("ADV-FILL-01 full close uses paper fill 88.5/0.15 not decision mark", async () => {
    const { getExitPolicyState, buildExitPolicySnapshotAtEntry } = await import(
      "@/src/server/profitability/pr04-exit-evaluator"
    );
    const { bootstrapExitPersistenceAtEntry } = await import("@/src/server/execution/fix02-exit-persistence.service");
    const { processFix02Pr04ExitTick } = await import("@/src/server/execution/fix02-exit-routing.service");
    const { user, position, suffix } = await seedOpenPosition(1);
    paperCloseMock.mockImplementationOnce(async () => ({
      orderId: "paper-adv-fill",
      clientOrderId: "client-adv-fill",
      symbol: "BTCTRY",
      side: "SELL",
      type: "MARKET",
      status: "FILLED",
      executedQty: 1,
      price: 88.5,
      dryRun: true,
      fee: 0.15,
      metadata: { fee: 0.15 },
    }));
    const snapshot = buildExitPolicySnapshotAtEntry({
      positionId: position.id,
      strategyId: "BREAKOUT_RETEST",
      entryPolicyVersion: "pr03-v1",
      entrySignalId: "sig-fill",
      setupId: "setup-fill",
      exitPolicyId: "STRUCTURAL_STOP_TARGET",
      experimentalMode: true,
      takeProfitPercent: 1,
      invalidation: null,
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
    const state = getExitPolicyState(position.id)!;
    state.activeStopPrice = 99;
    await processFix02Pr04ExitTick({
      executionId: `exec-${suffix}`,
      positionId: position.id,
      userId: user.id,
      side: "LONG",
      mode: "paper",
      observation: obs(95, 1_000),
    });
    const exitState = getExitPolicyState(position.id)!;
    const lastFill = exitState.exitFills.at(-1)!;
    const orders = await prisma.tradeOrder.findMany({ where: { positionId: position.id } });
    expect(lastFill.price).toBe(88.5);
    expect(lastFill.price).not.toBe(95);
    expect(lastFill.fee).toBe(0.15);
    expect(orders[0]?.avgExecutionPrice).toBe(88.5);
    expect(orders[0]?.fee).toBe(0.15);
  }, 30_000);

  it("ADV-ATOMIC-01 transaction rollback leaves zero economic writes", async () => {
    const { applyCanonicalPartialSettlementFill, setSettlementFillTransactionHook } = await import(
      "@/src/server/execution/canonical-settlement-fill.service"
    );
    const { user, position } = await seedOpenPosition(1);
    setSettlementFillTransactionHook("afterPositionUpdate", () => {
      throw new Error("INJECTED_ROLLBACK");
    });
    const result = await applyCanonicalPartialSettlementFill({
      positionId: position.id,
      settlementFillId: "adv-atomic-rollback",
      userId: user.id,
      exchangeConnectionId: position.exchangeConnectionId,
      tradingPairId: position.tradingPairId,
      quoteAsset: "TRY",
      positionSide: "LONG",
      closeSide: "SELL",
      fillPrice: 110,
      filledQuantity: 0.4,
      closeFee: 0.1,
      feeAsset: "QUOTE",
      openFeePortion: 0.04,
      clientOrderId: "client-adv",
      exchangeOrderId: "ex-adv",
      closeReason: "TAKE_PROFIT",
      mode: "paper",
    });
    expect(result.status).toBe("FAILED");
    const afterRollback = await prisma.position.findUnique({ where: { id: position.id } });
    expect(afterRollback?.quantity).toBe(1);
    expect(await prisma.tradeOrder.count({ where: { positionId: position.id } })).toBe(0);
    expect(await prisma.profitLossRecord.count({ where: { positionId: position.id } })).toBe(0);
    expect(await prisma.positionSettlementFill.count({ where: { positionId: position.id } })).toBe(0);
  });

  it("ADV-CONCURRENT-01 duplicate fill concurrent clients single economic effect", async () => {
    const { applyCanonicalPartialSettlementFill } = await import(
      "@/src/server/execution/canonical-settlement-fill.service"
    );
    const { user, position } = await seedOpenPosition(1);
    const payload = {
      positionId: position.id,
      settlementFillId: "adv-dup-concurrent",
      userId: user.id,
      exchangeConnectionId: position.exchangeConnectionId,
      tradingPairId: position.tradingPairId,
      quoteAsset: "TRY",
      positionSide: "LONG" as const,
      closeSide: "SELL" as const,
      fillPrice: 110,
      filledQuantity: 0.4,
      closeFee: 0.1,
      feeAsset: "QUOTE" as const,
      openFeePortion: 0.04,
      clientOrderId: "client-dup-adv",
      exchangeOrderId: "ex-dup-adv",
      closeReason: "TAKE_PROFIT",
      mode: "paper",
    };
    const [a, b] = await Promise.all([
      applyCanonicalPartialSettlementFill(payload),
      applyCanonicalPartialSettlementFill(payload),
    ]);
    expect([a.status, b.status].sort()).toEqual(["ALREADY_APPLIED", "APPLIED"]);
    expect(await prisma.profitLossRecord.count({ where: { positionId: position.id } })).toBe(1);
    expect((await prisma.position.findUnique({ where: { id: position.id } }))?.quantity).toBeCloseTo(0.6, 4);
  });
});

describe("Corrections Final QA — replay adversarial (no DB)", () => {
  beforeEach(async () => {
    const { resetExitPolicyStoreForTests } = await import("@/src/server/profitability/pr04-exit-evaluator");
    resetExitPolicyStoreForTests();
  });

  it("ADV-AVAIL-01 late-received trade excluded at decision", () => {
    const trade: MarketTradeEvent = {
      type: "trade",
      symbol: "BTCTRY",
      price: 100,
      quantity: 1,
      quoteNotional: 100,
      eventTime: baseNow,
      tradeTime: baseNow,
      receiveTime: baseNow + 2_000,
      buyerMaker: false,
      takerSide: "BUY",
      source: "memory",
    };
    expect(filterTradesAtDecision([trade], baseNow + 1_000)).toHaveLength(0);
  });

  it("ADV-AVAIL-02 REST candle not available before receive", () => {
    const store = new MarketStateStore();
    const closeTime = baseNow - MIN;
    const receivedAt = baseNow;
    store.applyCandle({
      type: "candle",
      symbol: "BTCTRY",
      interval: "1m",
      openTime: closeTime - MIN,
      closeTime,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 10,
      quoteVolume: 1000,
      closed: true,
      eventTime: closeTime,
      receiveTime: receivedAt,
      source: "binance-rest-bootstrap",
    });
    const deep = store.getDeepState("BTCTRY", baseNow - 1_000)!;
    expect(klinesToCausalCandles(deep.klines1m, baseNow - 1_000)).toHaveLength(0);
    expect(klinesToCausalCandles(deep.klines1m, receivedAt)).toHaveLength(1);
  });

  it("ADV-NC-01 counterfactual preserves market tick timestamps", () => {
    const m = buildMatchedEntryManifest({
      entrySignalId: "nc-adv",
      strategyId: "MOMENTUM_CONTINUATION",
      entryPolicyVersion: "v1",
      entryAtMs: baseNow,
      fills: [{ price: 100, quantity: 1, fee: 0.1, atMs: baseNow }],
      riskReference: buildRiskReference({
        entryPrice: 100,
        initialStopPrice: 99.2,
        initialQuantity: 1,
        entryFee: 0.1,
        includesFeesInBreakEven: true,
        computedAtMs: baseNow,
      }),
      invalidation: null,
      featureEvidenceIds: [],
      dataSource: "SYNTHETIC_FIXTURE",
      replayWindow: { fromMs: baseNow, toMs: baseNow + 120_000 },
    });
    const ticks = [
      { tickIndex: 0, observation: obs(100, 0) },
      { tickIndex: 1, observation: obs(110, 10_000) },
      { tickIndex: 2, observation: obs(98, 20_000), applyFill: { price: 98, quantity: 1, fee: 0.05, feeAsset: "QUOTE" as const } },
    ];
    const hashBefore = createHash("sha256").update(JSON.stringify(ticks.map((t) => t.observation))).digest("hex");
    const built = buildCounterfactualEntryShift({ manifest: m, marketTicks: ticks, shiftMs: 5_000 });
    expect(built.status).toBe("OK");
    if (built.status === "OK") {
      expect(built.manifest.fills[0]!.price).toBe(100);
      expect(built.exitTicks[0]!.observation.eventAtMs).toBe(baseNow + 10_000);
      const hashAfter = createHash("sha256").update(JSON.stringify(ticks.map((t) => t.observation))).digest("hex");
      expect(hashAfter).toBe(hashBefore);
    }
  });

  it("ADV-PORT-01 B rejected at 10:01 cannot use A 11:00 close proceeds", () => {
    const invalidation = {
      referenceLevel: 100,
      invalidationThreshold: 99.2,
      reasonCode: "LEVEL_HOLD_BREACH",
      computedAtMs: baseNow,
      availableAtMs: baseNow,
      validUntilMs: baseNow + HOUR,
      sourceObservations: ["CONFIRMED_PIVOT_HIGH"],
    };
    const mA = buildMatchedEntryManifest({
      entrySignalId: "life-a",
      strategyId: "MOMENTUM_CONTINUATION",
      entryPolicyVersion: "v1",
      entryAtMs: baseNow,
      fills: [{ price: 100, quantity: 1, fee: 0.1, atMs: baseNow }],
      riskReference: buildRiskReference({
        entryPrice: 100,
        initialStopPrice: 99.2,
        initialQuantity: 1,
        entryFee: 0.1,
        includesFeesInBreakEven: true,
        computedAtMs: baseNow,
      }),
      invalidation,
      featureEvidenceIds: [],
      dataSource: "SYNTHETIC_FIXTURE",
      replayWindow: { fromMs: baseNow, toMs: baseNow + 2 * HOUR },
    });
    const mB = buildMatchedEntryManifest({
      entrySignalId: "life-b",
      strategyId: "MOMENTUM_CONTINUATION",
      entryPolicyVersion: "v1",
      entryAtMs: baseNow + MIN,
      fills: [{ price: 100, quantity: 1, fee: 0.1, atMs: baseNow + MIN }],
      riskReference: buildRiskReference({
        entryPrice: 100,
        initialStopPrice: 99.2,
        initialQuantity: 1,
        entryFee: 0.1,
        includesFeesInBreakEven: true,
        computedAtMs: baseNow + MIN,
      }),
      invalidation,
      featureEvidenceIds: [],
      dataSource: "SYNTHETIC_FIXTURE",
      replayWindow: { fromMs: baseNow + MIN, toMs: baseNow + 2 * HOUR },
    });
    const ticksA = [
      { tickIndex: 0, observation: obs(98, HOUR), applyFill: { price: 98, quantity: 1, fee: 0.05, feeAsset: "QUOTE" as const } },
    ];
    const ticksB = [{ tickIndex: 0, observation: obs(101, 0) }];
    const result = runPortfolioReplay({
      datasetId: "adv-port",
      lifecycleRows: [
        { lifecycleId: "life-a", eventAtMs: baseNow, labelEndAtMs: baseNow + 2 * HOUR, manifest: mA },
        { lifecycleId: "life-b", eventAtMs: baseNow + MIN, labelEndAtMs: baseNow + 2 * HOUR, manifest: mB },
      ],
      policyId: "STRUCTURAL_STOP_TARGET",
      ticksByManifestId: { [mA.manifestId]: ticksA, [mB.manifestId]: ticksB },
      startingCapital: 110,
      maxConcurrentPositions: 1,
    });
    expect(result.acceptedLifecycles).toBe(1);
    expect(result.rejectedForPositionLimit).toBe(1);
    expect(result.rejections[0]?.reasonCode).toBe("POSITION_LIMIT");
    expect(result.availableCash).toBeLessThan(110);
    expect(result.endingCapital).toBeGreaterThan(100);
  });

  it("ADV-FILL-02 orphan applyFill without open order has no effect", () => {
    const m = buildMatchedEntryManifest({
      entrySignalId: "orphan",
      strategyId: "MOMENTUM_CONTINUATION",
      entryPolicyVersion: "v1",
      entryAtMs: baseNow,
      fills: [{ price: 100, quantity: 1, fee: 0.1, atMs: baseNow }],
      riskReference: buildRiskReference({
        entryPrice: 100,
        initialStopPrice: 99.2,
        initialQuantity: 1,
        entryFee: 0.1,
        includesFeesInBreakEven: true,
        computedAtMs: baseNow,
      }),
      invalidation: null,
      featureEvidenceIds: [],
      dataSource: "SYNTHETIC_FIXTURE",
      replayWindow: { fromMs: baseNow, toMs: baseNow + HOUR },
    });
    const session = createPr04ExitReplaySession({ manifest: m, policyId: "STRUCTURAL_STOP_TARGET" });
    const step = stepPr04ExitReplayTick(session, {
      tickIndex: 0,
      observation: obs(100, 0),
      applyFill: { price: 100, quantity: 1, fee: 0.1, feeAsset: "QUOTE" },
    });
    expect(step.fillApplied).toBe(false);
    expect(step.fillRejectedReason).toBe("FILL_WITHOUT_OPEN_ORDER");
  });
});
