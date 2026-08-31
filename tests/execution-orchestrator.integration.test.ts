import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/repositories/execution.repository", () => ({
  getRuntimeExecutionContext: vi.fn().mockResolvedValue({
    user: { id: "u-1" },
    connection: { id: "conn-1" },
  }),
  getEmergencyStopState: vi.fn().mockResolvedValue(false),
  getSafeModeState: vi.fn().mockResolvedValue({ enabled: false }),
  persistAnalysisState: vi.fn().mockResolvedValue(undefined),
  getIdempotentExecution: vi.fn().mockResolvedValue(null),
  listOpenPositionsByUser: vi.fn().mockResolvedValue([
    {
      id: "pos-open-1",
      tradingPair: { symbol: "BTCTRY" },
      side: "BUY",
      openedAt: new Date("2026-01-01T00:00:00.000Z"),
      entryPrice: 100,
      metadata: {},
    },
  ]),
  getExecutionPolicySetting: vi.fn().mockResolvedValue({}),
  ensureTradingPair: vi.fn(),
  createTradeSignalFromConsensus: vi.fn(),
  createTradeOrder: vi.fn(),
  addTradeExecution: vi.fn(),
  createPosition: vi.fn(),
  attachOrderToPosition: vi.fn(),
  findTradeOrderById: vi.fn(),
  updateOrderStatus: vi.fn(),
  getPositionById: vi.fn(),
  updatePositionMarkPrice: vi.fn(),
  setEmergencyStopState: vi.fn(),
}));

vi.mock("@/src/server/execution/position-monitor.service", () => ({
  startPositionMonitor: vi.fn(),
  stopPositionMonitor: vi.fn(),
  stopAllPositionMonitors: vi.fn(),
  isPositionMonitorActive: vi.fn().mockReturnValue(false),
}));

vi.mock("@/src/server/execution/post-trade-settlement.service", () => ({
  settleOpenPosition: vi.fn().mockResolvedValue({ closed: true }),
  syncUnrealizedPnl: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/src/server/scanner", () => ({
  getScannerWorkerSnapshot: vi.fn().mockReturnValue({ detailed: null, updatedAt: null }),
  pauseScannerWorker: vi.fn(),
  pauseScannerWorkerUntilResume: vi.fn(),
  resumeScannerWorker: vi.fn(),
  runScannerPipeline: vi.fn(),
}));

vi.mock("@/src/server/execution/execution-event-bus", () => ({
  publishExecutionEvent: vi.fn(),
}));

vi.mock("@/src/server/observability/trade-lifecycle", () => ({
  logTradeLifecycle: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/src/server/risk", () => ({
  evaluatePreTradeRisk: vi.fn(),
  evaluateRuntimeRisk: vi.fn().mockResolvedValue({ shouldClose: false }),
  getEffectiveRiskConfig: vi.fn(),
  pauseSystemByRisk: vi.fn(),
  registerApiFailure: vi.fn(),
  resetApiFailure: vi.fn(),
  resumeSystem: vi.fn(),
}));

vi.mock("@/src/server/risk/canonical-risk-decision.service", () => ({
  evaluateCanonicalRiskDecision: vi.fn().mockResolvedValue({
    verdict: "ALLOW",
    reasonCodes: [],
    reasons: [],
    metrics: {},
    timestamp: new Date().toISOString(),
  }),
}));

describe("execution orchestrator integration", () => {
  it("acik pozisyon varken yeni islem acmayi engeller", async () => {
    const { executeAnalyzeAndTrade } = await import("../src/server/execution/execution-orchestrator.service");
    const result = await executeAnalyzeAndTrade({});
    expect(result.opened).toBe(false);
    expect(result.rejected).toBe(true);
    expect(String(result.rejectReason)).toContain("Açık pozisyon");
  }, 15_000);
});
