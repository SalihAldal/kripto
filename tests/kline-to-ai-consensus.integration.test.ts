import { executionMarketFixture } from "./helpers/execution-market-fixture";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { runAIConsensusFromInput } from "@/src/server/ai/analysis-orchestrator";
import { formatAIRequest } from "@/src/server/scanner/ai-request-formatter";
import type { AIAnalysisInput } from "@/src/types/ai";
import type { KlineItem } from "@/src/types/exchange";
import type { MarketContext } from "@/src/types/scanner";

function freshKlines(count = 25): KlineItem[] {
  const now = Date.now();
  return Array.from({ length: count }).map((_, i) => ({
    open: 1,
    high: 1.01,
    low: 0.99,
    close: 1,
    volume: 100,
    openTime: now - (count - i) * 60_000,
    closeTime: now - (count - i - 1) * 60_000 - 30_000,
  }));
}

function mockLaneOutput(lane: string, decision: "BUY" | "NO_TRADE" = "BUY") {
  return {
    decision: lane === "risk" ? ("HOLD" as const) : decision,
    confidence: 74,
    riskScore: 34,
    targetPrice: 1.06,
    stopPrice: 0.94,
    estimatedDurationSec: 180,
    reasoningShort: `${lane} mock ok`,
    metadata: { remote: true, remoteCoverage: 1, providerLane: lane },
  };
}

vi.mock("@/src/server/ai/provider-factory", () => ({
  createProviderAdapter: vi.fn(),
}));

vi.mock("@/src/server/market-data/market-data-gateway", () => ({
  marketDataGateway: {
    getKlines: vi.fn(),
    getOrderBook: vi.fn(() =>
      Promise.resolve({
        lastUpdateId: 1,
        bids: [{ price: 1, quantity: 1000 }],
        asks: [{ price: 1.001, quantity: 1000 }],
      }),
    ),
    getRecentTrades: vi.fn(() =>
      Promise.resolve([{ id: 1, price: 1, qty: 10, quoteQty: 10, time: Date.now(), isBuyerMaker: false }]),
    ),
  },
}));

vi.mock("@/src/server/market-data/spine/market-data-daemon", () => ({
  getMarketDataDaemon: vi.fn(() => ({
    subscribeDeep: vi.fn(),
  })),
}));

vi.mock("@/src/server/scanner/market-snapshot-cache", () => ({
  getMarketSnapshot: vi.fn(() => null),
  putMarketSnapshot: vi.fn(),
}));

vi.mock("@/src/server/repositories/execution.repository", () => ({
  getRuntimeExecutionContext: vi.fn(() => Promise.resolve({ user: { id: "kline-ai-test-user" } })),
}));

vi.mock("@/src/server/resilience/circuit-breaker", () => ({
  withCircuitBreaker: (_key: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("@/src/server/decision-engine/master-decision-engine.service", () => ({
  adjudicateWithMasterDecisionEngine: vi.fn(({ legacyResult }: { legacyResult: unknown }) =>
    Promise.resolve(legacyResult),
  ),
}));

vi.mock("@/src/server/learning-engine/learning-engine.repository", () => ({
  listConfidenceCalibration: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@/src/server/ai/ai-performance.service", () => ({
  applyAiPerformanceWeights: vi.fn((_userId: string, rows: unknown[]) => Promise.resolve(rows)),
  ensureAiPerformanceEvaluator: vi.fn(),
  recordAiPerformancePrediction: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/src/server/ai/ai-analysis-memory.service", () => ({
  getAIAnalysisMemoryContext: vi.fn(() => Promise.resolve(undefined)),
  adjustConfidenceWithAnalysisMemory: vi.fn((value: number) => value),
  recordAIAnalysisPrediction: vi.fn(() => Promise.resolve()),
}));

const tradeEvents: Array<{ eventType: string; newValue?: unknown; reason?: string | null }> = [];
vi.mock("@/src/server/observability/trade-event-log", () => ({
  logTradeEvent: vi.fn((payload: { eventType: string; newValue?: unknown; reason?: string | null }) => {
    tradeEvents.push(payload);
    return Promise.resolve();
  }),
}));

vi.mock("@/src/server/forensics/forensic-bridge.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/server/forensics/forensic-bridge.service")>();
  return {
    ...actual,
    bridgeAiProviderResult: vi.fn(),
    bridgeConsensusResult: vi.fn(),
    bridgeHybridEv: vi.fn(),
  };
});

vi.mock("@/src/server/forensics/ai-runtime.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/server/forensics/ai-runtime.service")>();
  return {
    ...actual,
    recordConsensusAudit: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    decisionTimelineEvent: { createMany: vi.fn(() => Promise.resolve({ count: 0 })) },
  },
}));

