import { describe, expect, it } from "vitest";
import {
  aggregateExecutionKpis,
  buildExecutionTelemetry,
  classifyFillStatus,
  evaluatePreSubmitExecution,
  resolveAdaptiveRetryPolicy,
  simulateLabExecutionQuality,
} from "../src/server/execution/execution-intelligence.service";

describe("execution intelligence", () => {
  it("classifies fill lifecycle states from order evidence", () => {
    expect(classifyFillStatus({ orderStatus: "FILLED", requestedQty: 1, filledQty: 1 })).toBe("FULL_FILL");
    expect(classifyFillStatus({ orderStatus: "PARTIALLY_FILLED", requestedQty: 1, filledQty: 0.5 })).toBe(
      "PARTIAL_FILL",
    );
    expect(classifyFillStatus({ orderStatus: "CANCELED", requestedQty: 1, filledQty: 0 })).toBe("CANCELLED");
    expect(classifyFillStatus({ orderStatus: "REJECTED", requestedQty: 1, filledQty: 0 })).toBe("REJECTED");
  });

  it("blocks pre-submit execution when depth is insufficient", () => {
    const blocked = evaluatePreSubmitExecution({
      side: "BUY",
      notional: 5000,
      bidDepth: 1000,
      askDepth: 800,
      spreadPercent: 0.12,
      liquidityScore: 40,
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toMatch(/depth|slippage/i);
  });

  it("builds complete execution telemetry with slippage and latency", () => {
    const telemetry = buildExecutionTelemetry({
      executionId: "exec_1",
      symbol: "BTCTRY",
      side: "BUY",
      decisionTimestamp: "2026-08-01T00:00:00.000Z",
      orderTimestamp: "2026-08-01T00:00:01.000Z",
      fillTimestamp: "2026-08-01T00:00:01.450Z",
      expectedPrice: 100,
      fillPrice: 100.12,
      spreadPercent: 0.08,
      requestedQty: 0.01,
      filledQty: 0.01,
      orderStatus: "FILLED",
      orderType: "MARKET",
    });
    expect(telemetry.slippagePct).toBeGreaterThan(0);
    expect(telemetry.fillTimeMs).toBe(450);
    expect(telemetry.fillStatus).toBe("FULL_FILL");
    expect(telemetry.qualityScore).toBeGreaterThan(0);
  });

  it("uses adaptive retry policy for transient exchange errors", () => {
    const policy = resolveAdaptiveRetryPolicy({
      errorMessage: "HTTP 429 too many requests",
      attempt: 0,
      marketRegime: "HIGH_VOLATILITY_CHAOS",
    });
    expect(policy.shouldRetry).toBe(true);
    expect(policy.maxAttempts).toBeGreaterThanOrEqual(2);
    expect(policy.backoffMs).toBeGreaterThanOrEqual(900);
  });

  it("aggregates execution KPIs across telemetry rows", () => {
    const rows = [
      buildExecutionTelemetry({
        executionId: "a",
        symbol: "BTCTRY",
        side: "BUY",
        decisionTimestamp: Date.now() - 2000,
        orderTimestamp: Date.now() - 1500,
        fillTimestamp: Date.now() - 1000,
        expectedPrice: 100,
        fillPrice: 100.05,
        requestedQty: 1,
        filledQty: 1,
        orderStatus: "FILLED",
      }),
      buildExecutionTelemetry({
        executionId: "b",
        symbol: "ETHTRY",
        side: "BUY",
        decisionTimestamp: Date.now() - 2000,
        orderTimestamp: Date.now() - 1500,
        fillTimestamp: Date.now() - 900,
        expectedPrice: 100,
        fillPrice: 100.2,
        requestedQty: 1,
        filledQty: 1,
        orderStatus: "FILLED",
      }),
    ];
    const kpis = aggregateExecutionKpis(rows, new Map([
      ["a", 5],
      ["b", -2],
    ]));
    expect(kpis.executionCount).toBe(2);
    expect(kpis.successRate).toBe(100);
    expect(kpis.averageSlippagePct).toBeGreaterThan(0);
    expect(kpis.profitFactor).toBeGreaterThan(0);
  });

  it("simulates lab execution quality with regime-aware latency", () => {
    const telemetry = simulateLabExecutionQuality({
      side: "BUY",
      entryPrice: 1000,
      positionSize: 500,
      spreadPercent: 0.1,
      bidDepth: 50_000,
      askDepth: 45_000,
      marketRegime: "volatile",
    });
    expect(telemetry.fillPrice).toBeGreaterThan(1000);
    expect(telemetry.decisionToOrderMs).toBeGreaterThan(0);
    expect(telemetry.metadata?.source).toBe("simulation-lab");
  });
});
