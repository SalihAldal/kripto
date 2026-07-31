import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const getTickerMock = vi.fn();
const getKlinesMock = vi.fn();
const getOrderBookMock = vi.fn();
const runAIConsensusMock = vi.fn();
const openTradeMock = vi.fn();
const writeIdempotentResponseMock = vi.fn();
const readIdempotentResponseMock = vi.fn();
const releaseLockMock = vi.fn();
const addAuditLogMock = vi.fn().mockResolvedValue(undefined);
const writeStructuredLogMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/services/binance.service", () => ({
  getTicker: getTickerMock,
  getKlines: getKlinesMock,
  getOrderBook: getOrderBookMock,
}));

vi.mock("@/src/server/ai", () => ({
  runAIConsensus: runAIConsensusMock,
}));

vi.mock("@/lib/auth", () => ({
  checkApiToken: () => true,
}));

vi.mock("@/lib/request-locale", () => ({
  getRequestLocale: () => "tr",
}));

vi.mock("@/services/trading-engine.service", () => ({
  openTrade: openTradeMock,
}));

vi.mock("@/src/server/security/request-security", () => ({
  secureRoute: vi.fn().mockResolvedValue({ ok: true, user: { id: "user-heavy", role: "TRADER" } }),
  sanitizePayload: (payload: unknown) => payload,
}));

vi.mock("@/src/server/security/idempotency", () => ({
  getIdempotencyKey: (headers: Headers) => headers.get("idempotency-key") ?? headers.get("x-idempotency-key"),
  readIdempotentResponse: readIdempotentResponseMock,
  writeIdempotentResponse: writeIdempotentResponseMock,
  acquireUserActionLock: vi.fn().mockResolvedValue(releaseLockMock),
}));

vi.mock("@/src/server/repositories/audit.repository", () => ({
  addAuditLog: addAuditLogMock,
}));

vi.mock("@/src/server/observability/structured-log", () => ({
  writeStructuredLog: writeStructuredLogMock,
}));

function dailyCandles(count: number) {
  const dayMs = 86_400_000;
  const start = Date.UTC(2026, 0, 1);
  return Array.from({ length: count }, (_, index) => {
    const open = 100 + index * 0.7;
    return {
      openTime: start + index * dayMs,
      closeTime: start + (index + 1) * dayMs - 1,
      open,
      high: open * 1.03,
      low: open * 0.98,
      close: open * 1.01,
      volume: 1000 + index * 5,
    };
  });
}

describe("intensive trading system smoke", () => {
  it("API veri cekme: ticker, orderbook ve 1d gunluk grafik okur", async () => {
    getTickerMock.mockResolvedValueOnce({ symbol: "BTCTRY", price: 3_200_000, change24h: 1.8, volume24h: 950_000_000 });
    getOrderBookMock.mockResolvedValueOnce({
      lastUpdateId: 10,
      bids: [{ price: 3_199_000, quantity: 0.8 }],
      asks: [{ price: 3_201_000, quantity: 0.7 }],
    });
    getKlinesMock.mockResolvedValueOnce(dailyCandles(365));

    const tickerRoute = await import("../app/api/exchange/ticker/route");
    const orderBookRoute = await import("../app/api/exchange/orderbook/route");
    const klinesRoute = await import("../app/api/exchange/klines/route");

    const tickerRes = await tickerRoute.GET(new NextRequest("http://localhost/api/exchange/ticker?symbol=btctry"));
    const orderBookRes = await orderBookRoute.GET(new NextRequest("http://localhost/api/exchange/orderbook?symbol=BTCTRY&limit=10"));
    const klinesRes = await klinesRoute.GET(new NextRequest("http://localhost/api/exchange/klines?symbol=BTCTRY&interval=1d&limit=365"));

    const ticker = await tickerRes.json();
    const orderBook = await orderBookRes.json();
    const klines = await klinesRes.json();

    expect(ticker.ok).toBe(true);
    expect(ticker.data.symbol).toBe("BTCTRY");
    expect(orderBook.data.bids).toHaveLength(1);
    expect(klines.data).toHaveLength(365);
    expect(klines.data[0].closeTime).toBeGreaterThan(klines.data[0].openTime);
    expect(getKlinesMock).toHaveBeenCalledWith("BTCTRY", "1d", 365);
  });

  it("yapay zeka consensus API calisir ve BUY karari dondurur", async () => {
    runAIConsensusMock.mockResolvedValueOnce({
      finalDecision: "BUY",
      finalConsensusDecision: "BUY",
      finalConfidence: 91,
      finalRiskScore: 18,
      score: 84,
      rejected: false,
      explanation: "Strong multi-timeframe confirmation",
      outputs: [],
      roleScores: [],
      generatedAt: new Date().toISOString(),
      decisionPayload: { openTrade: true, coin: "BTCTRY" },
    });

    const { POST } = await import("../app/api/ai/consensus/route");
    const res = await POST(new NextRequest("http://localhost/api/ai/consensus", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify({ symbol: "btctry", strategyParams: { tradeQualityScore: 90 } }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.finalDecision).toBe("BUY");
    expect(json.data.decisionPayload.openTrade).toBe(true);
    expect(runAIConsensusMock).toHaveBeenCalledWith("BTCTRY", { tradeQualityScore: 90 }, undefined);
  });

  it("alim satim endpointi idempotency, lock ve audit ile emir acma sonucunu dondurur", async () => {
    readIdempotentResponseMock.mockResolvedValueOnce(null);
    openTradeMock.mockResolvedValueOnce({
      executionId: "exec-heavy-1",
      mode: "paper",
      opened: true,
      rejected: false,
      symbol: "BTCTRY",
      decision: "BUY",
      orderId: "order-heavy-1",
      positionId: "pos-heavy-1",
    });

    const { POST } = await import("../app/api/trades/open/route");
    const res = await POST(new NextRequest("http://localhost/api/trades/open", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "heavy-open-1",
      },
      body: JSON.stringify({
        symbol: "BTCTRY",
        quantity: 0.001,
        orderType: "MARKET",
        takeProfitPercent: 1.2,
        stopLossPercent: 0.8,
      }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.opened).toBe(true);
    expect(openTradeMock).toHaveBeenCalledWith({
      symbol: "BTCTRY",
      quantity: 0.001,
      orderType: "MARKET",
      takeProfitPercent: 1.2,
      stopLossPercent: 0.8,
    });
    expect(releaseLockMock).toHaveBeenCalled();
    expect(addAuditLogMock).toHaveBeenCalled();
    expect(writeStructuredLogMock).toHaveBeenCalled();
    expect(writeIdempotentResponseMock).toHaveBeenCalledWith("user-heavy", "manual-open", "heavy-open-1", expect.objectContaining({ opened: true }));
  });
});
