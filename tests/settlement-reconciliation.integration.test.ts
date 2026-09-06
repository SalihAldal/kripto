import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { createFix02DisposablePostgres, type Fix02DisposablePostgres } from "./helpers/fix02-disposable-postgres";

const getTickerMock = vi.hoisted(() => vi.fn());
const placeMarketSellMock = vi.hoisted(() => vi.fn());
const placeMarketBuyMock = vi.hoisted(() => vi.fn());
const getOrderStatusMock = vi.hoisted(() => vi.fn());
const estimateFeesMock = vi.hoisted(() => vi.fn());
const getAccountBalancesMock = vi.hoisted(() => vi.fn());
const paperCloseMock = vi.hoisted(() => vi.fn());
const paperOpenMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/binance.service", () => ({
  getTicker: getTickerMock,
  placeMarketSell: placeMarketSellMock,
  placeMarketBuy: placeMarketBuyMock,
  placeMarketSellEmergency: vi.fn(),
  placeMarketBuyEmergency: vi.fn(),
  getOrderStatus: getOrderStatusMock,
  estimateFees: estimateFeesMock,
  getAccountBalances: getAccountBalancesMock,
  getKlines: vi.fn().mockResolvedValue([]),
  getOrderBook: vi.fn().mockResolvedValue({ bids: [], asks: [] }),
}));

vi.mock("@/src/server/exchange-simulator/paper-exchange-adapter.service", () => ({
  executePaperCloseOrderViaSimulator: paperCloseMock,
  executePaperOpenOrderViaSimulator: paperOpenMock,
}));

vi.mock("@/src/server/execution/execution-event-bus", () => ({ publishExecutionEvent: vi.fn() }));
vi.mock("@/src/server/scanner/scanner-worker.service", () => ({ resumeScannerWorker: vi.fn(), pauseScannerWorkerUntilResume: vi.fn() }));
vi.mock("@/src/server/observability/trade-event-log", () => ({ logTradeEvent: vi.fn() }));
vi.mock("@/src/server/notifications/notification.service", () => ({ notifySystemEvent: vi.fn() }));
vi.mock("@/src/server/forensics/forensic-bridge.service", () => ({ bridgeClosedTradePnl: vi.fn() }));
vi.mock("@/src/server/repositories/risk.repository", () => ({ getConsecutiveLossCount: vi.fn().mockResolvedValue(0) }));
vi.mock("@/src/server/risk", () => ({ getEffectiveRiskConfig: vi.fn().mockResolvedValue({ consecutiveLossBreaker: 3 }) }));

let disposable: Fix02DisposablePostgres | null = null;
let prisma: typeof import("@/src/server/db/prisma").prisma;
const baseNow = Date.parse("2026-09-06T10:00:00.000Z");

async function seedPosition(quantity = 1) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: { email: `sr-${suffix}@example.com`, username: `sr_${suffix}`, passwordHash: "hash" },
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
      metadata: { mode: "paper", executionId: `exec-${suffix}`, executionVenue: "BINANCE_TR" },
    },
  });
  return { user, conn, pair, position, suffix };
}

