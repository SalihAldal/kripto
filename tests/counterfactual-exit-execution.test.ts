import { describe, expect, it } from "vitest";
import {
  censorOpenCounterfactualPosition,
  planCounterfactualExitTick,
} from "@/src/server/profitability/counterfactual-exit-execution";
import type { ExitTickObservation } from "@/src/server/profitability/pr04-types";

const baseNow = Date.parse("2026-09-06T10:00:00.000Z");

function obs(mark: number, offset = 0, availableOffset = offset): ExitTickObservation {
  const t = baseNow + offset;
  return {
    eventId: `evt:${t}:${mark}`,
    eventAtMs: t,
    availableAtMs: baseNow + availableOffset,
    markPrice: mark,
    bid: mark,
    ask: mark,
    high: mark,
    low: mark,
    closed: true,
    stale: false,
    dataGap: false,
  };
}

describe("Counterfactual exit execution model", () => {
  it("actionable exit yoksa fill üretmez", () => {
    const result = planCounterfactualExitTick({
      observation: obs(100, 0),
      decisionKind: "NONE",
      closeQuantity: null,
      partialLegId: null,
      quotePrice: 100,
      latencyMs: 0,
      feeRate: 0.001,
      feeAsset: "QUOTE",
      openOrder: null,
    });
    expect(result.fill).toBeNull();
  });

  it("latency dolmadan fill üretmez, sonrasında stop order üzerinden fill olur", () => {
    const opened = planCounterfactualExitTick({
      observation: obs(100, 0),
      decisionKind: "STRUCTURAL_STOP",
      closeQuantity: 1,
      partialLegId: null,
      quotePrice: 99,
      latencyMs: 2_000,
      feeRate: 0.001,
      feeAsset: "QUOTE",
      openOrder: null,
    });
    expect(opened.fill).toBeNull();
    const early = planCounterfactualExitTick({
      observation: obs(99, 1_000),
      decisionKind: "NONE",
      closeQuantity: null,
      partialLegId: null,
      quotePrice: 99,
      latencyMs: 2_000,
      feeRate: 0.001,
      feeAsset: "QUOTE",
      openOrder: opened.openOrder,
    });
    expect(early.fill).toBeNull();
    expect(early.rejectedReason).toBe("LATENCY_NOT_ELAPSED");
    const filled = planCounterfactualExitTick({
      observation: obs(99, 2_500),
      decisionKind: "NONE",
      closeQuantity: null,
      partialLegId: null,
      quotePrice: 99,
      latencyMs: 2_000,
      feeRate: 0.001,
      feeAsset: "QUOTE",
      openOrder: opened.openOrder,
    });
    expect(filled.fill?.quantity).toBe(1);
    expect(filled.fill?.decisionKind).toBe("STRUCTURAL_STOP");
  });

  it("partial yalnızca istenen quantity ile fill üretir", () => {
    const opened = planCounterfactualExitTick({
      observation: obs(103, 0),
      decisionKind: "PARTIAL_TAKE_PROFIT",
      closeQuantity: 0.5,
      partialLegId: "leg-1",
      quotePrice: 103,
      latencyMs: 0,
      feeRate: 0.001,
      feeAsset: "QUOTE",
      openOrder: null,
    });
    expect(opened.fill?.quantity).toBe(0.5);
    expect(opened.fill?.partialLegId).toBe("leg-1");
  });

  it("gelecek availableAt quote reddedilir", () => {
    const opened = planCounterfactualExitTick({
      observation: obs(100, 0),
      decisionKind: "STRUCTURAL_STOP",
      closeQuantity: 1,
      partialLegId: null,
      quotePrice: 99,
      latencyMs: 5_000,
      feeRate: 0.001,
      feeAsset: "QUOTE",
      openOrder: null,
    });
    expect(opened.fill).toBeNull();
    const rejected = planCounterfactualExitTick({
      observation: obs(99, 1_000, 5_000),
      decisionKind: "NONE",
      closeQuantity: null,
      partialLegId: null,
      quotePrice: 99,
      latencyMs: 5_000,
      feeRate: 0.001,
      feeAsset: "QUOTE",
      openOrder: opened.openOrder,
    });
    expect(rejected.fill).toBeNull();
    expect(rejected.rejectedReason).toBe("QUOTE_NOT_YET_AVAILABLE");
  });

  it("pencere sonunda açık pozisyon censored olur", () => {
    const openOrder = {
      decisionKind: "STRUCTURAL_STOP" as const,
      partialLegId: null,
      requestedQuantity: 1,
      openedAtMs: baseNow,
    };
    const censored = censorOpenCounterfactualPosition(openOrder, baseNow + 60_000);
    expect(censored.censored).toBe(true);
    expect(censored.openOrder).toBeNull();
  });
});
