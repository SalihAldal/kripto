import { randomUUID } from "node:crypto";
import { getForensicSession, getOrCreateForensicSession } from "@/src/server/forensics/forensic-context";
import type {
  AiCallAudit,
  CandidateTerminalRecord,
  CandidateTraceRecord,
  ConsensusAudit,
  DecisionTraceRecord,
  EvAudit,
  ForensicStage,
  MissedOpportunityStage,
  PaperOrderAudit,
  PnlLedgerEntry,
  RiskSizingTrace,
  ScannerCycleSummary,
  ScannerSymbolRecord,
  TerminalVerdict,
  MeanReversionEntryRecord,
  ScannerQualificationRejection,
  NotDiscoveredAnalysisRecord,
  EntryTimingRecord,
  ScannerCoverageSnapshot,
  TdiDecisionRecord,
  FeeAwareEntryPolicyEvaluation,
} from "@/src/server/forensics/forensic.types";
import { FORENSIC_ARTIFACT_CAPS } from "@/src/server/forensics/forensic.types";

function bumpCount(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

export function createCandidateId(symbol: string, source = "scanner") {
  return `${source}:${symbol.toUpperCase()}:${randomUUID().slice(0, 8)}`;
}

export function recordTerminalOutcome(input: Omit<CandidateTerminalRecord, "timestamp"> & { timestamp?: string }) {
  const session = getOrCreateForensicSession();
  const record: CandidateTerminalRecord = {
    ...input,
    symbol: input.symbol.toUpperCase(),
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
  session.terminals.push(record);
  if (record.verdict === "REJECTED" || record.verdict === "FAILED" || record.verdict === "UNKNOWN") {
    bumpCount(session.rejectionCountsByStage, record.stage);
    bumpCount(session.rejectionCountsByReason, record.reasonCode);
  }
  const candidate = session.candidates.find((row) => row.symbol === record.symbol && !row.terminal);
  if (candidate) {
    candidate.terminal = record;
  }
  return record;
}

export function recordScannerSymbol(input: Omit<ScannerSymbolRecord, "timestamp"> & { timestamp?: string }) {
  const session = getOrCreateForensicSession();
  const record: ScannerSymbolRecord = {
    ...input,
    symbol: input.symbol.toUpperCase(),
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
  let cycle = session.scannerCycles[session.scannerCycles.length - 1];
  if (!cycle || cycle.endedAt) {
    cycle = startScannerCycle();
  }
  if (cycle.symbols.length < FORENSIC_ARTIFACT_CAPS.scannerSymbolsPerCycle) {
    cycle.symbols.push(record);
  }
  cycle.universeCount += 1;
  if (record.qualification === "APPROVED") {
    cycle.qualifiedCount += 1;
    cycle.eligibleCount += 1;
  } else if (record.qualification === "WAIT") {
    cycle.eligibleCount += 1;
  } else {
    cycle.rejectedCount += 1;
    bumpCount(cycle.rejectionReasons, record.reasonCode);
    recordTerminalOutcome({
      candidateId: createCandidateId(record.symbol, "scanner"),
      symbol: record.symbol,
      stage: "scanner",
      verdict: record.qualification === "UNKNOWN" ? "UNKNOWN" : "REJECTED",
      reasonCode: record.reasonCode,
      reasonDetail: record.reasonCode,
    });
  }
  return record;
}

export function startScannerCycle(cycleId = randomUUID()) {
  const session = getOrCreateForensicSession();
  const cycle: ScannerCycleSummary = {
    cycleId,
    startedAt: new Date().toISOString(),
    endedAt: "",
    universeCount: 0,
    eligibleCount: 0,
    qualifiedCount: 0,
    rejectedCount: 0,
    rejectionReasons: {},
    durationMs: 0,
    errorCount: 0,
    retryCount: 0,
    rateLimitCount: 0,
    symbols: [],
  };
  session.scannerCycles.push(cycle);
  return cycle;
}

export function finishScannerCycle(cycleId?: string) {
  const session = getForensicSession();
  if (!session) return null;
  const cycle = cycleId
    ? session.scannerCycles.find((row) => row.cycleId === cycleId)
    : session.scannerCycles[session.scannerCycles.length - 1];
  if (!cycle || cycle.endedAt) return null;
  cycle.endedAt = new Date().toISOString();
  cycle.durationMs = Math.max(0, Date.parse(cycle.endedAt) - Date.parse(cycle.startedAt));
  return cycle;
}

export function recordCandidateTrace(input: Omit<CandidateTraceRecord, "candidateTimestamp"> & { candidateTimestamp?: string }) {
  const session = getOrCreateForensicSession();
  if (session.candidates.length >= FORENSIC_ARTIFACT_CAPS.candidateTracePerSession) {
    return session.candidates[session.candidates.length - 1];
  }
  const record: CandidateTraceRecord = {
    ...input,
    symbol: input.symbol.toUpperCase(),
    candidateTimestamp: input.candidateTimestamp ?? new Date().toISOString(),
  };
  session.candidates.push(record);
  return record;
}

export function recordAiCall(input: AiCallAudit) {
  const session = getOrCreateForensicSession();
  if (session.aiCalls.length < FORENSIC_ARTIFACT_CAPS.aiCallsPerSession) {
    session.aiCalls.push(input);
  }
  if (!input.success || input.degraded) {
    recordTerminalOutcome({
      candidateId: createCandidateId(input.symbol, "ai"),
      symbol: input.symbol,
      stage: "ai",
      verdict: input.degraded ? "FAILED" : "REJECTED",
      reasonCode: input.degraded ? "AI_DEGRADED" : "AI_CALL_FAILED",
      reasonDetail: input.reason ?? input.executionMode,
    });
  }
  return input;
}

export function recordConsensusAudit(input: ConsensusAudit) {
  const session = getOrCreateForensicSession();
  session.consensus.push(input);
  if (input.finalDecision === "NO_TRADE" || input.finalDecision === "HOLD" || input.finalDecision === "REJECT") {
    recordTerminalOutcome({
      candidateId: createCandidateId(input.symbol, "consensus"),
      symbol: input.symbol,
      stage: "consensus",
      verdict: "REJECTED",
      reasonCode: "CONSENSUS_REJECT",
      reasonDetail: input.reason,
    });
  }
  return input;
}

export function recordEvAudit(input: EvAudit) {
  const session = getOrCreateForensicSession();
  session.evAudits.push(input);
  if (input.verdict !== "APPROVED") {
    recordTerminalOutcome({
      candidateId: input.candidateId,
      symbol: input.symbol,
      stage: "ev",
      verdict: input.verdict,
      reasonCode: input.reasonCode,
      reasonDetail: input.reasonCode,
    });
  }
  return input;
}

export function recordDecisionTrace(input: Omit<DecisionTraceRecord, "timestamp"> & { timestamp?: string }) {
  const session = getOrCreateForensicSession();
  if (session.decisions.length >= FORENSIC_ARTIFACT_CAPS.decisionRecordsPerSession) {
    return session.decisions[session.decisions.length - 1];
  }
  const record: DecisionTraceRecord = {
    ...input,
    symbol: input.symbol.toUpperCase(),
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
  session.decisions.push(record);
  const terminalVerdict: TerminalVerdict =
    record.verdict === "APPROVE"
      ? "APPROVED"
      : record.verdict === "WAIT"
        ? "WAIT"
        : record.verdict === "FAILED"
          ? "FAILED"
          : "REJECTED";
  if (terminalVerdict !== "APPROVED") {
    recordTerminalOutcome({
      candidateId: record.candidateId,
      symbol: record.symbol,
      stage: record.stage,
      verdict: terminalVerdict,
      reasonCode: record.reasonCode,
      reasonDetail: record.reasonDetail,
      rank: record.rank,
    });
  }
  return record;
}

export function recordRiskSizingTrace(input: RiskSizingTrace) {
  const session = getOrCreateForensicSession();
  session.riskSizing.push(input);
  if (input.riskVerdict !== "APPROVED" || input.rejectionReason) {
    recordTerminalOutcome({
      candidateId: input.candidateId,
      symbol: input.symbol,
      stage: input.rejectionReason ? "sizing" : "risk",
      verdict: "REJECTED",
      reasonCode: input.rejectionReason ? "SIZING_REJECT" : "RISK_REJECT",
      reasonDetail: input.rejectionReason ?? "Risk gate rejected",
    });
  }
  return input;
}

export function recordPaperOrder(input: PaperOrderAudit) {
  const session = getOrCreateForensicSession();
  session.orders.push(input);
  if (!input.reconciled) {
    recordTerminalOutcome({
      candidateId: input.candidateId ?? createCandidateId(input.symbol, "execution"),
      symbol: input.symbol,
      stage: "execution",
      verdict: "FAILED",
      reasonCode: "EXECUTION_RECONCILE_FAILED",
      reasonDetail: input.reconcileError ?? "Order/fill/position mismatch",
    });
  }
  return input;
}

export function recordPnlLedgerEntry(input: PnlLedgerEntry) {
  const session = getOrCreateForensicSession();
  session.pnlEntries.push(input);
  return input;
}

export function recordMeanReversionEntry(input: MeanReversionEntryRecord) {
  const session = getOrCreateForensicSession();
  session.meanReversionEntries = session.meanReversionEntries ?? [];
  session.meanReversionEntries.push(input);
  recordDecisionTrace({
    candidateId: input.candidateId,
    symbol: input.symbol,
    stage: "strategy",
    verdict: "APPROVE",
    reasonCode: "MEAN_REVERSION_ENTRY",
    reasonDetail: JSON.stringify({
      forensicRegime: input.forensicRegime,
      marketRegime: input.marketRegime,
      side: input.side,
      strategySelectionReason: input.strategySelectionReason,
      volatilityPercent: input.volatilityPercent,
      trendStrength: input.trendStrength,
      liquidityScore: input.liquidityScore,
      momentumPercent: input.momentumPercent,
      shortMomentumPercent: input.shortMomentumPercent,
    }),
  });
  return input;
}

export function recordScannerQualificationRejections(input: ScannerQualificationRejection[]) {
  const session = getOrCreateForensicSession();
  session.scannerQualificationRejections = session.scannerQualificationRejections ?? [];
  for (const row of input) {
    if (session.scannerQualificationRejections.length >= FORENSIC_ARTIFACT_CAPS.missedOpportunitiesPerSession) break;
    session.scannerQualificationRejections.push(row);
    if (row.missedOpportunityStage) {
      recordMissedOpportunity({
        symbol: row.symbol,
        timestamp: row.timestamp,
        stage: row.missedOpportunityStage,
        reasonCode: row.reasonCode,
        reasonDetail: row.reasonDetail,
      });
    }
  }
  return input;
}

export function recordNotDiscoveredAnalysis(input: NotDiscoveredAnalysisRecord) {
  const session = getOrCreateForensicSession();
  session.notDiscoveredRecords = session.notDiscoveredRecords ?? [];
  if (session.notDiscoveredRecords.length < FORENSIC_ARTIFACT_CAPS.missedOpportunitiesPerSession) {
    session.notDiscoveredRecords.push(input);
  }
  recordMissedOpportunity({
    symbol: input.symbol,
    timestamp: input.timestamp,
    stage: input.stage,
    reasonCode: input.reasonCode,
    reasonDetail: input.reasonDetail,
    subsequentMove: input.subsequentMovePercent,
    evidenceRefs: input.qualificationTrail.map((row) => `${row.stage}:${row.reasonCode}`),
  });
  return input;
}

export function recordEntryTiming(input: EntryTimingRecord) {
  const session = getOrCreateForensicSession();
  session.entryTimingRecords = session.entryTimingRecords ?? [];
  const existingIndex = session.entryTimingRecords.findIndex(
    (row) => row.candidateId === input.candidateId && row.symbol === input.symbol,
  );
  if (existingIndex >= 0) {
    session.entryTimingRecords[existingIndex] = input;
  } else {
    session.entryTimingRecords.push(input);
  }
  recordDecisionTrace({
    candidateId: input.candidateId,
    symbol: input.symbol,
    stage: "execution",
    verdict: "APPROVE",
    reasonCode: `ENTRY_TIMING_${input.classification}`,
    reasonDetail: input.reasonDetail,
  });
  return input;
}

export function recordTdiDecision(input: TdiDecisionRecord) {
  const session = getOrCreateForensicSession();
  session.tdiDecisions = session.tdiDecisions ?? [];
  if (session.tdiDecisions.length >= FORENSIC_ARTIFACT_CAPS.tdiDecisionRecordsPerSession) {
    return session.tdiDecisions[session.tdiDecisions.length - 1];
  }
  session.tdiDecisions.push(input);
  recordDecisionTrace({
    candidateId: input.candidateId,
    symbol: input.symbol,
    stage: "decision",
    verdict: input.verdict === "APPROVED" ? "APPROVE" : input.verdict === "WAIT" ? "WAIT" : "REJECT",
    reasonCode: input.waitReasonCode ?? `TDI_${input.verdict}`,
    reasonDetail: input.reasonDetail,
    rank: input.rank,
    capitalSlot: input.capitalSlot,
  });
  return input;
}

export function recordFeePolicyEvaluation(input: FeeAwareEntryPolicyEvaluation & { candidateId?: string; symbol?: string }) {
  const session = getOrCreateForensicSession();
  session.feePolicyEvaluations = session.feePolicyEvaluations ?? [];
  session.feePolicyEvaluations.push(input);
  if (input.candidateId && input.symbol) {
    recordDecisionTrace({
      candidateId: input.candidateId,
      symbol: input.symbol,
      stage: "ev",
      verdict: input.verdict === "BLOCK" ? "REJECT" : input.verdict === "PASS" ? "APPROVE" : "WAIT",
      reasonCode: input.reasonCode,
      reasonDetail: input.reasonDetail,
    });
  }
  return input;
}

export function recordScannerUniverseSnapshot(input: { watchlist: string[]; cycleSymbols: string[] }) {
  const session = getOrCreateForensicSession();
  session.scannerUniverseSnapshot = {
    watchlist: input.watchlist.map((row) => row.toUpperCase()),
    cycleSymbols: input.cycleSymbols.map((row) => row.toUpperCase()),
    capturedAt: new Date().toISOString(),
  };
  return session.scannerUniverseSnapshot;
}

export function recordScannerCoverageSnapshot(input: ScannerCoverageSnapshot) {
  const session = getOrCreateForensicSession();
  session.scannerCoverageSnapshots = session.scannerCoverageSnapshots ?? [];
  session.scannerCoverageSnapshots.push(input);
  return input;
}

export function recordMissedOpportunity(input: {
  symbol: string;
  timestamp: string;
  stage: MissedOpportunityStage;
  reasonCode: string;
  reasonDetail: string;
  subsequentMove?: number;
  evidenceRefs?: string[];
}) {
  return recordTerminalOutcome({
    candidateId: createCandidateId(input.symbol, "missed"),
    symbol: input.symbol,
    stage: mapMissedStageToForensic(input.stage),
    verdict: "REJECTED",
    reasonCode: input.reasonCode,
    reasonDetail: input.reasonDetail,
    timestamp: input.timestamp,
    metadata: {
      missedOpportunityStage: input.stage,
      subsequentMove: input.subsequentMove,
      subsequentMoveScope: input.subsequentMove !== undefined ? "POST_ENTRY_ANALYSIS" : undefined,
      evidenceRefs: input.evidenceRefs,
    },
  });
}

function mapMissedStageToForensic(stage: MissedOpportunityStage): ForensicStage {
  switch (stage) {
    case "NOT_DISCOVERED":
    case "DISCOVERED_NOT_QUALIFIED":
      return "scanner";
    case "STRATEGY_REJECTED":
      return "strategy";
    case "EV_REJECTED":
      return "ev";
    case "AI_REJECTED":
      return "ai";
    case "CONSENSUS_REJECTED":
      return "consensus";
    case "RISK_REJECTED":
      return "risk";
    case "SIZING_REJECTED":
    case "CAPITAL_SLOT_REJECTED":
      return "sizing";
    case "EXECUTION_FAILED":
      return "execution";
    default:
      return "decision";
  }
}

export function explainCandidateNotTraded(symbol: string) {
  const session = getForensicSession();
  if (!session) {
    return { found: false, symbol: symbol.toUpperCase(), records: [] as CandidateTerminalRecord[] };
  }
  const records = session.terminals.filter((row) => row.symbol === symbol.toUpperCase());
  return { found: records.length > 0, symbol: symbol.toUpperCase(), records };
}

export function getForensicSessionSnapshot() {
  return getForensicSession();
}
