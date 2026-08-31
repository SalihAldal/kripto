import { createCandidateId } from "@/src/server/forensics/forensic-collector.service";
import { getForensicSession } from "@/src/server/forensics/forensic-context";
import { normalizeAiDecision } from "@/src/server/execution/ai-execution-gate.service";

export type FunnelStage =
  | "scanner"
  | "paper_lane"
  | "tdi"
  | "scanner_ai"
  | "tdi_skip"
  | "execution_ai"
  | "consensus"
  | "master"
  | "ev"
  | "risk"
  | "sizing"
  | "execution";

export type CandidateFunnelTrace = {
  candidateId: string;
  runId?: string;
  roundId?: string;
  symbol: string;
  stage: FunnelStage;
  timestamp: string;
  verdict: string;
  reasonCode: string;
  reasonDetail: string;
  metadata?: Record<string, unknown>;
};

const funnelTraces: CandidateFunnelTrace[] = [];

function resolveScope(input: { runId?: string; roundId?: string; symbol: string; stage: FunnelStage }) {
  const session = getForensicSession();
  return {
    candidateId: createCandidateId(input.symbol, input.stage),
    runId: input.runId ?? session?.runId,
    roundId: input.roundId ?? session?.roundId,
  };
}

export function recordCandidateFunnelStage(input: {
  symbol: string;
  stage: FunnelStage;
  verdict: string;
  reasonCode: string;
  reasonDetail: string;
  runId?: string;
  roundId?: string;
  candidateId?: string;
  metadata?: Record<string, unknown>;
}) {
  const scope = resolveScope({
    runId: input.runId,
    roundId: input.roundId,
    symbol: input.symbol,
    stage: input.stage,
  });
  const record: CandidateFunnelTrace = {
    candidateId: input.candidateId ?? scope.candidateId,
    runId: scope.runId,
    roundId: scope.roundId,
    symbol: input.symbol.toUpperCase(),
    stage: input.stage,
    timestamp: new Date().toISOString(),
    verdict: input.verdict,
    reasonCode: input.reasonCode,
    reasonDetail: input.reasonDetail,
    metadata: input.metadata,
  };
  funnelTraces.push(record);
  if (funnelTraces.length > 10000) funnelTraces.shift();
  return record;
}

export type SelectionAiBlockClassification = {
  category: "SCANNER_AI_PRE_TDI_BLOCK" | "EXECUTION_AI_VETO" | "AI_DECISION_CONFLICT" | "AI_NOT_EXECUTABLE";
  reasonCode: string;
  tdiEntered: false;
  tdiSkipReason: string;
  scannerAiReached: true;
  executionAiReached: false;
};

export function classifySelectionScannerAiBlock(input: {
  aiFinalDecision: string;
  aiExplanation?: string;
  consensusDecision?: string | null;
}): SelectionAiBlockClassification {
  const decision = normalizeAiDecision(input.aiFinalDecision) || "EMPTY";
  const consensus = input.consensusDecision ? normalizeAiDecision(input.consensusDecision) : null;
  if (consensus && decision && consensus !== decision) {
    return {
      category: "AI_DECISION_CONFLICT",
      reasonCode: "AI_DECISION_CONFLICT",
      tdiEntered: false,
      tdiSkipReason: "PRE_EXECUTION_SCANNER_AI_CONFLICT",
      scannerAiReached: true,
      executionAiReached: false,
    };
  }
  return {
    category: "SCANNER_AI_PRE_TDI_BLOCK",
    reasonCode: "SCANNER_AI_PRE_TDI_BLOCK",
    tdiEntered: false,
    tdiSkipReason: "EXECUTION_NOT_REACHED_SCANNER_AI_NO_TRADE",
    scannerAiReached: true,
    executionAiReached: false,
  };
}

export function isTerminalNonExecutableReason(reason: string): boolean {
  const upper = reason.toUpperCase();
  return (
    upper.includes("NO_TRADE") ||
    upper.includes("NO TRADE") ||
    upper.includes("NON_EXECUTABLE") ||
    upper.includes("NO_CANDIDATE") ||
    upper.includes("UYGUN COIN")
  );
}

export function summarizeFunnelTraces(runId?: string) {
  const rows = runId ? funnelTraces.filter((row) => row.runId === runId) : [...funnelTraces];
  const scannerAiReached = rows.filter((row) => row.stage === "scanner_ai").length;
  const tdiEntered = rows.filter((row) => row.stage === "tdi").length;
  const tdiSkipped = rows.filter((row) => row.stage === "tdi_skip").length;
  const tdiApproved = rows.filter((row) => row.stage === "tdi" && row.verdict === "APPROVED").length;
  const executionAiReached = rows.filter((row) => row.stage === "execution_ai").length;
  const executionReady = rows.filter((row) => row.stage === "execution" && row.verdict === "READY").length;
  return {
    scannerAiReached,
    tdiEntered,
    tdiSkipped,
    tdiApproved,
    executionAiReached,
    executionReady,
    traces: rows,
  };
}

export function getCandidateFunnelTraces(runId?: string) {
  if (!runId) return [...funnelTraces];
  return funnelTraces.filter((row) => row.runId === runId);
}

export function resetCandidateFunnelTraces() {
  funnelTraces.length = 0;
}