vi.mock("@/src/server/repositories/decision-log.repository", () => ({
  appendDecisionTimelineEvents: vi.fn(() => Promise.resolve()),
  upsertDecisionLogRecord: vi.fn(() => Promise.resolve(null)),
}));

function freshAiInput(symbol: string, overrides?: Partial<AIAnalysisInput>): AIAnalysisInput {
  return {
    symbol,
    lastPrice: 1.05,
    klines: freshKlines(),
    volume24h: 2_500_000,
    orderBookSummary: { bestBid: 1.04, bestAsk: 1.06, bidDepth: 120_000, askDepth: 110_000 },
    recentTradesSummary: { buyVolume: 50_000, sellVolume: 45_000, buySellRatio: 1.1 },
    spread: 0.02,
    volatility: 1.2,
    marketSignals: {
      change24h: 1.8,
      shortMomentumPercent: 0.35,
      shortFlowImbalance: 0.12,
      tradeVelocity: 1.4,
    },
    multiTimeframe: {
      entry: {
        m1: { direction: "BULLISH", strength: 62, slopePercent: 0.3, lastClose: 1.05 },
        m5: { direction: "BULLISH", strength: 64, slopePercent: 0.4, lastClose: 1.04 },
      },
      trend: {
        m15: { direction: "BULLISH", strength: 70, slopePercent: 1.1, lastClose: 1.03 },
        h1: { direction: "BULLISH", strength: 72, slopePercent: 2.0, lastClose: 1.02 },
      },
      macro: {
        h4: { direction: "BULLISH", strength: 75, slopePercent: 3.2, lastClose: 1.0 },
        d1: { direction: "BULLISH", strength: 78, slopePercent: 4.5, lastClose: 0.98 },
      },
      dominantTrend: "BULLISH",
      conflict: false,
      trendAligned: true,
      entrySuitable: true,
      reason: "MTF aligned",
    },
    ...overrides,
  };
}

