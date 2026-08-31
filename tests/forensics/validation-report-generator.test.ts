import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateValidationReport } from "@/src/server/forensics/validation-report-generator.service";

describe("validation report generator", () => {
  const sessionId = "report-golden-session";
  const roundId = "1";
  const runId = "run-golden-1";
  const root = path.join(process.cwd(), "artifacts", "forensics", sessionId);
  const roundRoot = path.join(root, "rounds", roundId);

  beforeEach(() => {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    mkdirSync(roundRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  it("renders complete markdown sections from golden fixture", () => {
    writeFileSync(path.join(roundRoot, "round-summary.json"), JSON.stringify({ runId, result: "completed", exportStatus: "COMPLETED", candidateCount: 5, tradeCount: 2, failureCount: 1 }));
    writeFileSync(path.join(roundRoot, "run-identity.json"), JSON.stringify({ runId, sessionId, mode: "paper", venue: "BINANCE_GLOBAL", configHash: "hash-1", startedAt: "2026-01-01", endedAt: "2026-01-01" }));
    writeFileSync(path.join(roundRoot, "config-drift.json"), JSON.stringify({ status: "CONFIG_STABLE" }));
    writeFileSync(path.join(roundRoot, "runtime-telemetry.json"), JSON.stringify({
      marketData: { universeSize: 200, liveSymbols: 180, staleSymbols: 5, coveragePct: 90, count1008: 1, reconnectAttempt: 2, reconnectSuccess: 2, rateLimited429: 3, banned418: 0 },
      breaker: { summary: { open: 0 } },
      resources: { cpuPercent: 22, eventLoopLagP95Ms: 10, redisLatencyMs: 2, memory: { rssMB: 200, heapUsedMB: 120, heapTotalMB: 180 } },
      authority: { aiHardVetoCount: 0, tdiHardVetoCount: 0, learningHardVetoCount: 0, legacyScannerInvocationCount: 0, legacyScannerPersistCount: 0 },
    }));
    writeFileSync(path.join(roundRoot, "scanner-summary.json"), JSON.stringify({ cycles: [{ id: 1 }] }));
    writeFileSync(path.join(roundRoot, "pnl-ledger.json"), JSON.stringify({ summary: { netPnL: 12.3, grossPnL: 17.2, totalFees: 1.2, profitFactor: 1.4, expectancy: 0.9, maxDrawdown: 2.1 } }));
    writeFileSync(path.join(roundRoot, "edge-analytics.json"), JSON.stringify({
      summary: {
        candidateCount: 5,
        uniqueMoveCount: 3,
        groundTruth: { move1: 2, move2: 2, move3: 1, move5: 1, move10: 1 },
        recall: { recall: 0.5 },
        earlyRecall: { before3: { recall: 0.4 } },
      },
      scoreCalibration: [{ bucket: "80-84" }],
    }));
    writeFileSync(path.join(roundRoot, "edge-accounting.json"), JSON.stringify({
      mfeConversion: [
        { threshold: 2, totalCandidates: 2, paperTraded: 1, conversionPercent: 50 },
        { threshold: 3, totalCandidates: 2, paperTraded: 1, conversionPercent: 50 },
      ],
      profitableTradeConversion: {
        mfe2: { conversionPercent: 50 },
        mfe3: { conversionPercent: 50 },
        mfe5: { conversionPercent: 0 },
      },
      missedProfitableOpportunities: [{ candidateId: "B" }],
      profitableRejectionHistogram: [{ threshold: 2, histogram: { MICRO_REJECTED: 1 } }],
      captureRatio: { formula: "tradeCapturedReturnPct / detectionToPeakPotentialPct", summary: { N: 1, medianRatio: 0.4, p95Ratio: 0.4 } },
      rankCalibration: [{ bucket: "1-5", N: 1, hit2Rate: 100, tradeRate: 100 }],
      hotGateValue: { hot: { medianMFE: 3.2 }, notHot: { medianMFE: 0.1 } },
      microValue: { microConfirmed: { medianMFE: 4 }, microRejected: { medianMFE: 0.3 } },
      riskValue: { missedProfit: 1, avoidedLoss: 2 },
      pipelineLatency: { DiscoveryToHotMs: { p50: 100 }, ExecutionReadyToRiskAllowedMs: { p95: 400 }, PaperAttemptToPaperOpenedMs: { p95: 300 }, DetectionToPaperOpenedTotalMs: { p95: 2000 } },
      deepLatency: { subscribeRequestedToActive: { p95: 200 }, activeToFirstAggTrade: { p95: 300 }, activeToFirstBookTicker: { p95: 250 }, activeToMicroReady: { p95: 500 } },
    }));

    const generated = generateValidationReport(runId);
    expect(generated.found).toBe(true);
    expect(generated.report).toContain("## RUN INFO");
    expect(generated.report).toContain("## MFE FUNNELS");
    expect(generated.report).toContain("## CAPTURE RATIO");
    expect(generated.report).toContain("## PIPELINE LATENCY");
    expect(generated.report).toContain("## CPU MEMORY EVENT LOOP REDIS");
  });

  it("returns not recorded report for empty dataset", () => {
    const generated = generateValidationReport("missing-run-id");
    expect(generated.found).toBe(false);
    expect(generated.report).toContain("NOT_RECORDED");
  });
});
