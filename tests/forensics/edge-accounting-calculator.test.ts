import { describe, expect, it } from "vitest";
import {
  buildEdgeAccountingReport,
  calculateCaptureRatio,
  calculatePipelineLatency,
  calculateProfitableOpportunityConversion,
} from "@/src/server/forensics/edge-accounting-calculator.service";

function trackedCandidate(input: {
  candidateId: string;
  symbol: string;
  lane: string;
  rank: number;
  mfe: number | null;
  mae: number | null;
  complete?: boolean;
  quality?: "OK" | "OUTCOME_DATA_INCOMPLETE";
}) {
  return {
    snapshot: {
      candidateId: input.candidateId,
      symbol: input.symbol,
      primaryLane: input.lane,
      firstDetectedAt: 1_000,
      firstDetectionPrice: 100,
      opportunityScore: 80,
      microScore: 75,
      finalScore: 88,
      initialRank: input.rank,
      microTiming: {
        deepSubscribeRequestedAt: 1_200,
        deepActiveAt: 1_500,
        firstAggTradeAt: 1_700,
        firstBookTickerAt: 1_800,
      },
    },
    microReadyAt: 2_100,
    latestRank: input.rank,
    outcomes: [
      {
        horizonMin: 60,
        mfePct: input.mfe,
        maePct: input.mae,
        returnPct: input.mfe,
        complete: input.complete ?? true,
        quality: input.quality ?? "OK",
      },
    ],
  };
}

describe("edge accounting calculator", () => {
  it("calculates profitable opportunity conversion and excludes invalid/pending outcomes", () => {
    const tracked = [
      trackedCandidate({ candidateId: "A", symbol: "AAAUSDT", lane: "EARLY", rank: 2, mfe: 3.2, mae: -0.8 }),
      trackedCandidate({ candidateId: "B", symbol: "BBBUSDT", lane: "STEADY", rank: 9, mfe: 4.1, mae: -1.4 }),
      trackedCandidate({ candidateId: "C", symbol: "CCCUSDT", lane: "STEADY", rank: 22, mfe: 0.5, mae: -0.2 }),
      trackedCandidate({ candidateId: "D", symbol: "DDDUSDT", lane: "MOMENTUM", rank: 5, mfe: null, mae: null, complete: false }),
      trackedCandidate({
        candidateId: "E",
        symbol: "EEEUSDT",
        lane: "CONTINUATION",
        rank: 12,
        mfe: null,
        mae: null,
        complete: true,
        quality: "OUTCOME_DATA_INCOMPLETE",
      }),
    ];
    const events = [
      { candidateId: "A", eventType: "CANDIDATE_DISCOVERED", timestamp: new Date(1_000).toISOString(), payload: { lane: "EARLY" } },
      { candidateId: "A", eventType: "CANDIDATE_HOT", timestamp: new Date(1_100).toISOString(), payload: {} },
      { candidateId: "A", eventType: "MICRO_ANALYZED", timestamp: new Date(1_200).toISOString(), payload: {} },
      { candidateId: "A", eventType: "MICRO_CONFIRMED", timestamp: new Date(1_300).toISOString(), payload: {} },
      { candidateId: "A", eventType: "FINAL_RANKED", timestamp: new Date(1_350).toISOString(), payload: {} },
      { candidateId: "A", eventType: "EXECUTION_READY", timestamp: new Date(1_400).toISOString(), payload: {} },
      { candidateId: "A", eventType: "RISK_ALLOWED", timestamp: new Date(1_500).toISOString(), payload: {} },
      { candidateId: "A", eventType: "PAPER_ATTEMPT", timestamp: new Date(1_600).toISOString(), payload: {} },
      { candidateId: "A", eventType: "PAPER_OPENED", timestamp: new Date(1_700).toISOString(), payload: {} },
      { candidateId: "B", eventType: "CANDIDATE_DISCOVERED", timestamp: new Date(1_000).toISOString(), payload: { lane: "STEADY" } },
      { candidateId: "B", eventType: "CANDIDATE_HOT", timestamp: new Date(1_100).toISOString(), payload: {} },
      { candidateId: "B", eventType: "MICRO_REJECTED", timestamp: new Date(1_300).toISOString(), payload: { terminalStage: "MICRO_REJECTED", terminalReason: "MICRO_WIDE_SPREAD" } },
      { candidateId: "C", eventType: "CANDIDATE_DISCOVERED", timestamp: new Date(1_000).toISOString(), payload: { lane: "STEADY" } },
    ];
    const orders = [
      { candidateId: "A", side: "BUY", entryPrice: 100 },
      { candidateId: "A", side: "SELL", entryPrice: 104 },
    ];
    const report = buildEdgeAccountingReport({
      tracked: tracked as unknown as Record<string, unknown>[],
      canonicalEvents: events as unknown as Record<string, unknown>[],
      orders: orders as unknown as Record<string, unknown>[],
      pnlEntries: [],
    });
    const mfe2 = report.mfeConversion.find((row) => row.threshold === 2);
    expect(mfe2?.totalCandidates).toBe(2);
    expect(mfe2?.paperTraded).toBe(1);
    expect(mfe2?.notTraded).toBe(1);
    expect(mfe2?.conversionPercent).toBe(50);
    expect(report.missedProfitableOpportunities.some((row) => row.candidateId === "B")).toBe(true);
    const conversion = calculateProfitableOpportunityConversion({
      tracked: tracked as unknown as Record<string, unknown>[],
      canonicalEvents: events as unknown as Record<string, unknown>[],
    });
    expect(conversion.find((row) => row.threshold === 2)?.conversionPercent).toBe(50);
  });

  it("calculates capture ratio with explicit formula", () => {
    const tracked = [trackedCandidate({ candidateId: "A", symbol: "AAAUSDT", lane: "EARLY", rank: 1, mfe: 10, mae: -1 })];
    const events = [{ candidateId: "A", eventType: "PAPER_OPENED", timestamp: new Date(1_700).toISOString(), payload: {} }];
    const orders = [
      { candidateId: "A", side: "BUY", entryPrice: 100 },
      { candidateId: "A", side: "SELL", entryPrice: 104 },
    ];
    const report = buildEdgeAccountingReport({
      tracked: tracked as unknown as Record<string, unknown>[],
      canonicalEvents: events as unknown as Record<string, unknown>[],
      orders: orders as unknown as Record<string, unknown>[],
      pnlEntries: [],
    });
    expect(report.captureRatio.formula).toContain("tradeCapturedReturnPct");
    const row = report.captureRatio.rows.find((x) => x.candidateId === "A");
    expect(row?.tradeCapturedReturnPct).toBe(4);
    expect(row?.tradeCaptureRatio).toBe(0.4);
    const capture = calculateCaptureRatio({
      tracked: tracked as unknown as Record<string, unknown>[],
      canonicalEvents: events as unknown as Record<string, unknown>[],
      orders: orders as unknown as Record<string, unknown>[],
    });
    expect(capture.summary.N).toBeGreaterThanOrEqual(1);
    const latency = calculatePipelineLatency({
      tracked: tracked as unknown as Record<string, unknown>[],
      canonicalEvents: events as unknown as Record<string, unknown>[],
    });
    expect(latency.pipelineLatency.DetectionToPaperOpenedTotalMs.n).toBe(0);
  });
});
