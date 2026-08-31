import { createHash } from "node:crypto";
import type {
  DecisionTraceRecord,
  EvAudit,
  FeeAwareEdgeResearchReport,
  FeeEdgeClassification,
  FeeEdgeMetricsSnapshot,
} from "@/src/server/forensics/forensic.types";
import { classifyFeeEdge } from "@/src/server/forensics/fee-edge-metrics.service";

function deterministicHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

function parseFeeMetrics(decision: DecisionTraceRecord): FeeEdgeMetricsSnapshot | null {
  if (decision.reasonCode !== "FEE_EDGE_METRICS") return null;
  try {
    return JSON.parse(decision.reasonDetail) as FeeEdgeMetricsSnapshot;
  } catch {
    return null;
  }
}

export function buildFeeMetricsBySymbol(decisions: DecisionTraceRecord[]) {
  const map: Record<string, FeeEdgeMetricsSnapshot> = {};
  for (const decision of decisions) {
    const metrics = parseFeeMetrics(decision);
    if (!metrics) continue;
    map[decision.symbol.toUpperCase()] = metrics;
  }
  return map;
}

export function buildFeeAwareEdgeResearchReport(input: {
  decisions: DecisionTraceRecord[];
  evAudits?: EvAudit[];
}): FeeAwareEdgeResearchReport {
  const feeDecisions = input.decisions.filter((row) => row.reasonCode === "FEE_EDGE_METRICS");
  const rows = feeDecisions
    .map((decision) => {
      const metrics = parseFeeMetrics(decision);
      if (!metrics) return null;
      const expectedGross = metrics.expectedGrossAtTp ?? metrics.expectedGrossPnL ?? 0;
      const expectedRoundTripFee = metrics.estimatedRoundTripFees ?? metrics.estimatedRoundTripFee ?? 0;
      const expectedNet = metrics.expectedNetAfterFeesAtTp ?? metrics.expectedNetPnL ?? expectedGross - expectedRoundTripFee;
      const edgeAfterFees = round(expectedNet);
      const classification = classifyFeeEdge({
        expectedGross,
        expectedNet,
        fee: expectedRoundTripFee,
        ratio: metrics.expectedGrossToFeeRatio,
      }) as FeeEdgeClassification;
      const evidenceQuality: "HIGH" | "INSUFFICIENT" =
        classification === "UNKNOWN" ? "INSUFFICIENT" : "HIGH";
      return {
        candidateId: decision.candidateId,
        symbol: decision.symbol,
        expectedGross: round(expectedGross),
        expectedRoundTripFee: round(expectedRoundTripFee),
        expectedNet: round(expectedNet),
        edgeAfterFees,
        classification,
        evidenceQuality,
      };
    })
    .filter(Boolean) as FeeAwareEdgeResearchReport["rows"];

  const summary: Partial<Record<FeeEdgeClassification, number>> = {};
  for (const row of rows) {
    summary[row.classification] = (summary[row.classification] ?? 0) + 1;
  }

  const report: FeeAwareEdgeResearchReport = {
    generatedAt: new Date().toISOString(),
    sampleSize: rows.length,
    rows,
    summary,
    deterministicHash: "",
  };
  report.deterministicHash = deterministicHash({ sampleSize: rows.length, summary });
  return report;
}
