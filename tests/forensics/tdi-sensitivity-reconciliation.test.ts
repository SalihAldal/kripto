import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ForensicSessionContext, TdiDecisionRecord } from "@/src/server/forensics/forensic.types";
import { buildTdiDecisionRecord, normalizeTdiDecisionRecord } from "@/src/server/forensics/tdi-decision-forensics.service";
import {
  buildTdiSensitivityReport,
  normalizeLegacyTdiSensitivityArtifact,
} from "@/src/server/forensics/tdi-sensitivity.service";
import {
  getThresholdScore,
  replayHybridTdiVerdict,
  replayProductionTdiVerdict,
} from "@/src/server/forensics/tdi-verdict-replay.service";

function loadCanonical46RoundDecisions(): TdiDecisionRecord[] {
  const root = path.join(process.cwd(), "artifacts", "forensics", "cmstltuqn0007un9ksbk3xn9c", "rounds");
  if (!fs.existsSync(root)) return [];
  const records: TdiDecisionRecord[] = [];
  for (const roundDir of fs.readdirSync(root).filter((name) => /^\d+$/.test(name))) {
    const filePath = path.join(root, roundDir, "tdi-decisions.json");
    if (!fs.existsSync(filePath)) continue;
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as { records?: TdiDecisionRecord[] };
    for (const row of payload.records ?? []) {
      records.push(normalizeTdiDecisionRecord(row));
    }
  }
  return records;
}

