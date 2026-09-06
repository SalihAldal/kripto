import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFix02DisposablePostgres, type Fix02DisposablePostgres } from "./helpers/fix02-disposable-postgres";

let disposable: Fix02DisposablePostgres | null = null;
let prisma: typeof import("@/src/server/db/prisma").prisma;

const paperCloseMock = vi.fn();
const getTickerMock = vi.fn();
const estimateFeesMock = vi.fn();
const getAccountBalancesMock = vi.fn();

vi.mock("@/services/binance.service", () => ({
  getTicker: getTickerMock,
  placeMarketSell: vi.fn(),
  placeMarketBuy: vi.fn(),
  placeMarketBuyEmergency: vi.fn(),
  placeMarketSellEmergency: vi.fn(),
  getOrderStatus: vi.fn(),
  getOrderStatusByClientOrderId: vi.fn(),
  estimateFees: estimateFeesMock,
  getAccountBalances: getAccountBalancesMock,
  getKlines: vi.fn().mockResolvedValue([]),
  getOrderBook: vi.fn().mockResolvedValue({ bids: [], asks: [] }),
}));

vi.mock("@/services/binance-global.service", () => ({
  getGlobalTicker: vi.fn(),
  placeGlobalMarketBuy: vi.fn(),
  placeGlobalMarketSell: vi.fn(),
  toGlobalLeverageSymbol: vi.fn((symbol: string) => symbol),
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

const baseNow = Date.parse("2026-09-06T10:00:00.000Z");

async function seedOpenPosition(input?: { quantity?: number; userSuffix?: string }) {
  const suffix = input?.userSuffix ?? crypto.randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: {
      email: `fix02-${suffix}@example.com`,
      username: `fix02_${suffix}`,
      passwordHash: "hash",
    },
  });
  const conn = await prisma.exchangeConnection.create({
    data: {
      userId: user.id,
      exchange: "BINANCE",
      name: "paper",
      apiKeyMasked: "x",
      apiSecretEncrypted: "y",
      isSandbox: true,
    },
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
      quantity: input?.quantity ?? 1,
      openedAt: new Date(baseNow),
      metadata: { mode: "paper", executionId: `exec-${suffix}` },
    },
  });
  return { user, conn, pair, position };
}

