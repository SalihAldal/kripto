import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { createFix02DisposablePostgres, type Fix02DisposablePostgres } from "./helpers/fix02-disposable-postgres";
import { createDurableFakeExchange } from "./helpers/durable-fake-exchange";
import { buildClientOrderIdFromExitIntent } from "@/src/server/execution/exit-intent-identity";
import { buildEarlyStructuralInvalidation } from "@/src/server/profitability/pr02-early-evaluator";
import type { ExitTickObservation } from "@/src/server/profitability/pr04-types";

const getTickerMock = vi.hoisted(() => vi.fn());
const placeMarketSellMock = vi.hoisted(() => vi.fn());
const getOrderStatusByClientOrderIdMock = vi.hoisted(() => vi.fn());
const durablePath = vi.hoisted(() => ({ value: "" }));

vi.mock("@/services/binance.service", () => ({
  getTicker: getTickerMock,
  placeMarketSell: placeMarketSellMock,
  placeMarketBuy: vi.fn(),
  placeMarketSellEmergency: vi.fn(),
  placeMarketBuyEmergency: vi.fn(),
  getOrderStatus: vi.fn(),
  getOrderStatusByClientOrderId: getOrderStatusByClientOrderIdMock,
  estimateFees: vi.fn().mockResolvedValue({ estimatedTakerFee: 0.1 }),
  getAccountBalances: vi.fn().mockResolvedValue([{ asset: "BTC", free: 10 }]),
  getKlines: vi.fn().mockResolvedValue([]),
  getOrderBook: vi.fn().mockResolvedValue({ bids: [], asks: [] }),
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

function obs(mark: number, offsetMs: number): ExitTickObservation {
  const t = baseNow + offsetMs;
  return {
    eventId: `evt-ack-${t}`,
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

async function seedExitReadyPosition() {
  const suffix = crypto.randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: { email: `ack-${suffix}@example.com`, username: `ack_${suffix}`, passwordHash: "hash" },
  });
  const conn = await prisma.exchangeConnection.create({
    data: { userId: user.id, exchange: "BINANCE", name: "paper", apiKeyMasked: "x", apiSecretEncrypted: "y", isSandbox: true },
  });
  const pair = await prisma.tradingPair.upsert({
    where: { symbol: "BTCTRY" },
    update: {},
    create: { symbol: "BTCTRY", baseAsset: "BTC", quoteAsset: "TRY" },
  });
  const { createPosition } = await import("@/src/server/repositories/execution.repository");
  const { bootstrapExitPersistenceAtEntry } = await import("@/src/server/execution/fix02-exit-persistence.service");
  const { buildExitPolicySnapshotAtEntry } = await import("@/src/server/profitability/pr04-exit-evaluator");
  const position = await createPosition({
    userId: user.id,
    exchangeConnectionId: conn.id,
    tradingPairId: pair.id,
    side: "LONG",
    entryPrice: 100,
    quantity: 1,
    feeTotal: 1,
    metadata: {
      mode: "live",
      executionId: `exec-ack-${suffix}`,
      executionVenue: "BINANCE_TR",
      entryFeeTotal: 1,
      entryQuantityInitial: 1,
      entryFeeAllocated: 0,
      buyFee: 1,
    },
  });
  const invalidation = buildEarlyStructuralInvalidation({
    baselinePrice: 100,
    firstDetectionPrice: 100.2,
    latestPrice: 101.5,
    asOfMs: baseNow,
  });
  const snapshot = buildExitPolicySnapshotAtEntry({
    positionId: position.id,
    strategyId: "EARLY_ACCELERATION",
    entryPolicyVersion: "pr02-v1",
    entrySignalId: "sig-ack",
    setupId: "setup-ack",
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
    entryFills: [{ price: 100, quantity: 1, fee: 1, atMs: baseNow }],
    entryFee: 1,
    ownerExecutionId: `exec-ack-${suffix}`,
  });
  return { user, conn, pair, position, suffix };
}

describe.sequential("ACK-loss + process death E2E", () => {
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
    vi.clearAllMocks();
    durablePath.value = path.join(os.tmpdir(), `kripto-ack-loss-${Date.now()}.json`);
    createDurableFakeExchange(durablePath.value).reset();
    getTickerMock.mockResolvedValue({ symbol: "BTCTRY", price: 90, change24h: 0, volume24h: 0 });
    getOrderStatusByClientOrderIdMock.mockImplementation(async (_symbol: string, clientOrderId: string) => {
      const exchange = createDurableFakeExchange(durablePath.value);
      return exchange.getOrderByClientOrderId(clientOrderId);
    });
    placeMarketSellMock.mockImplementation(async (_symbol: string, qty: number, _dry: boolean, opts?: { clientOrderId?: string }) => {
      const clientOrderId = opts?.clientOrderId ?? "missing-client";
      const exchange = createDurableFakeExchange(durablePath.value);
      exchange.recordSubmit({
        clientOrderId,
        symbol: "BTCTRY",
        side: "SELL",
        quantity: qty,
        price: 89,
        tradeId: `ack-trade-${clientOrderId}`,
        fee: 0.09,
        filledAtMs: baseNow + 3_000,
      });
      throw new Error("SUBMIT_TIMEOUT");
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

  it("submit timeout + process death sonrası RECONCILE tek kez muhasebeleştirir, submit sayısı 1 kalır", async () => {
    const { user, position, suffix } = await seedExitReadyPosition();
    const childEnv = {
      ...process.env,
      ACK_POSITION_ID: position.id,
      ACK_USER_ID: user.id,
      ACK_EXECUTION_ID: `exec-ack-${suffix}`,
      ACK_DURABLE_EXCHANGE_FILE: durablePath.value,
      EXECUTION_PR04_EXIT_EVAL_ENABLED: "true",
      EXECUTION_PR04_EXIT_ROUTING_ENABLED: "true",
    };
    const intentId = `intent-ack-${suffix}`;
    const { settleOpenPosition } = await import("@/src/server/execution/post-trade-settlement.service");
    const settleResult = await settleOpenPosition({
      executionId: `exec-ack-${suffix}`,
      positionId: position.id,
      reason: "STOP_LOSS",
      mode: "live",
      requestedCloseQuantity: 1,
      settlementFillId: intentId,
    });
    expect((settleResult as { closed?: boolean }).closed).not.toBe(true);
    expect(createDurableFakeExchange(durablePath.value).getSubmitCount()).toBe(1);
    await prisma.positionExitPersistedState.update({
      where: { positionId: position.id },
      data: {
        reconciliationStatus: "RECONCILE_REQUIRED",
        activeExitIntentId: intentId,
      },
    });

    const { reconcileFix02ExitBundles } = await import("@/src/server/execution/fix02-exit-reconciliation.service");
    const recovered = await reconcileFix02ExitBundles();
    expect(recovered.recovered).toBeGreaterThanOrEqual(1);
    expect(createDurableFakeExchange(durablePath.value).getSubmitCount()).toBe(1);
    expect(await prisma.tradeExecution.count({ where: { tradeOrder: { positionId: position.id } } })).toBe(1);
    expect(await prisma.positionSettlementFill.count({ where: { positionId: position.id } })).toBe(1);
    const closed = await prisma.position.findUnique({ where: { id: position.id } });
    expect(Number(closed?.quantity ?? 1)).toBeLessThan(0.01);

    const second = await reconcileFix02ExitBundles();
    expect(second.recovered).toBe(0);
    expect(await prisma.tradeExecution.count({ where: { tradeOrder: { positionId: position.id } } })).toBe(1);
  }, 90_000);
});
