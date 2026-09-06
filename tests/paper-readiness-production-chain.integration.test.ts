/**
 * Paper readiness — production chain without manual position seed.
 * Entry uses repository createPosition after paper adapter fill (same path as orchestrator post-fill).
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { createFix02DisposablePostgres, type Fix02DisposablePostgres } from "./helpers/fix02-disposable-postgres";
import { buildEarlyStructuralInvalidation } from "@/src/server/profitability/pr02-early-evaluator";
import { seedEntryFeeAllocationMetadata } from "@/src/server/execution/entry-fee-allocation";
import type { ExitTickObservation } from "@/src/server/profitability/pr04-types";

const paperOpenMock = vi.hoisted(() => vi.fn());
const paperCloseMock = vi.hoisted(() => vi.fn());
const getTickerMock = vi.hoisted(() => vi.fn());

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

function obs(mark: number, offsetMs: number): ExitTickObservation {
  const t = baseNow + offsetMs;
  return {
    eventId: `evt-${t}`,
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

describe("Paper readiness production chain", () => {
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
    getTickerMock.mockResolvedValue({ symbol: "BTCTRY", price: 100, change24h: 0, volume24h: 0 });
    process.env.EXECUTION_PR04_EXIT_EVAL_ENABLED = "true";
    process.env.EXECUTION_PR04_EXIT_ROUTING_ENABLED = "true";
    await prisma.positionSettlementFill.deleteMany();
    await prisma.positionExitPersistedState.deleteMany();
    await prisma.profitLossRecord.deleteMany();
    await prisma.tradeExecution.deleteMany();
    await prisma.tradeOrder.deleteMany();
    await prisma.position.deleteMany();
    await prisma.exchangeConnection.deleteMany();
    await prisma.user.deleteMany();
  });

  it("fixture context → paper entry → partial TP → structural stop → canonical settlement", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const user = await prisma.user.create({
      data: { email: `prc-${suffix}@example.com`, username: `prc_${suffix}`, passwordHash: "hash" },
    });
    const conn = await prisma.exchangeConnection.create({
      data: { userId: user.id, exchange: "BINANCE", name: "paper", apiKeyMasked: "x", apiSecretEncrypted: "y", isSandbox: true },
    });
    const pair = await prisma.tradingPair.upsert({
      where: { symbol: "BTCTRY" },
      update: {},
      create: { symbol: "BTCTRY", baseAsset: "BTC", quoteAsset: "TRY" },
    });
    const executionId = `exec-${suffix}`;
    const entryTradeId = `paper-entry-trade-${suffix}`;
    paperOpenMock.mockResolvedValueOnce({
      orderId: `paper-open-${suffix}`,
      clientOrderId: `paper-open-${suffix}`,
      symbol: "BTCTRY",
      side: "BUY",
      type: "MARKET",
      status: "FILLED",
      executedQty: 1,
      price: 100,
      dryRun: true,
      fee: 1,
      simulationId: entryTradeId,
      metadata: {
        simulationId: entryTradeId,
        tradeId: entryTradeId,
        fillId: entryTradeId,
        feeAsset: "QUOTE",
        filledAtMs: baseNow,
      },
    });
    const { createPosition } = await import("@/src/server/repositories/execution.repository");
    const { bootstrapExitPersistenceAtEntry } = await import("@/src/server/execution/fix02-exit-persistence.service");
    const { buildExitPolicySnapshotAtEntry } = await import("@/src/server/profitability/pr04-exit-evaluator");
    const { processFix02Pr04ExitTick } = await import("@/src/server/execution/fix02-exit-routing.service");
    const { executePaperOpenOrderViaSimulator } = await import("@/src/server/exchange-simulator/paper-exchange-adapter.service");

    const openFill = await executePaperOpenOrderViaSimulator({
      userId: user.id,
      executionId,
      symbol: "BTCTRY",
      side: "BUY",
      quantity: 1,
      priceHint: 100,
      quoteAsset: "TRY",
      baseAsset: "BTC",
    });
    expect(openFill.metadata?.tradeId).toBe(entryTradeId);
    const position = await createPosition({
      userId: user.id,
      exchangeConnectionId: conn.id,
      tradingPairId: pair.id,
      side: "LONG",
      entryPrice: 100,
      quantity: 1,
      feeTotal: 1,
      metadata: seedEntryFeeAllocationMetadata({
        entryFeeTotal: 1,
        entryQuantityInitial: 1,
        metadata: {
          mode: "paper",
          executionId,
          executionVenue: "BINANCE_TR",
          strategyId: "EARLY_ACCELERATION",
          openTradeId: entryTradeId,
        },
      }),
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
      entrySignalId: "sig-prc",
      setupId: "setup-prc",
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
      ownerExecutionId: executionId,
    });

    let partialCloseQty = 0;
    paperCloseMock.mockImplementation(async (args: { quantity: number }) => ({
      orderId: `paper-partial-${suffix}`,
      clientOrderId: `paper-partial-${suffix}`,
      symbol: "BTCTRY",
      side: "SELL",
      type: "MARKET",
      status: "FILLED",
      executedQty: args.quantity,
      price: 110,
      dryRun: true,
      fee: 0.05,
      metadata: {
        tradeId: `partial-trade-${suffix}`,
        simulationId: `partial-trade-${suffix}`,
        feeAsset: "QUOTE",
        filledAtMs: baseNow + 2_000,
      },
    }));

    const partial = await processFix02Pr04ExitTick({
      executionId,
      positionId: position.id,
      userId: user.id,
      side: "LONG",
      mode: "paper",
      observation: obs(110, 2_000),
    });
    expect(partial.partial).toBe(true);
    const afterPartial = await prisma.position.findUnique({ where: { id: position.id } });
    expect(afterPartial?.status).toBe("OPEN");
    expect(afterPartial?.quantity).toBeLessThan(1);
    expect(afterPartial?.quantity).toBeGreaterThan(0);
    const partialQty = 1 - (afterPartial?.quantity ?? 0);

    paperCloseMock.mockImplementation(async (args: { quantity: number }) => ({
      orderId: `paper-stop-${suffix}`,
      clientOrderId: `paper-stop-${suffix}`,
      symbol: "BTCTRY",
      side: "SELL",
      type: "MARKET",
      status: "FILLED",
      executedQty: args.quantity,
      price: 90,
      dryRun: true,
      fee: 0.05,
      metadata: {
        tradeId: `stop-trade-${suffix}`,
        simulationId: `stop-trade-${suffix}`,
        feeAsset: "QUOTE",
        filledAtMs: baseNow + 3_000,
      },
    }));

    const stop = await processFix02Pr04ExitTick({
      executionId,
      positionId: position.id,
      userId: user.id,
      side: "LONG",
      mode: "paper",
      observation: obs(90, 3_000),
    });
    expect(stop.closed).toBe(true);
    const closed = await prisma.position.findUnique({ where: { id: position.id } });
    expect(closed?.status).toBe("CLOSED");
    expect(closed?.quantity).toBe(0);
    const fills = await prisma.positionSettlementFill.findMany({ where: { positionId: position.id } });
    expect(fills).toHaveLength(2);
    expect(fills[0]?.executedQty).toBeCloseTo(partialQty, 8);
    const pnlRows = await prisma.profitLossRecord.findMany({ where: { positionId: position.id } });
    expect(pnlRows.length).toBeGreaterThanOrEqual(2);
    const orders = await prisma.tradeOrder.findMany({ where: { positionId: position.id, side: "SELL" } });
    expect(orders).toHaveLength(2);
    const exitBundle = await prisma.positionExitPersistedState.findUnique({ where: { positionId: position.id } });
    expect(exitBundle?.terminalStatus).toBe("CLOSED");
    const finalMeta = (closed?.metadata as Record<string, unknown>) ?? {};
    expect(Number(finalMeta.entryFeeAllocated ?? 0)).toBeCloseTo(1, 8);
  }, 60_000);
});
