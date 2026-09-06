import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFix02DisposablePostgres, type Fix02DisposablePostgres } from "./helpers/fix02-disposable-postgres";

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

async function seedPosition(quantity = 1) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: { email: `exec-corr-${suffix}@example.com`, username: `exec_${suffix}`, passwordHash: "hash" },
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

describe("EXEC correction — PostgreSQL integration", () => {
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
      metadata: { fee: 0.08, feeAsset: "QUOTE", simulationId: `sim-${Date.now()}` },
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

  it("A stop after completed partial sell is not ORDER_IN_FLIGHT", async () => {
    const { buildExitPolicySnapshotAtEntry, getExitPolicyState } = await import(
      "@/src/server/profitability/pr04-exit-evaluator"
    );
    const { user, position, suffix } = await seedPosition(1);
    const { bootstrapExitPersistenceAtEntry } = await import("@/src/server/execution/fix02-exit-persistence.service");
    const { processFix02Pr04ExitTick } = await import("@/src/server/execution/fix02-exit-routing.service");
    const snapshot = buildExitPolicySnapshotAtEntry({
      positionId: position.id,
      strategyId: "BREAKOUT_RETEST",
      entryPolicyVersion: "pr03-v1",
      entrySignalId: "sig-1",
      setupId: "setup-1",
      exitPolicyId: "STRUCTURAL_PARTIAL_TRAIL",
      experimentalMode: true,
      takeProfitPercent: 50,
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
    const partial = await processFix02Pr04ExitTick({
      executionId: `exec-${suffix}`,
      positionId: position.id,
      userId: user.id,
      side: "LONG",
      mode: "paper",
      observation: {
        eventId: `evt-partial-${suffix}`,
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
    const afterPartial = await prisma.position.findUnique({ where: { id: position.id } });
    const exitState = getExitPolicyState(position.id)!;
    expect(partial.partial).toBe(true);
    expect(afterPartial?.status).toBe("OPEN");
    expect((afterPartial?.quantity ?? 0) < 1).toBe(true);
    expect(exitState.orderState).toBe("NONE");
    expect(exitState.reservedSellQuantity).toBe(0);

    const stop = await processFix02Pr04ExitTick({
      executionId: `exec-${suffix}`,
      positionId: position.id,
      userId: user.id,
      side: "LONG",
      mode: "paper",
      observation: {
        eventId: `evt-stop-${suffix}`,
        eventAtMs: baseNow + 3000,
        availableAtMs: baseNow + 3000,
        markPrice: 90,
        bid: 89.9,
        ask: 90.1,
        high: 91,
        low: 89,
        closed: true,
        stale: false,
        dataGap: false,
      },
    });
    expect(stop.reasonCode).not.toBe("ORDER_IN_FLIGHT");
    expect(stop.decisionKind).toBe("STRUCTURAL_STOP");
    expect(stop.closed).toBe(true);
    const closed = await prisma.position.findUnique({ where: { id: position.id } });
    expect(closed?.status).toBe("CLOSED");
  }, 30_000);

  it("C full close propagates real fill price and fee", async () => {
    const { buildExitPolicySnapshotAtEntry, getExitPolicyState } = await import(
      "@/src/server/profitability/pr04-exit-evaluator"
    );
    const { user, position, suffix } = await seedPosition(1);
    const { bootstrapExitPersistenceAtEntry } = await import("@/src/server/execution/fix02-exit-persistence.service");
    const { processFix02Pr04ExitTick } = await import("@/src/server/execution/fix02-exit-routing.service");
    paperCloseMock.mockImplementationOnce(async () => ({
      orderId: "paper-full",
      clientOrderId: "client-full",
      symbol: "BTCTRY",
      side: "SELL",
      type: "MARKET",
      status: "FILLED",
      executedQty: 1,
      price: 88.5,
      dryRun: true,
      fee: 0.15,
      metadata: { fee: 0.15, feeAsset: "QUOTE", simulationId: "sim-full-1" },
    }));
    const snapshot = buildExitPolicySnapshotAtEntry({
      positionId: position.id,
      strategyId: "BREAKOUT_RETEST",
      entryPolicyVersion: "pr03-v1",
      entrySignalId: "sig-1",
      setupId: "setup-1",
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
    const routed = await processFix02Pr04ExitTick({
      executionId: `exec-${suffix}`,
      positionId: position.id,
      userId: user.id,
      side: "LONG",
      mode: "paper",
      observation: {
        eventId: `evt-full-${suffix}`,
        eventAtMs: baseNow + 1000,
        availableAtMs: baseNow + 1000,
        markPrice: 88.5,
        bid: 88.4,
        ask: 88.6,
        high: 89,
        low: 88,
        closed: true,
        stale: false,
        dataGap: false,
      },
    });
    expect(routed.closed).toBe(true);
    const exitState = getExitPolicyState(position.id)!;
    const lastFill = exitState.exitFills[exitState.exitFills.length - 1];
    const settledRows = await prisma.positionSettlementFill.findMany({ where: { positionId: position.id } });
    const orders = await prisma.tradeOrder.findMany({ where: { positionId: position.id } });
    expect(lastFill?.price).toBe(88.5);
    expect(lastFill?.fee).toBe(0.15);
    expect(lastFill?.quantity).toBe(1);
    expect(settledRows.length).toBe(1);
    expect(settledRows[0]?.fillPrice).toBe(88.5);
    expect(orders.length).toBe(1);
    expect(orders[0]?.status).toBe("FILLED");
  }, 30_000);

  it("D atomic partial settlement rolls back on injected failure", async () => {
    const { applyCanonicalPartialSettlementFill, setSettlementFillTransactionHook } = await import(
      "@/src/server/execution/canonical-settlement-fill.service"
    );
    const { user, position } = await seedPosition(1);
    setSettlementFillTransactionHook("afterPositionUpdate", () => {
      throw new Error("INJECTED_ROLLBACK");
    });
    const result = await applyCanonicalPartialSettlementFill({
      positionId: position.id,
      settlementFillId: "fill-atomic-fail",
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
      clientOrderId: "client-atomic",
      exchangeOrderId: "ex-atomic",
      closeReason: "TAKE_PROFIT",
      mode: "paper",
    });
    expect(result.status).toBe("FAILED");
    const after = await prisma.position.findUnique({ where: { id: position.id } });
    const orders = await prisma.tradeOrder.count({ where: { positionId: position.id } });
    const pnl = await prisma.profitLossRecord.count({ where: { positionId: position.id } });
    const dedup = await prisma.positionSettlementFill.count({ where: { positionId: position.id } });
    expect(after?.quantity).toBe(1);
    expect(orders).toBe(0);
    expect(pnl).toBe(0);
    expect(dedup).toBe(0);
  });

  it("F duplicate fill is idempotent across concurrent clients", async () => {
    const { applyCanonicalPartialSettlementFill } = await import(
      "@/src/server/execution/canonical-settlement-fill.service"
    );
    const { user, position } = await seedPosition(1);
    const payload = {
      positionId: position.id,
      settlementFillId: "fill-dup-concurrent",
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
      clientOrderId: "client-dup",
      exchangeOrderId: "ex-dup",
      closeReason: "TAKE_PROFIT",
      mode: "paper",
    };
    const [first, second] = await Promise.all([
      applyCanonicalPartialSettlementFill(payload),
      applyCanonicalPartialSettlementFill(payload),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(["ALREADY_APPLIED", "APPLIED"]);
    const after = await prisma.position.findUnique({ where: { id: position.id } });
    expect(after?.quantity).toBe(0.6);
    const pnlCount = await prisma.profitLossRecord.count({ where: { positionId: position.id } });
    expect(pnlCount).toBe(1);
  });

  it("G different fill ids applied concurrently preserve quantity and pnl", async () => {
    const { applyCanonicalPartialSettlementFill } = await import(
      "@/src/server/execution/canonical-settlement-fill.service"
    );
    const { user, position } = await seedPosition(1);
    const [a, b] = await Promise.all([
      applyCanonicalPartialSettlementFill({
        positionId: position.id,
        settlementFillId: "fill-concurrent-a",
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
        clientOrderId: "client-concurrent",
        exchangeOrderId: "ex-concurrent",
        closeReason: "TAKE_PROFIT",
        mode: "paper",
        orderTerminal: false,
        orderRemainingQuantity: 0.6,
      }),
      applyCanonicalPartialSettlementFill({
        positionId: position.id,
        settlementFillId: "fill-concurrent-b",
        userId: user.id,
        exchangeConnectionId: position.exchangeConnectionId,
        tradingPairId: position.tradingPairId,
        quoteAsset: "TRY",
        positionSide: "LONG",
        closeSide: "SELL",
        fillPrice: 111,
        filledQuantity: 0.5,
        closeFee: 0.1,
        feeAsset: "QUOTE",
        openFeePortion: 0.05,
        clientOrderId: "client-concurrent",
        exchangeOrderId: "ex-concurrent",
        closeReason: "TAKE_PROFIT",
        mode: "paper",
        orderTerminal: true,
        orderRemainingQuantity: 0.1,
      }),
    ]);
    expect(a.status).toBe("APPLIED");
    expect(b.status).toBe("APPLIED");
    const after = await prisma.position.findUnique({ where: { id: position.id } });
    expect(after?.quantity).toBeCloseTo(0.1, 8);
    expect(await prisma.profitLossRecord.count({ where: { positionId: position.id } })).toBe(2);
  });

  it("H reconcile-required pending order is consumed by RECONCILE worker", async () => {
    const { buildExitPolicySnapshotAtEntry, getExitPolicyState } = await import(
      "@/src/server/profitability/pr04-exit-evaluator"
    );
    const { bootstrapExitPersistenceAtEntry, loadPersistedExitBundle } = await import(
      "@/src/server/execution/fix02-exit-persistence.service"
    );
    const { processFix02Pr04ExitTick } = await import("@/src/server/execution/fix02-exit-routing.service");
    const { runExecutionEngineV2Job } = await import("@/src/server/execution-engine-v2/execution-engine-v2.orchestrator");
    const { addTradeExecution, updateOrderStatus } = await import("@/src/server/repositories/execution.repository");
    const { user, position, suffix } = await seedPosition(1);
    paperCloseMock.mockImplementationOnce(async () => ({
      orderId: "ack-lost-order",
      clientOrderId: "ack-lost-client",
      symbol: "BTCTRY",
      side: "SELL",
      type: "MARKET",
      status: "NEW",
      executedQty: 0,
      price: 90,
      dryRun: true,
      fee: 0.1,
      metadata: { fee: 0.1, feeAsset: "QUOTE" },
    }));
    const snapshot = buildExitPolicySnapshotAtEntry({
      positionId: position.id,
      strategyId: "BREAKOUT_RETEST",
      entryPolicyVersion: "pr03-v1",
      entrySignalId: "sig-ack",
      setupId: "setup-ack",
      exitPolicyId: "STRUCTURAL_STOP_TARGET",
      experimentalMode: true,
      takeProfitPercent: 10,
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
    const routed = await processFix02Pr04ExitTick({
      executionId: `exec-${suffix}`,
      positionId: position.id,
      userId: user.id,
      side: "LONG",
      mode: "paper",
      observation: {
        eventId: `evt-ack-${suffix}`,
        eventAtMs: baseNow + 1000,
        availableAtMs: baseNow + 1000,
        markPrice: 90,
        bid: 89.9,
        ask: 90.1,
        high: 91,
        low: 89,
        closed: true,
        stale: false,
        dataGap: false,
      },
    });
    expect(routed.reconciliationRequired).toBe(true);
    const pending = await prisma.tradeOrder.findFirst({
      where: { positionId: position.id, exchangeOrderId: "ack-lost-order" },
      orderBy: { createdAt: "desc" },
    });
    expect(pending).not.toBeNull();
    await updateOrderStatus({
      orderId: pending!.id,
      status: "FILLED",
      executedAt: new Date(),
      avgExecutionPrice: 90,
      fee: 0.1,
    });
    await addTradeExecution({
      tradeOrderId: pending!.id,
      status: "SUCCESS",
      executionPrice: 90,
      executedQty: 1,
      quoteQty: 90,
      fee: 0.1,
      executionRef: "ack-lost-order",
      metadata: { reconciled: true },
    });
    await runExecutionEngineV2Job({ type: "RECONCILE" });
    const after = await prisma.position.findUnique({ where: { id: position.id } });
    const bundle = await loadPersistedExitBundle(position.id);
    expect(after?.status).toBe("CLOSED");
    expect(after?.quantity).toBe(0);
    expect(bundle?.reconciliationStatus).toBe("OK");
    expect((bundle?.processedFillIds.length ?? 0) > 0).toBe(true);
  }, 45_000);
});

describe("EXEC correction — in-memory evaluator", () => {
  beforeEach(async () => {
    const { resetExitPolicyStoreForTests } = await import("@/src/server/profitability/pr04-exit-evaluator");
    resetExitPolicyStoreForTests();
  });

  it("B open partial order keeps reservation until filled", async () => {
    const {
      applyExitFill,
      buildExitPolicySnapshotAtEntry,
      evaluateExitPolicyTick,
      getExitPolicyState,
      initializeExitPolicyState,
    } = await import("@/src/server/profitability/pr04-exit-evaluator");
    const snapshot = buildExitPolicySnapshotAtEntry({
      positionId: "pos-open-partial",
      strategyId: "BREAKOUT_RETEST",
      entryPolicyVersion: "v1",
      entrySignalId: "sig",
      setupId: "setup",
      exitPolicyId: "STRUCTURAL_STOP_TARGET",
      experimentalMode: true,
      takeProfitPercent: 5,
      invalidation: null,
      boundAtMs: baseNow,
    });
    initializeExitPolicyState({
      snapshot,
      side: "LONG",
      entryFills: [{ price: 100, quantity: 1, fee: 0.1, atMs: baseNow }],
      entryFee: 0.1,
    });
    applyExitFill({
      positionId: "pos-open-partial",
      fill: { price: 101, quantity: 0.2, fee: 0.02, feeAsset: "QUOTE", atMs: baseNow + 1 },
      decisionKind: "PARTIAL_TAKE_PROFIT",
      openOrderRemainingQuantity: 0.3,
    });
    const state = getExitPolicyState("pos-open-partial")!;
    expect(state.remainingQuantity).toBe(0.8);
    expect(state.reservedSellQuantity).toBe(0.3);
    expect(state.orderState).toBe("PARTIALLY_FILLED");
    const blocked = evaluateExitPolicyTick({
      positionId: "pos-open-partial",
      side: "LONG",
      observation: {
        eventId: "evt-block",
        eventAtMs: baseNow + 2,
        availableAtMs: baseNow + 2,
        markPrice: 90,
        bid: 89.9,
        ask: 90.1,
        high: 91,
        low: 89,
        closed: true,
        stale: false,
        dataGap: false,
      },
    });
    expect(blocked.decision.reasonCode).toBe("ORDER_IN_FLIGHT");
  });
});
