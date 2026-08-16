import { createHash } from "node:crypto";
import type {
  ForensicSessionContext,
  OpportunityValueReport,
  OpportunityValueRow,
  OpportunityValueStage,
} from "@/src/server/forensics/forensic.types";

function deterministicHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

function stageFromReason(reason: string): OpportunityValueStage {
  const normalized = reason.toUpperCase();
  if (normalized.includes("SCANNER") || normalized.includes("NOT_DISCOVERED")) return "SCANNER";
  if (normalized.includes("TDI") || normalized.includes("WAIT") || normalized.includes("NO_SLOT")) return "TDI";
  if (normalized.includes("SLOT") || normalized.includes("CAPITAL")) return "SLOT";
  if (normalized.includes("SIZING")) return "SIZING";
  if (normalized.includes("AI") || normalized.includes("CONSENSUS")) return "AI";
  if (normalized.includes("RISK")) return "RISK";
  if (normalized.includes("EXECUTION") || normalized.includes("ORDER")) return "EXECUTION";
  return "TDI";
}

export function buildOpportunityValueReport(input: {
  session: ForensicSessionContext;
  postEntryMovesBySymbol?: Record<string, number>;
}): OpportunityValueReport {
  const rows: OpportunityValueRow[] = [];

  for (const record of input.session.notDiscoveredRecords ?? []) {
    const move = record.subsequentMovePercent ?? input.postEntryMovesBySymbol?.[record.symbol.toUpperCase()];
    rows.push({
      stage: "SCANNER",
      reason: record.reasonCode,
      symbol: record.symbol,
      postEntryMovePercent: move,
      estimatedOpportunityValue: move !== undefined ? round(Math.abs(move)) : 0,
      analysisScope: "POST_ENTRY_ANALYSIS",
    });
  }

  for (const tdi of input.session.tdiDecisions ?? []) {
    if (tdi.verdict !== "WAIT" && tdi.verdict !== "REJECTED") continue;
    const move = input.postEntryMovesBySymbol?.[tdi.symbol.toUpperCase()];
    const stage = tdi.waitReasonCode === "NO_SLOT" ? "SLOT" : stageFromReason(tdi.waitReasonCode ?? "TDI");
    rows.push({
      stage,
      reason: tdi.waitReasonCode ?? tdi.reasonDetail,
      symbol: tdi.symbol,
      postEntryMovePercent: move,
      estimatedOpportunityValue: move !== undefined ? round(Math.abs(move)) : 0,
      analysisScope: "POST_ENTRY_ANALYSIS",
    });
  }

  for (const terminal of input.session.terminals ?? []) {
    if (terminal.verdict === "APPROVED") continue;
    const move = input.postEntryMovesBySymbol?.[terminal.symbol.toUpperCase()];
    rows.push({
      stage: stageFromReason(terminal.reasonCode),
      reason: terminal.reasonCode,
      symbol: terminal.symbol,
      postEntryMovePercent: move,
      estimatedOpportunityValue: move !== undefined ? round(Math.abs(move)) : 0,
      analysisScope: "POST_ENTRY_ANALYSIS",
    });
  }

  const rankedByStage: OpportunityValueReport["rankedByStage"] = {};
  for (const row of rows) {
    const bucket = rankedByStage[row.stage] ?? { count: 0, totalEstimatedValue: 0 };
    bucket.count += 1;
    bucket.totalEstimatedValue = round(bucket.totalEstimatedValue + row.estimatedOpportunityValue);
    rankedByStage[row.stage] = bucket;
  }

  const report: OpportunityValueReport = {
    generatedAt: new Date().toISOString(),
    rows,
    rankedByStage,
    deterministicHash: "",
  };
  report.deterministicHash = deterministicHash({ rows, rankedByStage });
  return report;
}
