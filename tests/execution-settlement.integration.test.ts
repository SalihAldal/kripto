import { beforeEach, describe, expect, it, vi } from "vitest";

const getPositionByIdMock = vi.fn();
const findLatestPendingCloseOrderMock = vi.fn();
const getTickerMock = vi.fn();
const placeMarketSellMock = vi.fn();
const getOrderStatusMock = vi.fn();
const createTradeOrderMock = vi.fn();
const addTradeExecutionMock = vi.fn();
const closePositionRecordMock = vi.fn();
const createPnlRecordMock = vi.fn();
const estimateFeesMock = vi.fn();
const getAccountBalancesMock = vi.fn();

vi.mock("@/services/binance.service", () => ({
  getTicker: getTickerMock,
  placeMarketSell: placeMarketSellMock,
  placeMarketBuy: vi.fn(),
  placeMarketBuyEmergency: vi.fn(),
  placeMarketSellEmergency: vi.fn(),
  getOrderStatus: getOrderStatusMock,
  estimateFees: estimateFeesMock,
  getAccountBalances: getAccountBalancesMock,
}));

vi.mock("@/services/binance-global.service", () => ({
  getGlobalTicker: vi.fn(),
  placeGlobalMarketBuy: vi.fn(),
  placeGlobalMarketSell: vi.fn(),
}));

vi.mock("@/src/server/repositories/execution.repository", () => ({
  getPositionById: getPositionByIdMock,
  findLatestPendingCloseOrder: findLatestPendingCloseOrderMock,
  createTradeOrder: createTradeOrderMock,
  addTradeExecution: addTradeExecutionMock,
  closePositionRecord: closePositionRecordMock,
  createPnlRecord: createPnlRecordMock,
  updateOrderStatus: vi.fn(),
  findTradeOrderById: vi.fn(),
}));

vi.mock("@/src/server/repositories/log.repository", () => ({
  addSystemLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/src/server/repositories/risk.repository", () => ({
  getConsecutiveLossCount: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/src/server/risk", () => ({
  getEffectiveRiskConfig: vi.fn().mockResolvedValue({ consecutiveLossBreaker: 3 }),
}));

vi.mock("@/src/server/execution/execution-event-bus", () => ({
  publishExecutionEvent: vi.fn(),
}));

vi.mock("@/src/server/scanner/scanner-worker.service", () => ({
  resumeScannerWorker: vi.fn(),
}));

