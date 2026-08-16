import { createHash } from "node:crypto";
import type {
  ForensicSessionContext,
  OpportunityFunnelReport,
  OpportunityFunnelRow,
  OpportunityLossReason,
} from "@/src/server/forensics/forensic.types";

function deterministicHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

function mapReasonToStage(reason: string): OpportunityLossReason {
  const normalized = reason.toUpperCase();
  if (normalized.includes("NOT_DISCOVERED") || normalized.includes("NOT_IN_CYCLE") || normalized.includes("NOT_IN_UNIVERSE")) {
    return "NOT_DISCOVERED";
  }
  if (normalized.includes("SCANNER") || normalized.includes("FILTER") || normalized.includes("REJECTED")) {
    return "FILTERED_OUT";
  }
  if (normalized.includes("NO_SLOT") || normalized.includes("CAPITAL_SLOT")) {
    return "NO_SLOT";
  }
  if (normalized.includes("TDI") || normalized.includes("WAIT") || normalized.includes("NEUTRAL")) {
    return "TDI_WAIT";
  }
  if (normalized.includes("SIZING")) return "SIZING";
  if (normalized.includes("AI") || normalized.includes("CONSENSUS")) return "AI_REJECTED";
  if (normalized.includes("RISK")) return "RISK";
  if (normalized.includes("EXECUTION") || normalized.includes("ORDER")) return "EXECUTION_FAILED";
  return "UNKNOWN";
}

export function buildOpportunityFunnelReport(session: ForensicSessionContext): OpportunityFunnelReport {
  const discovered = session.candidates.length;
  const traded = session.orders.filter((row) => row.side === "BUY").length;
  const rejectionByReason = session.rejectionCountsByReason ?? {};
  const rejectionByStage = session.rejectionCountsByStage ?? {};

  const lossByReason: OpportunityFunnelReport["lossByReason"] = {};
  let totalLosses = 0;
  for (const [reason, count] of Object.entries(rejectionByReason)) {
    const mapped = mapReasonToStage(reason);
    const row = lossByReason[mapped] ?? { count: 0, percentage: 0 };
    row.count += Number(count);
    totalLosses += Number(count);
    lossByReason[mapped] = row;
  }

  const totalBase = Math.max(discovered, totalLosses + traded, 1);
  for (const key of Object.keys(lossByReason) as OpportunityLossReason[]) {
    const row = lossByReason[key]!;
    row.percentage = round((row.count / totalBase) * 100, 2);
  }

  const stages: OpportunityFunnelRow[] = [
    {
      stage: "DISCOVERED",
      entered: discovered,
      lost: totalLosses,
      lostReason: "FILTERED_OUT",
      count: discovered,
      percentage: 100,
      evidenceCompleteness: discovered > 0 ? "COMPLETE" : "INSUFFICIENT",
    },
    {
      stage: "STRATEGY_QUALIFIED",
      entered: discovered - (rejectionByStage.scanner ?? 0),
      lost: rejectionByStage.strategy ?? 0,
      lostReason: "FILTERED_OUT",
      count: rejectionByStage.strategy ?? 0,
      percentage: round(((rejectionByStage.strategy ?? 0) / totalBase) * 100, 2),
      evidenceCompleteness: rejectionByStage.strategy ? "COMPLETE" : "PARTIAL",
    },
    {
      stage: "TDI",
      entered: 0,
      lost: (lossByReason.TDI_WAIT?.count ?? 0) + (lossByReason.NO_SLOT?.count ?? 0),
      lostReason: "TDI_WAIT",
      count: (lossByReason.TDI_WAIT?.count ?? 0) + (lossByReason.NO_SLOT?.count ?? 0),
      percentage: round((((lossByReason.TDI_WAIT?.count ?? 0) + (lossByReason.NO_SLOT?.count ?? 0)) / totalBase) * 100, 2),
      evidenceCompleteness: session.tdiDecisions?.length ? "COMPLETE" : "PARTIAL",
    },
    {
      stage: "AI",
      entered: 0,
      lost: lossByReason.AI_REJECTED?.count ?? 0,
      lostReason: "AI_REJECTED",
      count: lossByReason.AI_REJECTED?.count ?? 0,
      percentage: round(((lossByReason.AI_REJECTED?.count ?? 0) / totalBase) * 100, 2),
      evidenceCompleteness: session.aiCalls?.length ? "COMPLETE" : "PARTIAL",
    },
    {
      stage: "RISK",
      entered: 0,
      lost: lossByReason.RISK?.count ?? 0,
      lostReason: "RISK",
      count: lossByReason.RISK?.count ?? 0,
      percentage: round(((lossByReason.RISK?.count ?? 0) / totalBase) * 100, 2),
      evidenceCompleteness: session.riskSizing?.length ? "COMPLETE" : "PARTIAL",
    },
    {
      stage: "EXECUTION",
      entered: traded,
      lost: lossByReason.EXECUTION_FAILED?.count ?? 0,
      lostReason: "EXECUTION_FAILED",
      count: traded,
      percentage: round((traded / totalBase) * 100, 2),
      evidenceCompleteness: traded > 0 ? "COMPLETE" : "PARTIAL",
    },
  ];

  const report: OpportunityFunnelReport = {
    generatedAt: new Date().toISOString(),
    totalDiscovered: discovered,
    traded,
    stages,
    lossByReason,
    deterministicHash: "",
  };
  report.deterministicHash = deterministicHash({
    totalDiscovered: discovered,
    traded,
    stages,
    lossByReason,
  });
  return report;
}
