import type { ForensicSessionContext } from "@/src/server/forensics/forensic-context";
import type { NativePaperDiagnostics } from "@/src/server/forensics/forensic.types";

export function buildNativePaperDiagnostics(session: ForensicSessionContext): NativePaperDiagnostics {
  return {
    sessionId: session.sessionId,
    generatedAt: new Date().toISOString(),
    scannerCount: session.scannerCycles.reduce((acc, row) => acc + row.universeCount, 0),
    candidateCount: session.candidates.length,
    strategyCount: session.decisions.filter((row) => row.stage === "strategy").length,
    evCount: session.evAudits.length,
    aiCount: session.aiCalls.length,
    decisionCount: session.decisions.length,
    riskCount: session.riskSizing.filter((row) => !row.rejectionReason).length,
    sizingCount: session.riskSizing.length,
    orders: session.orders.length,
    fills: session.orders.filter((row) => row.fillId).length,
    positions: session.orders.filter((row) => row.positionId).length,
    exits: session.pnlEntries.length,
    rejectionCountsByStage: session.rejectionCountsByStage,
    rejectionCountsByReason: session.rejectionCountsByReason,
  };
}