describe("settlement integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPositionByIdMock.mockResolvedValue({
      id: "pos-1",
      userId: "u-1",
      status: "OPEN",
      side: "LONG",
      quantity: 1.2,
      entryPrice: 100,
      feeTotal: 0.2,
      tradingPairId: "pair-1",
      exchangeConnectionId: "conn-1",
      tradingPair: { symbol: "BTCTRY", baseAsset: "BTC", quoteAsset: "TRY" },
      metadata: {},
    });
    getTickerMock.mockResolvedValue({ symbol: "BTCTRY", price: 112, change24h: 0, volume24h: 0 });
    estimateFeesMock.mockResolvedValue({ estimatedTakerFee: 0.3 });
    getAccountBalancesMock.mockResolvedValue([{ asset: "BTC", free: 2 }]);
    createTradeOrderMock.mockResolvedValue({ id: "close-order-1" });
    addTradeExecutionMock.mockResolvedValue({});
    closePositionRecordMock.mockResolvedValue({});
    createPnlRecordMock.mockResolvedValue({});
    findLatestPendingCloseOrderMock.mockResolvedValue(null);
  });

  it("duplicate close order varsa yeni satis gondermez", async () => {
    findLatestPendingCloseOrderMock.mockResolvedValueOnce({
      id: "pending-1",
      exchangeOrderId: "ex-1",
      status: "NEW",
    });
    const { settleOpenPosition } = await import("../src/server/execution/post-trade-settlement.service");
    const result = await settleOpenPosition({
      executionId: "exec-1",
      positionId: "pos-1",
      reason: "MANUAL_CLOSE",
      mode: "live",
    });
    expect(result.closed).toBe(false);
    expect(result.reason).toContain("Pending close order exists");
    expect(placeMarketSellMock).not.toHaveBeenCalled();
  });

  it("satis emri fill olmazsa pending close kaydi acilir", async () => {
    placeMarketSellMock.mockResolvedValueOnce({
      orderId: "ex-close-1",
      clientOrderId: "client-1",
      symbol: "BTCTRY",
      side: "SELL",
      type: "MARKET",
      status: "NEW",
      executedQty: 0,
      price: 112,
      dryRun: false,
    });
    getOrderStatusMock.mockResolvedValue({
      status: "NEW",
      executedQty: 0,
    });
    const { settleOpenPosition } = await import("../src/server/execution/post-trade-settlement.service");
    const result = await settleOpenPosition({
      executionId: "exec-2",
      positionId: "pos-1",
      reason: "TAKE_PROFIT",
      mode: "dry-run",
    });
    expect(result.closed).toBe(false);
    expect(result.reason).toContain("pending fill");
    expect(createTradeOrderMock).toHaveBeenCalled();
  });

  it("satis emri dolarsa pozisyonu kapatir ve pnl kaydi olusturur", async () => {
    placeMarketSellMock.mockResolvedValueOnce({
      orderId: "ex-close-2",
      clientOrderId: "client-2",
      symbol: "BTCTRY",
      side: "SELL",
      type: "MARKET",
      status: "FILLED",
      executedQty: 1.2,
      price: 112,
      dryRun: false,
    });
    const { settleOpenPosition } = await import("../src/server/execution/post-trade-settlement.service");
    const result = await settleOpenPosition({
      executionId: "exec-3",
      positionId: "pos-1",
      reason: "TAKE_PROFIT",
      mode: "live",
    });
    expect(result.closed).toBe(true);
    expect(closePositionRecordMock).toHaveBeenCalled();
    expect(createPnlRecordMock).toHaveBeenCalled();
  });

  it("kismi dolum qty ile kapanis kaydini olusturur", async () => {
    placeMarketSellMock.mockResolvedValueOnce({
      orderId: "ex-close-3",
      clientOrderId: "client-3",
      symbol: "BTCTRY",
      side: "SELL",
      type: "MARKET",
      status: "FILLED",
      executedQty: 0.6,
      price: 112,
      dryRun: false,
    });
    const { settleOpenPosition } = await import("../src/server/execution/post-trade-settlement.service");
    const result = await settleOpenPosition({
      executionId: "exec-5",
      positionId: "pos-1",
      reason: "TAKE_PROFIT",
      mode: "live",
    });
    expect(result.closed).toBe(true);
    expect(result.pnl.netPnl).toBeTypeOf("number");
  });

  it("api timeout hatasinda kapanis basarisiz doner", async () => {
    placeMarketSellMock.mockRejectedValueOnce(new Error("api timeout"));
    const { settleOpenPosition } = await import("../src/server/execution/post-trade-settlement.service");
    const result = await settleOpenPosition({
      executionId: "exec-6",
      positionId: "pos-1",
      reason: "MANUAL_CLOSE",
      mode: "live",
    });
    expect(result.closed).toBe(false);
    expect(result.reason).toContain("Close order failed");
  });

  it("bakiye yetersiz hatasinda balance mismatch close uygular", async () => {
    placeMarketSellMock.mockRejectedValueOnce(new Error("insufficient balance code=2202"));
    getAccountBalancesMock.mockResolvedValueOnce([{ asset: "BTC", free: 0 }]);
    const { settleOpenPosition } = await import("../src/server/execution/post-trade-settlement.service");
    const result = await settleOpenPosition({
      executionId: "exec-4",
      positionId: "pos-1",
      reason: "MANUAL_CLOSE",
      mode: "live",
    });
    expect(result.closed).toBe(true);
    expect(result.pnl.netPnl).toBe(0);
  });
});