describe("FIX02 durable exit and settlement (PostgreSQL)", () => {
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
    getTickerMock.mockResolvedValue({ symbol: "BTCTRY", price: 112, change24h: 0, volume24h: 0 });
    estimateFeesMock.mockResolvedValue({ estimatedTakerFee: 0.1 });
    getAccountBalancesMock.mockResolvedValue([{ asset: "BTC", free: 10 }]);
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

  it("1-2 entry snapshot persists and restart reloads same snapshot", async () => {
    const { user, position } = await seedOpenPosition();
    const { buildExitPolicySnapshotAtEntry } = await import("@/src/server/profitability/pr04-exit-evaluator");
    const { bootstrapExitPersistenceAtEntry, loadPersistedExitBundle, restoreExitPolicyStateFromDb } = await import(
      "@/src/server/execution/fix02-exit-persistence.service"
    );
    const snapshot = buildExitPolicySnapshotAtEntry({
      positionId: position.id,
      strategyId: "BREAKOUT_RETEST",
      entryPolicyVersion: "pr03-v1",
      entrySignalId: "sig-1",
      setupId: "setup-1",
      experimentalMode: true,
      takeProfitPercent: 5,
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
      ownerExecutionId: "exec-1",
    });
    const bundle = await loadPersistedExitBundle(position.id);
    expect(bundle?.snapshot.setupId).toBe("setup-1");
    const { resetExitPolicyStoreForTests } = await import("@/src/server/profitability/pr04-exit-evaluator");
    resetExitPolicyStoreForTests();
    const restored = await restoreExitPolicyStateFromDb(position.id);
    expect(restored?.timeAnchorMs).toBe(bundle?.state.timeAnchorMs);
  });

  it("3 state version conflict does not silently drop update", async () => {
    const { user, position } = await seedOpenPosition();
    const { bootstrapExitPersistenceAtEntry, savePersistedExitState } = await import(
      "@/src/server/execution/fix02-exit-persistence.service"
    );
    const { buildExitPolicySnapshotAtEntry, getExitPolicyState } = await import(
      "@/src/server/profitability/pr04-exit-evaluator"
    );
    const snapshot = buildExitPolicySnapshotAtEntry({
      positionId: position.id,
      strategyId: "BREAKOUT_RETEST",
      entryPolicyVersion: "pr03-v1",
      entrySignalId: "sig-1",
      setupId: "setup-1",
      experimentalMode: true,
      takeProfitPercent: 5,
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
    });
    const state = getExitPolicyState(position.id)!;
    const bumped = { ...state, version: state.version + 1 };
    await savePersistedExitState({ positionId: position.id, expectedVersion: state.version, state: bumped });
    await expect(
      savePersistedExitState({ positionId: position.id, expectedVersion: state.version, state: bumped }),
    ).rejects.toThrow(/EXIT_STATE_VERSION_CONFLICT/);
  });

  it("5 shadow decision does not reserve sell quantity", async () => {
    const { position } = await seedOpenPosition();
    const { buildExitPolicySnapshotAtEntry, initializeExitPolicyState, getExitPolicyState } = await import(
      "@/src/server/profitability/pr04-exit-evaluator"
    );
    const { evaluatePr04ExitShadowTick } = await import("@/src/server/profitability/pr04-exit-bridge");
    const snapshot = buildExitPolicySnapshotAtEntry({
      positionId: position.id,
      strategyId: "BREAKOUT_RETEST",
      entryPolicyVersion: "pr03-v1",
      entrySignalId: "sig-1",
      setupId: "setup-1",
      experimentalMode: true,
      takeProfitPercent: 1,
      invalidation: null,
      boundAtMs: baseNow,
    });
    initializeExitPolicyState({
      snapshot,
      side: "LONG",
      entryFills: [{ price: 100, quantity: 1, fee: 0.1, atMs: baseNow }],
      entryFee: 0.1,
    });
    evaluatePr04ExitShadowTick({
      positionId: position.id,
      side: "LONG",
      markPrice: 102,
      eventAtMs: baseNow + 1000,
    });
    expect(getExitPolicyState(position.id)?.reservedSellQuantity).toBe(0);
  });

  it("6-10 PR04 partial/full routes through canonical settlement and keeps OPEN on partial", async () => {
    const { user, position } = await seedOpenPosition({ quantity: 1 });
    const { bootstrapExitPersistenceAtEntry } = await import("@/src/server/execution/fix02-exit-persistence.service");
    const { buildExitPolicySnapshotAtEntry } = await import("@/src/server/profitability/pr04-exit-evaluator");
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
      ownerExecutionId: "exec-route",
    });
    const partial = await processFix02Pr04ExitTick({
      executionId: "exec-route",
      positionId: position.id,
      userId: user.id,
      side: "LONG",
      mode: "paper",
      observation: {
        eventId: `evt-partial-${baseNow}`,
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
    expect(partial.partial || partial.handled).toBe(true);
    expect(afterPartial?.status).toBe("OPEN");
    expect((afterPartial?.quantity ?? 0) < 1).toBe(true);
  });

  it("11 duplicate fill id does not change accounting twice", async () => {
    const { applyPartialPositionClose } = await import("@/src/server/repositories/execution.repository");
    const { position } = await seedOpenPosition({ quantity: 1 });
    await applyPartialPositionClose({
      positionId: position.id,
      fillPrice: 110,
      filledQuantity: 0.4,
      realizedPnlDelta: 4,
      feeDelta: 0.1,
      settlementFillId: "fill-dup-1",
    });
    const first = await prisma.position.findUnique({ where: { id: position.id } });
    await applyPartialPositionClose({
      positionId: position.id,
      fillPrice: 110,
      filledQuantity: 0.4,
      realizedPnlDelta: 4,
      feeDelta: 0.1,
      settlementFillId: "fill-dup-1",
    });
    const second = await prisma.position.findUnique({ where: { id: position.id } });
    expect(second?.quantity).toBe(first?.quantity);
    expect(second?.realizedPnl).toBe(first?.realizedPnl);
  });

  it("28-29 wrong owner cannot release durable claim", async () => {
    const user = await prisma.user.create({
      data: {
        email: `claim-${crypto.randomUUID()}@example.com`,
        username: `claim_${crypto.randomUUID().slice(0, 8)}`,
        passwordHash: "hash",
      },
    });
    const { claimDurableCanonicalExecutionAttempt, releaseDurableCanonicalExecutionAttempt } = await import(
      "@/src/server/hot-path/execution-attempt-lock.service"
    );
    const claim = await claimDurableCanonicalExecutionAttempt({
      userId: user.id,
      candidateId: "BTC:1",
      executionId: "exec-owner",
      executionMode: "paper",
      venue: "BINANCE_TR",
    });
    expect(claim.ok).toBe(true);
    const release = await releaseDurableCanonicalExecutionAttempt({
      userId: user.id,
      candidateId: "BTC:1",
      executionId: "exec-other",
      executionMode: "paper",
      venue: "BINANCE_TR",
    });
    expect(release.ok).toBe(false);
  });

  it("31 DB connection error is not labeled duplicate", async () => {
    const { claimDurableCanonicalExecutionAttempt } = await import(
      "@/src/server/hot-path/execution-attempt-lock.service"
    );
    const originalCreate = prisma.appSetting.create;
    prisma.appSetting.create = vi.fn().mockRejectedValueOnce({ code: "P1001" }) as typeof prisma.appSetting.create;
    await expect(
      claimDurableCanonicalExecutionAttempt({
        userId: "user-db-nonexistent",
        candidateId: "ETH:1",
        executionId: "exec-db",
        executionMode: "paper",
        venue: "BINANCE_TR",
      }),
    ).rejects.toThrow(/EXECUTION_CLAIM_DB_UNAVAILABLE/);
    prisma.appSetting.create = originalCreate;
  });

  it("35 stale tick does not create settlement fill", async () => {
    const { user, position } = await seedOpenPosition();
    const { bootstrapExitPersistenceAtEntry } = await import("@/src/server/execution/fix02-exit-persistence.service");
    const { buildExitPolicySnapshotAtEntry } = await import("@/src/server/profitability/pr04-exit-evaluator");
    const { processFix02Pr04ExitTick } = await import("@/src/server/execution/fix02-exit-routing.service");
    const snapshot = buildExitPolicySnapshotAtEntry({
      positionId: position.id,
      strategyId: "BREAKOUT_RETEST",
      entryPolicyVersion: "pr03-v1",
      entrySignalId: "sig-1",
      setupId: "setup-1",
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
    });
    const routed = await processFix02Pr04ExitTick({
      executionId: "exec-stale",
      positionId: position.id,
      userId: user.id,
      side: "LONG",
      mode: "paper",
      observation: {
        eventId: "evt-stale",
        eventAtMs: baseNow + 1000,
        availableAtMs: baseNow + 1000,
        markPrice: null,
        bid: null,
        ask: null,
        high: null,
        low: null,
        closed: false,
        stale: true,
        dataGap: false,
      },
    });
    expect(routed.closed).toBe(false);
    expect(paperCloseMock).not.toHaveBeenCalled();
  });
});