describe("kline to AI consensus integration", () => {
  beforeEach(async () => {
    tradeEvents.length = 0;
    const { createProviderAdapter } = await import("@/src/server/ai/provider-factory");
    vi.mocked(createProviderAdapter).mockImplementation(() => ({
      config: { id: "provider-1", name: "Provider 1", model: "test-model", timeoutMs: 5000 },
      analyzeTechnicalSignal: vi.fn(() => Promise.resolve(mockLaneOutput("technical", "BUY"))),
      analyzeMomentumSignal: vi.fn(() => Promise.resolve(mockLaneOutput("momentum", "BUY"))),
      analyzeRiskAssessment: vi.fn(() => Promise.resolve(mockLaneOutput("risk", "NO_TRADE"))),
    }));
  });

  it("CASE A: fresh kline reaches provider loop and produces outputs", async () => {
    const result = await runAIConsensusFromInput(freshAiInput("ONDOUSDT"));
    expect(result.outputs.length).toBeGreaterThan(0);
    expect(result.explanation).not.toContain("Kline data missing or stale");
    expect(result.finalRiskScore).not.toBe(100);
    const analysisResult = tradeEvents.find((row) => row.eventType === "AI_ANALYSIS_RESULT");
    expect(analysisResult?.newValue).toMatchObject({
      providerAttemptCount: 3,
      outputsCount: expect.any(Number),
    });
  });

  it("CASE B: stale cache refresh then provider consensus via formatAIRequest", async () => {
    const { marketDataGateway } = await import("@/src/server/market-data/market-data-gateway");
    const { getMarketSnapshot } = await import("@/src/server/scanner/market-snapshot-cache");
    vi.mocked(getMarketSnapshot).mockReturnValue({
      klines: freshKlines(25).map((row) => ({
        ...row,
        closeTime: Date.now() - 240_000,
      })),
      orderBook: {
        lastUpdateId: 1,
        bids: [{ price: 1, quantity: 100 }],
        asks: [{ price: 1.001, quantity: 100 }],
      },
      recentTrades: [{ id: 1, price: 1, qty: 1, quoteQty: 1, time: Date.now(), isBuyerMaker: false }],
      updatedAt: Date.now(),
    });
    vi.mocked(marketDataGateway.getKlines)
      .mockRejectedValueOnce(new Error("not ready"))
      .mockResolvedValueOnce(freshKlines(25));

    const context: MarketContext = {
      symbol: "ARBTRY",
      lastPrice: 1,
      change24h: 1,
      volume24h: 1_000_000,
      volumeSpikePercent: 0,
      spreadPercent: 0.02,
      volatilityPercent: 0.3,
      momentumPercent: 0.2,
      orderBookImbalance: 0,
      buyPressure: 0,
      shortCandleSignal: 0,
      fakeSpikeScore: 0,
      pumpIntensity: 0,
      pumpRisk: 0,
      tradable: true,
      rejectReasons: [],
      metadata: { venue: "BINANCE_TR" },
    };

    const aiInput = await formatAIRequest(context);
    expect(aiInput.klines.length).toBeGreaterThanOrEqual(20);
    const klineInputEvent = tradeEvents.find((row) => row.eventType === "AI_KLINE_INPUT");
    expect(klineInputEvent?.newValue).toMatchObject({
      symbol: "ARBTRY",
      fresh: true,
      refreshAttempted: true,
    });

    const consensus = await runAIConsensusFromInput(aiInput as AIAnalysisInput);
    expect(consensus.outputs.length).toBeGreaterThan(0);
    expect(consensus.explanation).not.toContain("Kline data missing or stale");
  });

  it("19 klines blocks provider path with structured stale reason", async () => {
    const result = await runAIConsensusFromInput(freshAiInput("EPICUSDT", { klines: freshKlines(19) }));
    expect(result.outputs).toHaveLength(0);
    expect(result.finalRiskScore).toBe(100);
    expect(result.rejectReason).toContain("KLINE_COUNT_INSUFFICIENT");
    const staleEvent = tradeEvents.find((row) => row.eventType === "AI_KLINE_STALE");
    expect(staleEvent?.newValue).toMatchObject({ reasonCode: "KLINE_COUNT_INSUFFICIENT" });
  });
});

it("dedicated execution input uses actual multi-timeframe history and never substitutes RAM data", async () => {
  const { marketDataGateway } = await import("@/src/server/market-data/market-data-gateway");
  const { getMarketSnapshot } = await import("@/src/server/scanner/market-snapshot-cache");
  vi.mocked(marketDataGateway.getKlines).mockClear(); vi.mocked(getMarketSnapshot).mockClear();
  const snapshot = executionMarketFixture("BTCTRY");
  for (const rows of Object.values(snapshot.timeframes)) rows.forEach((row, i) => { row.close = 100 + i * .2; });
  const context = { symbol: "BTCTRY", lastPrice: 100, change24h: 0, volume24h: 10000000, metadata: { venue: "BINANCE_TR" }, rejectReasons: [] } as unknown as MarketContext;
  const input = await formatAIRequest(context, undefined, undefined, snapshot);
  expect(input.klines).toEqual(snapshot.bundle.klines1m);
  expect(input.multiTimeframe?.dominantTrend).toBe("BULLISH");
  expect(marketDataGateway.getKlines).not.toHaveBeenCalled(); expect(getMarketSnapshot).not.toHaveBeenCalled();
});