describe("Settlement & reconciliation integration", () => {
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
    vi.clearAllMocks();
    getTickerMock.mockResolvedValue({ symbol: "BTCTRY", price: 90, change24h: 0, volume24h: 0 });
    estimateFeesMock.mockResolvedValue({ estimatedTakerFee: 0.1 });
    getAccountBalancesMock.mockResolvedValue([{ asset: "BTC", free: 10 }]);
    paperCloseMock.mockResolvedValue({
      orderId: "paper-close-1",
      clientOrderId: "paper-close-client-1",
      symbol: "BTCTRY",
      side: "SELL",
      type: "MARKET",
      status: "FILLED",
      executedQty: 0.5,
      price: 110,
      dryRun: true,
      fee: 0.05,
      metadata: {
        fee: 0.05,
        feeAsset: "QUOTE",
        tradeId: "paper-trade-1",
        filledAtMs: baseNow + 1_000,
      },
    });
    await prisma.positionSettlementFill.deleteMany();
    await prisma.positionExitPersistedState.deleteMany();
    await prisma.profitLossRecord.deleteMany();
    await prisma.tradeExecution.deleteMany();
    await prisma.tradeOrder.deleteMany();
    await prisma.position.deleteMany();
    await prisma.exchangeConnection.deleteMany();
    await prisma.user.deleteMany();
  });

  it("normal ingestion sonrası reconcile aynı fill'i tekrar muhasebeleştirmez", async () => {
    const { applyCanonicalPartialSettlementFill } = await import("@/src/server/execution/canonical-settlement-fill.service");
    const { reconcileFix02ExitBundles } = await import("@/src/server/execution/fix02-exit-reconciliation.service");
    const { user, conn, pair, position } = await seedPosition(1);
    await prisma.positionExitPersistedState.create({
      data: {
        positionId: position.id,
        userId: user.id,
        schemaVersion: "fix02-exit-persistence-v1",
        snapshot: { positionId: position.id },
        state: {
          positionId: position.id,
          remainingQuantity: 1,
          reservedSellQuantity: 1,
          orderState: "SUBMITTED",
          activeExitOrder: { intentId: "i1", requestedQuantity: 1, executedQuantity: 0, openQuantity: 1, partialLegId: null, terminal: false },
          exitFills: [],
          completedPartialLegs: [],
          terminalStatus: "OPEN",
          lastDecision: "STRUCTURAL_STOP",
          version: 1,
          snapshot: { exitPolicyId: "STRUCTURAL_STOP_TARGET" },
        } as unknown as Prisma.InputJsonValue,
        stateVersion: 1,
        terminalStatus: "OPEN",
        activeExitIntentId: "i1",
        reconciliationStatus: "RECONCILE_REQUIRED",
      },
    });
    const fillId = "fill-normal-reconcile-1";
    await applyCanonicalPartialSettlementFill({
      positionId: position.id,
      settlementFillId: fillId,
      userId: user.id,
      exchangeConnectionId: conn.id,
      tradingPairId: pair.id,
      quoteAsset: "TRY",
      positionSide: "LONG",
      closeSide: "SELL",
      fillPrice: 110,
      filledQuantity: 0.5,
      closeFee: 0.05,
      feeAsset: "QUOTE",
      openFeePortion: 0.02,
      clientOrderId: "client-1",
      exchangeOrderId: "ex-order-1",
      closeReason: "TAKE_PROFIT",
      mode: "paper",
      orderTerminal: false,
      orderRemainingQuantity: 0.5,
      fillAtMs: baseNow + 1000,
      metadata: { exchangeTradeId: "trade-1" },
    });
    await reconcileFix02ExitBundles();
    expect(await prisma.positionSettlementFill.count({ where: { positionId: position.id } })).toBe(1);
    expect(await prisma.tradeExecution.count({ where: { tradeOrder: { positionId: position.id } } })).toBe(1);
  });

  it("execution var settlement yoksa reconcile bir kez uygular, kopya execution üretmez", async () => {
    const { reconcileFix02ExitBundles } = await import("@/src/server/execution/fix02-exit-reconciliation.service");
    const { user, conn, pair, position } = await seedPosition(1);
    const order = await prisma.tradeOrder.create({
      data: {
        userId: user.id,
        exchangeConnectionId: conn.id,
        tradingPairId: pair.id,
        positionId: position.id,
        side: "SELL",
        type: "MARKET",
        quantity: 1,
        status: "FILLED",
        clientOrderId: "client-reconcile",
        exchangeOrderId: "exchange-reconcile-order",
        metadata: { closeReason: "STOP_LOSS", pr04DecisionKind: "STRUCTURAL_STOP", exchangeTradeId: "trade-reconcile-1", feeAsset: "QUOTE", filledAtMs: baseNow + 2000 },
      },
    });
    await prisma.tradeExecution.create({
      data: {
        tradeOrderId: order.id,
        status: "SUCCESS",
        executionPrice: 90,
        executedQty: 1,
        quoteQty: 90,
        fee: 0.1,
        executionRef: "trade-reconcile-1",
        executedAt: new Date(baseNow + 2_000),
        metadata: { exchangeTradeId: "trade-reconcile-1" },
      },
    });
    await prisma.positionExitPersistedState.create({
      data: {
        positionId: position.id,
        userId: user.id,
        schemaVersion: "fix02-exit-persistence-v1",
        snapshot: { positionId: position.id },
        state: {
          positionId: position.id,
          remainingQuantity: 1,
          reservedSellQuantity: 1,
          orderState: "SUBMITTED",
          activeExitOrder: { intentId: "intent-r", requestedQuantity: 1, executedQuantity: 0, openQuantity: 1, partialLegId: null, terminal: false },
          exitFills: [],
          completedPartialLegs: [],
          terminalStatus: "OPEN",
          lastDecision: "STRUCTURAL_STOP",
          version: 3,
          snapshot: { exitPolicyId: "STRUCTURAL_STOP_TARGET" },
        } as unknown as Prisma.InputJsonValue,
        stateVersion: 3,
        terminalStatus: "OPEN",
        activeExitIntentId: "intent-r",
        reconciliationStatus: "RECONCILE_REQUIRED",
      },
    });
    const reconcile1 = await reconcileFix02ExitBundles();
    expect(reconcile1.recovered).toBe(1);
    expect(await prisma.positionSettlementFill.count({ where: { positionId: position.id } })).toBe(1);
    expect(await prisma.tradeExecution.count({ where: { tradeOrderId: order.id } })).toBe(2);
    const reconcile2 = await reconcileFix02ExitBundles();
    expect(reconcile2.recovered).toBe(0);
    expect(await prisma.positionSettlementFill.count({ where: { positionId: position.id } })).toBe(1);
  });

  it("aynı orderda 0.2+0.3+0.5 multi-fill tutarlı uygulanır", async () => {
    const { applyCanonicalPartialSettlementFill } = await import("@/src/server/execution/canonical-settlement-fill.service");
    const { user, conn, pair, position } = await seedPosition(1);
    const fills = [
      { id: "mf-1", qty: 0.2, px: 101, fee: 0.01, trade: "trade-mf-1" },
      { id: "mf-2", qty: 0.3, px: 103, fee: 0.02, trade: "trade-mf-2" },
      { id: "mf-3", qty: 0.5, px: 105, fee: 0.03, trade: "trade-mf-3" },
    ];
    for (const fill of fills) {
      const result = await applyCanonicalPartialSettlementFill({
        positionId: position.id,
        settlementFillId: fill.id,
        userId: user.id,
        exchangeConnectionId: conn.id,
        tradingPairId: pair.id,
        quoteAsset: "TRY",
        positionSide: "LONG",
        closeSide: "SELL",
        fillPrice: fill.px,
        filledQuantity: fill.qty,
        closeFee: fill.fee,
        feeAsset: "QUOTE",
        openFeePortion: 0.01,
        clientOrderId: "client-mf",
        exchangeOrderId: "order-mf",
        closeReason: "TAKE_PROFIT",
        mode: "paper",
        orderTerminal: fill.id === "mf-3",
        orderRemainingQuantity: fill.id === "mf-1" ? 0.8 : fill.id === "mf-2" ? 0.5 : 0,
        fillAtMs: baseNow + 3_000,
        metadata: { exchangeTradeId: fill.trade },
      });
      expect(result.status).toBe("APPLIED");
    }
    const final = await prisma.position.findUnique({ where: { id: position.id } });
    const order = await prisma.tradeOrder.findFirst({ where: { positionId: position.id } });
    const execs = await prisma.tradeExecution.findMany({ where: { tradeOrderId: order!.id } });
    expect(final?.quantity).toBe(0);
    expect(execs).toHaveLength(3);
    const weighted = (0.2 * 101 + 0.3 * 103 + 0.5 * 105) / 1;
    expect(order?.avgExecutionPrice ?? 0).toBeCloseTo(weighted, 8);
    expect(order?.fee ?? 0).toBeCloseTo(0.06, 8);
  });

  it("order-manager gerçek pending emirde ikinci satış açılmasını engeller", async () => {
    const { settleOpenPosition } = await import("@/src/server/execution/post-trade-settlement.service");
    const { user, conn, pair, position } = await seedPosition(1);
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
    const result = await settleOpenPosition({
      executionId: "exec-pending-block",
      positionId: position.id,
      reason: "STOP_LOSS",
      mode: "paper",
    });
    expect(result.closed).toBe(false);
    expect(String((result as { reason?: string }).reason)).toContain("Pending close order exists");
    expect(await prisma.tradeOrder.count({ where: { positionId: position.id } })).toBe(1);
  }, 30_000);

  it("dust/min-notional ve balance mismatch yolları sahte close/pnl yazmaz", async () => {
    const { settleOpenPosition } = await import("@/src/server/execution/post-trade-settlement.service");
    const seeded1 = await seedPosition(1);
    placeMarketSellMock.mockRejectedValueOnce(new Error("Notional below min"));
    getAccountBalancesMock.mockResolvedValue([{ asset: "BTC", free: 1 }]);
    const dust = await settleOpenPosition({
      executionId: "exec-dust",
      positionId: seeded1.position.id,
      reason: "STOP_LOSS",
      mode: "live",
    });
    expect(dust.closed).toBe(false);
    const p1 = await prisma.position.findUnique({ where: { id: seeded1.position.id } });
    expect(p1?.status).toBe("OPEN");
    expect(await prisma.profitLossRecord.count({ where: { positionId: seeded1.position.id } })).toBe(0);

    const seeded2 = await seedPosition(1);
    getAccountBalancesMock.mockResolvedValue([{ asset: "BTC", free: 0 }]);
    const mismatch = await settleOpenPosition({
      executionId: "exec-mismatch",
      positionId: seeded2.position.id,
      reason: "STOP_LOSS",
      mode: "live",
    });
    expect(mismatch.closed).toBe(false);
    const p2 = await prisma.position.findUnique({ where: { id: seeded2.position.id } });
    expect(p2?.status).toBe("OPEN");
    expect(await prisma.profitLossRecord.count({ where: { positionId: seeded2.position.id } })).toBe(0);
  });
});

