import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/config";
import { startPositionMonitor, stopAllPositionMonitors } from "@/src/server/execution/position-monitor.service";

vi.mock("@/services/binance.service", () => ({
  getTicker: vi.fn(),
  getKlines: vi.fn(async () => []),
  getOrderBook: vi.fn(async () => ({ bids: [], asks: [] })),
}));

vi.mock("@/src/server/execution/execution-event-bus", () => ({
  publishExecutionEvent: vi.fn(),
}));

vi.mock("@/src/server/observability/trade-event-log", () => ({
  logTradeEvent: vi.fn(async () => null),
}));

vi.mock("@/src/server/notifications/notification.service", () => ({
  notifySystemEvent: vi.fn(async () => null),
}));

vi.mock("@/src/server/execution-engine-v2/exit-ai.gateway.service", () => ({
  evaluateExitForOpenPosition: vi.fn(async () => ({
    decision: "HOLD",
    exitConfidence: 0,
    profitProtectionScore: 0,
    analysisId: "n/a",
  })),
  shouldExecuteExit: vi.fn(() => false),
}));

vi.mock("@/src/server/ai/position-report.service", () => ({
  buildPositionReport: vi.fn(() => ({
    signal: "TUT",
    report: "hold",
    reason: "hold",
    satTrigger: null,
  })),
}));

vi.mock("@/src/server/execution/smart-exit-engine.service", () => ({
  evaluateSmartExitEngine: vi.fn(() => ({
    initialTp: 0,
    adaptiveTp: 0,
    trailingSuggestion: null,
    earlyExitTrigger: null,
    exitConfidence: 0,
    closeReason: null,
    exitSummary: "none",
  })),
}));

import { getTicker } from "@/services/binance.service";

describe("variant_d production feature flag precedence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T12:00:00.000Z"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopAllPositionMonitors();
    vi.useRealTimers();
  });

  const tickOnce = async () => {
    await vi.advanceTimersByTimeAsync(env.EXECUTION_MONITOR_INTERVAL_MS + 10);
    await Promise.resolve();
    await Promise.resolve();
  };

  function basePayload(input: {
    positionId: string;
    variantDEnabled: boolean;
    variantDShadowEnabled: boolean;
    openedAt: string;
    mode?: "paper" | "live";
  }) {
    const closeReasons: string[] = [];
    return {
      closeReasons,
      payload: {
        executionId: `exec-${input.positionId}`,
        userId: "user-1",
        positionId: input.positionId,
        tradeId: `trade-${input.positionId}`,
        roundId: "round-production-flag",
        symbol: "BTCTRY",
        side: "LONG" as const,
        openedAt: input.openedAt,
        entryPrice: 100,
        quantity: 1,
        takeProfitPrice: 105,
        stopLossPrice: 95,
        maxDurationSec: 30,
        mode: input.mode ?? ("live" as const),
        strategy: "MR_SCALP",
        regime: "RANGE",
        variantDEnabled: input.variantDEnabled,
        variantDShadowEnabled: input.variantDShadowEnabled,
        onDynamicExit: async () => "REVERSE_SIGNAL" as const,
        onClose: async ({ reason }: { reason: string }) => {
          closeReasons.push(reason);
          return { closed: true };
        },
      },
    };
  }

  it("keeps baseline precedence when variant_d disabled", async () => {
    const tickerMock = vi.mocked(getTicker);
    tickerMock.mockResolvedValueOnce({ price: 101 } as { price: number });

    const { payload, closeReasons } = basePayload({
      positionId: "baseline",
      variantDEnabled: false,
      variantDShadowEnabled: false,
      openedAt: new Date(Date.now() - 120_000).toISOString(),
    });
    startPositionMonitor(payload);
    await tickOnce();

    expect(closeReasons[0]).toBe("REVERSE_SIGNAL");
  });

  it("applies timeout precedence when variant_d enabled", async () => {
    const tickerMock = vi.mocked(getTicker);
    tickerMock.mockResolvedValueOnce({ price: 101 } as { price: number });

    const { payload, closeReasons } = basePayload({
      positionId: "variantd",
      variantDEnabled: true,
      variantDShadowEnabled: false,
      openedAt: new Date(Date.now() - 120_000).toISOString(),
    });
    startPositionMonitor(payload);
    await tickOnce();

    expect(closeReasons[0]).toBe("TIMEOUT");
  });

  it("shadow flag does not activate production variant_d", async () => {
    const tickerMock = vi.mocked(getTicker);
    tickerMock.mockResolvedValueOnce({ price: 101 } as { price: number });

    const { payload, closeReasons } = basePayload({
      positionId: "shadow-only",
      variantDEnabled: false,
      variantDShadowEnabled: true,
      openedAt: new Date(Date.now() - 120_000).toISOString(),
    });
    startPositionMonitor(payload);
    await tickOnce();

    expect(closeReasons[0]).toBe("REVERSE_SIGNAL");
  });
});

