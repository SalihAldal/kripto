import { describe, expect, it } from "vitest";
import { buildMatchedEntryManifest } from "@/src/server/profitability/pr04-matched-entry-manifest";
import { runPr04CounterfactualExitReplayWithOutcome } from "@/src/server/profitability/pr04-counterfactual-replay";
import { buildRiskReference } from "@/src/server/profitability/pr04-structural-stop";
import type { ExitTickObservation } from "@/src/server/profitability/pr04-types";

const baseNow = Date.parse("2026-09-06T10:00:00.000Z");

function obs(mark: number, offset = 0, availableOffset = offset): ExitTickObservation {
  const t = baseNow + offset;
  return {
    eventId: `evt:int:${t}:${mark}`,
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

function manifest() {
  const entryAtMs = baseNow;
  const entryPrice = 100;
  const qty = 1;
  const fee = 0.1;
  const stopPrice = 99;
  return buildMatchedEntryManifest({
    entrySignalId: "sig-cf-int",
    strategyId: "EARLY_ACCELERATION",
    entryPolicyVersion: "pr02-v1",
    entryAtMs,
    fills: [{ price: entryPrice, quantity: qty, fee, atMs: entryAtMs }],
    riskReference: buildRiskReference({
      entryPrice,
      initialStopPrice: stopPrice,
      initialQuantity: qty,
      entryFee: fee,
      includesFeesInBreakEven: true,
      computedAtMs: entryAtMs,
    }),
    invalidation: {
      invalidationThreshold: stopPrice,
      invalidationReason: "STRUCTURAL",
      baselinePrice: entryPrice,
      firstDetectionPrice: entryPrice + 0.2,
      latestPrice: entryPrice + 1.5,
      asOfMs: entryAtMs,
    },
    featureEvidenceIds: [],
    dataSource: "ENGINEERING_FIXTURE",
    replayWindow: { fromMs: entryAtMs, toMs: baseNow + 120_000 },
    symbol: "BTCTRY",
    regime: "TREND_UP",
  });
}

describe("Counterfactual exit replay integration", () => {
  it("actionable yok → satış yok", () => {
    const result = runPr04CounterfactualExitReplayWithOutcome({
      datasetId: "cf-int-none",
      manifest: manifest(),
      policyId: "STRUCTURAL_PARTIAL_TRAIL",
      config: { latencyMs: 0, feeRate: 0.001, feeAsset: "QUOTE" },
      ticks: [{ tickIndex: 0, observation: obs(101, 1_000), quotePrice: 101 }],
      experimentalMode: true,
    });
    expect(result.report.partialCount + result.report.fullCloseCount).toBe(0);
  });

  it("tekrarlanan stop + latency → zamanında tek fill", () => {
    const result = runPr04CounterfactualExitReplayWithOutcome({
      datasetId: "cf-int-stop",
      manifest: manifest(),
      policyId: "STRUCTURAL_PARTIAL_TRAIL",
      config: { latencyMs: 2_000, feeRate: 0.001, feeAsset: "QUOTE" },
      ticks: [
        { tickIndex: 0, observation: obs(98, 0), quotePrice: 98, decisionAtMs: baseNow },
        { tickIndex: 1, observation: obs(98, 1_000), quotePrice: 98 },
        { tickIndex: 2, observation: obs(98, 2_500), quotePrice: 98 },
        { tickIndex: 3, observation: obs(98, 3_000), quotePrice: 98 },
      ],
      experimentalMode: true,
    });
    expect(result.report.fullCloseCount).toBe(1);
    expect(result.closed).toBe(true);
  });

  it("gelecek availableAt → erken fill yok", () => {
    const result = runPr04CounterfactualExitReplayWithOutcome({
      datasetId: "cf-int-future-quote",
      manifest: manifest(),
      policyId: "STRUCTURAL_PARTIAL_TRAIL",
      config: { latencyMs: 5_000, feeRate: 0.001, feeAsset: "QUOTE" },
      ticks: [
        { tickIndex: 0, observation: obs(98, 0), quotePrice: 98, decisionAtMs: baseNow },
        { tickIndex: 1, observation: obs(98, 1_000, 5_000), quotePrice: 98 },
      ],
      experimentalMode: true,
    });
    expect(result.report.fullCloseCount).toBe(0);
  });

  it("pencere sonunda açık position → censored", () => {
    const result = runPr04CounterfactualExitReplayWithOutcome({
      datasetId: "cf-int-censored",
      manifest: manifest(),
      policyId: "STRUCTURAL_PARTIAL_TRAIL",
      config: { latencyMs: 60_000, feeRate: 0.001, feeAsset: "QUOTE" },
      ticks: [{ tickIndex: 0, observation: obs(98, 0), quotePrice: 98, decisionAtMs: baseNow }],
      windowEndMs: baseNow + 5_000,
      experimentalMode: true,
    });
    expect(result.censored).toBe(true);
    expect(result.terminalStatus).toBe("CENSORED");
  });
});