describe("TDI forensic sensitivity reconciliation", () => {
  it("score >= threshold with HOLD → scoreAboveThreshold true, runtimeApproval false", () => {
    const record = buildTdiDecisionRecord({
      candidateId: "hybrid:METRY:485371f8",
      symbol: "METRY",
      verdict: "WAIT",
      hybridDecision: "HOLD",
      consensusScore: 60.29,
      reasonDetail: "Momentum guven vermiyor",
    });
    const replay = replayProductionTdiVerdict(record);
    expect(getThresholdScore(record)).toBeGreaterThanOrEqual(55);
    expect(replay.productionApprovalEquivalent).toBe(false);
    expect(replay.verdict).toBe("WAIT");
  });

  it("score >= threshold with NO_TRADE → scoreAboveThreshold true, runtimeApproval false", () => {
    const record = buildTdiDecisionRecord({
      candidateId: "tdi:METRY:e6880433",
      symbol: "METRY",
      verdict: "REJECTED",
      masterDecision: "NO_TRADE",
      hybridDecision: "HOLD",
      consensusScore: 63.62,
      reasonDetail: "master NO_TRADE",
    });
    const replay = replayProductionTdiVerdict(record);
    expect(getThresholdScore(record)).toBeGreaterThanOrEqual(55);
    expect(replay.productionApprovalEquivalent).toBe(false);
    expect(replay.verdict).toBe("REJECTED");
  });

  it("hybrid BUY → runtimeApproval true", () => {
    const record = buildTdiDecisionRecord({
      candidateId: "hybrid:TEST:1",
      symbol: "TESTTRY",
      verdict: "APPROVED",
      hybridDecision: "BUY",
      consensusScore: 72,
    });
    expect(replayProductionTdiVerdict(record).productionApprovalEquivalent).toBe(true);
    expect(replayHybridTdiVerdict("BUY")).toBe("APPROVED");
  });

  it("master legacy BUY path → runtimeApproval true", () => {
    const record = buildTdiDecisionRecord({
      candidateId: "tdi:TEST:1",
      symbol: "TESTTRY",
      verdict: "APPROVED",
      masterDecision: "BUY",
      legacyDecision: "BUY",
      hybridDecision: "BUY",
      consensusScore: 70,
    });
    const replay = replayProductionTdiVerdict(record);
    expect(replay.productionApprovalEquivalent).toBe(true);
    expect(replay.replayStatus).toBe("COMPLETE");
  });

  it("master WATCHLIST → runtimeApproval false, runtimeWait true", () => {
    const record = buildTdiDecisionRecord({
      candidateId: "tdi:TEST:2",
      symbol: "TESTTRY",
      verdict: "WAIT",
      masterDecision: "WATCHLIST",
      legacyDecision: "HOLD",
      hybridDecision: "HOLD",
      consensusScore: 58,
    });
    const replay = replayProductionTdiVerdict(record);
    expect(replay.productionApprovalEquivalent).toBe(false);
    expect(replay.verdict).toBe("WAIT");
  });

  it("master NO_TRADE → runtimeApproval false, runtimeRejected true", () => {
    const record = buildTdiDecisionRecord({
      candidateId: "tdi:TEST:3",
      symbol: "TESTTRY",
      verdict: "REJECTED",
      masterDecision: "NO_TRADE",
      legacyDecision: "NO_TRADE",
      hybridDecision: "HOLD",
      consensusScore: 63,
    });
    const replay = replayProductionTdiVerdict(record);
    expect(replay.productionApprovalEquivalent).toBe(false);
    expect(replay.verdict).toBe("REJECTED");
  });

  it("hybrid HOLD → runtimeApproval false, runtimeWait true", () => {
    const record = buildTdiDecisionRecord({
      candidateId: "hybrid:TEST:4",
      symbol: "TESTTRY",
      verdict: "WAIT",
      hybridDecision: "HOLD",
      consensusScore: 61,
    });
    const replay = replayProductionTdiVerdict(record);
    expect(replay.productionApprovalEquivalent).toBe(false);
    expect(replay.verdict).toBe("WAIT");
  });

  it("hybrid NO_TRADE → runtimeApproval false, runtimeRejected true", () => {
    const record = buildTdiDecisionRecord({
      candidateId: "hybrid:TEST:5",
      symbol: "TESTTRY",
      verdict: "REJECTED",
      hybridDecision: "NO_TRADE",
      consensusScore: 40,
    });
    const replay = replayProductionTdiVerdict(record);
    expect(replay.productionApprovalEquivalent).toBe(false);
    expect(replay.verdict).toBe("REJECTED");
  });

  it("score type separation for hybrid vs master records", () => {
    const hybrid = buildTdiDecisionRecord({
      candidateId: "hybrid:AAA:1",
      symbol: "AAATRY",
      verdict: "WAIT",
      hybridDecision: "HOLD",
      consensusScore: 60,
    });
    const master = buildTdiDecisionRecord({
      candidateId: "tdi:AAA:1",
      symbol: "AAATRY",
      verdict: "REJECTED",
      masterDecision: "NO_TRADE",
      hybridDecision: "HOLD",
      consensusScore: 63,
    });
    expect(hybrid.scoreType).toBe("HYBRID_COMPOSITE");
    expect(hybrid.hybridCompositeScore).toBe(60);
    expect(hybrid.masterExpertConsensusScore).toBeNull();
    expect(master.scoreType).toBe("MASTER_EXPERT_AVERAGE");
    expect(master.masterExpertConsensusScore).toBe(63);
    expect(master.hybridCompositeScore).toBeNull();
  });

  it("backward compatibility for legacy consensusScore-only artifacts", () => {
    const legacy = normalizeTdiDecisionRecord({
      candidateId: "hybrid:LEG:1",
      symbol: "LEGTRY",
      verdict: "WAIT",
      hybridDecision: "HOLD",
      consensusScore: 57,
      reasonDetail: "legacy",
      timestamp: "2026-08-15T00:00:00.000Z",
    });
    expect(legacy.scoreType).toBe("HYBRID_COMPOSITE");
    expect(legacy.hybridCompositeScore).toBe(57);
    expect(legacy.consensusScore).toBe(57);
  });

  it("canonical 46-round fixture: scoreAboveThresholdRate ≈ 28.4% and runtimeApprovalRate = 0%", () => {
    const records = loadCanonical46RoundDecisions();
    expect(records.length).toBeGreaterThan(1000);
    const session: ForensicSessionContext = {
      sessionId: "cmstltuqn0007un9ksbk3xn9c",
      mode: "paper",
      startedAt: "2026-08-15T00:00:00.000Z",
      terminals: [],
      scannerCycles: [],
      candidates: [],
      aiCalls: [],
      consensus: [],
      evAudits: [],
      decisions: [],
      riskSizing: [],
      orders: [],
      pnlEntries: [],
      meanReversionEntries: [],
      scannerQualificationRejections: [],
      notDiscoveredRecords: [],
      entryTimingRecords: [],
      tdiDecisions: records,
      feePolicyEvaluations: [],
      rejectionCountsByStage: {},
      rejectionCountsByReason: {},
    };
    const report = buildTdiSensitivityReport({ session, currentThreshold: 55, variation: 2 });
    expect(report.schemaVersion).toBe("tdi-sensitivity-v2");
    expect(report.scoreAboveThresholdRate).toBeGreaterThan(0.27);
    expect(report.scoreAboveThresholdRate).toBeLessThan(0.3);
    expect(report.runtimeApprovalEquivalentRate).toBe(0);
    expect(report.runtimeApprovalEquivalentCount).toBe(0);
    expect(report.approvalRate).toBe(0);
    expect(report.sensitivityPoints.find((p) => p.thresholdDelta === 0)?.scoreAboveThresholdRate).toBeGreaterThan(0.27);
    expect(report.compatibility.scoreThresholdPassField).toBe("scoreAboveThresholdRate");
  });

  it("legacy sensitivity artifact normalization maps score pass separately from runtime approval", () => {
    const normalized = normalizeLegacyTdiSensitivityArtifact({
      approvalRate: 0,
      sensitivityPoints: [{ thresholdDelta: 0, effectiveThreshold: 55, approvalRate: 0.284, waitRate: 0.716, sampleSize: 500 }],
    });
    expect(normalized.scoreAboveThresholdRate).toBeCloseTo(0.284, 3);
    expect(normalized.runtimeApprovalEquivalentRate).toBe(0);
  });

  it("sensitivity report exposes explicit score threshold explanation", () => {
    const session: ForensicSessionContext = {
      sessionId: "test",
      mode: "paper",
      startedAt: "2026-08-15T00:00:00.000Z",
      terminals: [],
      scannerCycles: [],
      candidates: [],
      aiCalls: [],
      consensus: [],
      evAudits: [],
      decisions: [],
      riskSizing: [],
      orders: [],
      pnlEntries: [],
      meanReversionEntries: [],
      scannerQualificationRejections: [],
      notDiscoveredRecords: [],
      entryTimingRecords: [],
      tdiDecisions: [
        buildTdiDecisionRecord({
          candidateId: "hybrid:X:1",
          symbol: "XTRY",
          verdict: "WAIT",
          hybridDecision: "HOLD",
          consensusScore: 60,
        }),
      ],
      feePolicyEvaluations: [],
      rejectionCountsByStage: {},
      rejectionCountsByReason: {},
    };
    const report = buildTdiSensitivityReport({ session });
    expect(report.scoreThresholdExplanation).toContain("not equivalent to production TDI APPROVED");
    expect(report.scoreAboveThresholdRate).toBe(1);
    expect(report.runtimeApprovalEquivalentRate).toBe(0);
  });
});
