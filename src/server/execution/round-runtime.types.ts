import type { AutoRoundState } from "@/src/server/repositories/auto-round.repository";

/** Fine-grained runtime step persisted in job/run metadata. */
export type RoundRuntimeStep =
  | "ROUND_CREATED"
  | "SCANNER_STARTING"
  | "SCANNING"
  | "PUMP_SCAN"
  | "PUMP_CONFIRMATION"
  | "AI_ANALYSIS"
  | "CANDIDATE_REJECTED"
  | "NEXT_CANDIDATE"
  | "FULL_SCAN"
  | "NO_CANDIDATE"
  | "SYMBOL_SELECTED"
  | "EXECUTING"
  | "POSITION_OPEN"
  | "POSITION_MONITORING"
  | "POSITION_CLOSED"
  | "ROUND_COMPLETED"
  | "ROUND_FAILED"
  | "TIMEOUT";

export type RoundTimelineKind =
  | "state"
  | "step"
  | "candidate"
  | "scanner"
  | "ai"
  | "execution"
  | "timeout"
  | "heartbeat";

export type RoundTimelineEntry = {
  at: string;
  kind: RoundTimelineKind;
  step: RoundRuntimeStep;
  message: string;
  symbol?: string;
  pipeline?: string;
  attempt?: number;
  metadata?: Record<string, unknown>;
};

/** Weighted sub-progress values (0–100 each). */
export type RoundProgressBreakdown = {
  selection: number;
  pump: number;
  scanner: number;
  aiAnalysis: number;
  candidateEvaluation: number;
  execution: number;
  positionMonitoring: number;
  intraRound: number;
  overall: number;
};

export type RoundRuntimeSnapshot = {
  step: RoundRuntimeStep;
  message: string;
  coarseState: AutoRoundState;
  currentCandidate?: string;
  currentSymbol?: string;
  candidatesProcessed: number;
  candidatesRemaining?: number;
  scannerTotal?: number;
  pumpProcessed?: number;
  pumpTotal?: number;
  aiProcessed?: number;
  aiTotal?: number;
  executionPhasePct?: number;
  positionHoldSec?: number;
  positionMaxWaitSec?: number;
  currentPipeline?: string;
  currentAiPhase?: string;
  currentScannerPhase?: string;
  retryCount: number;
  selectionAttempt: number;
  roundProgressPct: number;
  intraRoundPct?: number;
  progressBreakdown?: RoundProgressBreakdown;
  elapsedMs: number;
  estimatedRemainingMs?: number;
  estimatedRemainingCandidates?: number;
  projectedCompletionMs?: number | null;
  selectionBudgetMs: number;
  heartbeatAt: string;
  lastProgressAt?: string;
  lastMeaningfulProgressAt?: string;
  lastScannerProgressAt?: string;
  lastMarketDataProgressAt?: string;
  lastPumpProgressAt?: string;
  lastAIProgressAt?: string;
  lastTDIProgressAt?: string;
  lastPersistAt?: string;
  scannerSymbolsProcessed?: number;
  pumpSymbolsProcessed?: number;
  marketDataRequests?: number;
  marketDataFailures?: number;
  fallbackCount?: number;
  aiStarted?: number;
  aiFailed?: number;
  tdiProcessed?: number;
  executionReady?: number;
  dbTransientFailures?: number;
  degradedCandidates?: number;
  roundFatalFailures?: number;
  cancelled?: boolean;
  cancelReason?: string;
  persistenceMetrics?: {
    persistQueueDepth: number;
    persistQueueWaitMs: number;
    dbQueryMs: number;
    dbTransactionMs: number;
    retryCount: number;
    timeoutCount: number;
    writer: "transition" | "heartbeat" | "sync";
    coalescedWrites: number;
  };
  timeline: RoundTimelineEntry[];
};

export type RoundSelectionRuntimeOptions = {
  jobId: string;
  runId: string;
  roundNo: number;
  totalRounds: number;
  selectionStartedAt: number;
  selectionBudgetMs: number;
  selectionAttempt: number;
  shouldStopJob?: () => Promise<boolean>;
  onPersist?: (snapshot: RoundRuntimeSnapshot) => Promise<void>;
};

export type CompositeProgressInput = {
  roundNo: number;
  totalRounds: number;
  step: RoundRuntimeStep;
  selectionAttempt: number;
  maxSelectionAttempts: number;
  retryCount: number;
  candidatesProcessed: number;
  candidatesRemaining?: number;
  scannerTotal?: number;
  pumpProcessed?: number;
  pumpTotal?: number;
  aiProcessed?: number;
  aiTotal?: number;
  executionPhasePct?: number;
  positionHoldSec?: number;
  positionMaxWaitSec?: number;
  currentPipeline?: string;
  currentScannerPhase?: string;
};

export class RoundSelectionAbortError extends Error {
  readonly code: "BUDGET_EXPIRED" | "CANCELLED" | "JOB_STOPPED" | "PERSIST_TIMEOUT";

  constructor(code: RoundSelectionAbortError["code"], message: string) {
    super(message);
    this.name = "RoundSelectionAbortError";
    this.code = code;
  }
}

const INTRA_ROUND_WEIGHTS = {
  selection: 0.08,
  pump: 0.12,
  scanner: 0.28,
  aiAnalysis: 0.12,
  candidateEvaluation: 0.08,
  execution: 0.14,
  positionMonitoring: 0.18,
} as const;

const STEP_PHASE_RANK: Record<RoundRuntimeStep, number> = {
  ROUND_CREATED: 0,
  SCANNER_STARTING: 0,
  PUMP_SCAN: 1,
  PUMP_CONFIRMATION: 1,
  AI_ANALYSIS: 2,
  CANDIDATE_REJECTED: 3,
  NEXT_CANDIDATE: 3,
  FULL_SCAN: 4,
  NO_CANDIDATE: 5,
  SCANNING: 4,
  SYMBOL_SELECTED: 5,
  EXECUTING: 6,
  POSITION_OPEN: 7,
  POSITION_MONITORING: 7,
  POSITION_CLOSED: 8,
  ROUND_COMPLETED: 9,
  ROUND_FAILED: 9,
  TIMEOUT: 9,
};

function clampPct(value: number) {
  return Number(Math.max(0, Math.min(100, value)).toFixed(2));
}

function ratioPct(processed: number, total: number) {
  if (!Number.isFinite(processed) || !Number.isFinite(total) || total <= 0) return 0;
  return clampPct((processed / total) * 100);
}

function stepRank(step: RoundRuntimeStep) {
  return STEP_PHASE_RANK[step] ?? 0;
}

function resolveScannerTotal(input: CompositeProgressInput) {
  if (Number.isFinite(input.scannerTotal) && Number(input.scannerTotal) > 0) {
    return Number(input.scannerTotal);
  }
  return Math.max(0, input.candidatesProcessed) + Math.max(0, input.candidatesRemaining ?? 0);
}

function resolveSelectionProgress(input: CompositeProgressInput) {
  const rank = stepRank(input.step);
  if (rank > 0) return 100;
  const attemptRatio = ratioPct(Math.max(0, input.selectionAttempt - 1), input.maxSelectionAttempts);
  if (input.step === "SCANNER_STARTING") return clampPct(Math.max(attemptRatio, 55));
  return clampPct(Math.max(attemptRatio, 15));
}

function resolvePumpProgress(input: CompositeProgressInput) {
  const rank = stepRank(input.step);
  if (rank > 1) return 100;
  if (rank < 1) return 0;

  const total = Math.max(
    0,
    input.pumpTotal ?? resolveScannerTotal(input),
  );
  const processed = Math.max(0, input.pumpProcessed ?? input.candidatesProcessed);

  if (total > 0) {
    const scanPct = ratioPct(processed, total);
    if (input.step === "PUMP_CONFIRMATION" || (input.step === "AI_ANALYSIS" && String(input.currentPipeline ?? "").includes("pump"))) {
      return clampPct(40 + scanPct * 0.6);
    }
    return scanPct;
  }

  if (input.step === "PUMP_CONFIRMATION") return 72;
  if (input.step === "PUMP_SCAN") return 38;
  return 0;
}

function resolveScannerProgress(input: CompositeProgressInput) {
  const rank = stepRank(input.step);
  if (rank > 4) return 100;
  if (rank < 4) return 0;

  const total = resolveScannerTotal(input);
  const phase = String(input.currentScannerPhase ?? "");
  if (phase === "discovery" && total > 0) {
    return ratioPct(input.candidatesProcessed, total);
  }
  if ((phase === "ai" || phase === "consensus") && Number(input.aiTotal) > 0) {
    return ratioPct(Number(input.aiProcessed ?? input.candidatesProcessed), Number(input.aiTotal));
  }
  if (phase === "ai" && Number(input.aiTotal) > 0) {
    return ratioPct(Number(input.aiProcessed ?? input.candidatesProcessed), Number(input.aiTotal));
  }
  return ratioPct(input.candidatesProcessed, total);
}

function resolveAiProgress(input: CompositeProgressInput) {
  const phase = String(input.currentScannerPhase ?? "");
  if (phase === "ai" || phase === "consensus" || input.step === "AI_ANALYSIS") {
    if (Number(input.aiTotal) > 0) {
      return ratioPct(Number(input.aiProcessed ?? 0), Number(input.aiTotal));
    }
    if (phase === "consensus") return 55;
    if (phase === "ai" && input.candidatesProcessed > 0) {
      return ratioPct(input.candidatesProcessed, resolveScannerTotal(input));
    }
    return 0;
  }
  const rank = stepRank(input.step);
  if (rank > 4) return 100;
  return 0;
}

function resolveCandidateEvaluationProgress(input: CompositeProgressInput) {
  const rank = stepRank(input.step);
  if (rank > 3) return 100;
  if (rank < 3) return 0;

  const retryPct = ratioPct(input.retryCount, Math.max(1, input.maxSelectionAttempts * 2));
  const attemptPct = ratioPct(input.selectionAttempt, input.maxSelectionAttempts);
  if (input.step === "NEXT_CANDIDATE") return clampPct(Math.max(retryPct, attemptPct * 0.7));
  return clampPct(Math.max(retryPct, attemptPct * 0.45));
}

function resolveExecutionProgress(input: CompositeProgressInput) {
  const rank = stepRank(input.step);
  if (rank > 6) return 100;
  if (rank < 6) return 0;
  if (typeof input.executionPhasePct === "number") {
    return clampPct(input.executionPhasePct);
  }
  if (input.step === "EXECUTING") return 45;
  if (input.step === "SYMBOL_SELECTED") return 88;
  return 0;
}

function resolvePositionMonitoringProgress(input: CompositeProgressInput) {
  const rank = stepRank(input.step);
  if (rank >= 8) return 100;
  if (rank < 7) return 0;

  const maxWait = Number(input.positionMaxWaitSec ?? 0);
  const holdSec = Number(input.positionHoldSec ?? 0);
  if (maxWait > 0 && holdSec >= 0) {
    return ratioPct(holdSec, maxWait);
  }
  if (input.step === "POSITION_MONITORING") return 55;
  if (input.step === "POSITION_OPEN") return 28;
  return 12;
}

export function computeCompositeRoundProgress(input: CompositeProgressInput): RoundProgressBreakdown {
  const selection = resolveSelectionProgress(input);
  const pump = resolvePumpProgress(input);
  const scanner = resolveScannerProgress(input);
  const aiAnalysis = resolveAiProgress(input);
  const candidateEvaluation = resolveCandidateEvaluationProgress(input);
  const execution = resolveExecutionProgress(input);
  const positionMonitoring = resolvePositionMonitoringProgress(input);

  const intraRound = clampPct(
    selection * INTRA_ROUND_WEIGHTS.selection +
      pump * INTRA_ROUND_WEIGHTS.pump +
      scanner * INTRA_ROUND_WEIGHTS.scanner +
      aiAnalysis * INTRA_ROUND_WEIGHTS.aiAnalysis +
      candidateEvaluation * INTRA_ROUND_WEIGHTS.candidateEvaluation +
      execution * INTRA_ROUND_WEIGHTS.execution +
      positionMonitoring * INTRA_ROUND_WEIGHTS.positionMonitoring,
  );

  const roundBase = ((input.roundNo - 1) / Math.max(1, input.totalRounds)) * 100;
  const roundSlice = 100 / Math.max(1, input.totalRounds);
  const overall = clampPct(roundBase + roundSlice * (intraRound / 100));

  return {
    selection,
    pump,
    scanner,
    aiAnalysis,
    candidateEvaluation,
    execution,
    positionMonitoring,
    intraRound,
    overall,
  };
}

/** Backward-compatible overall progress entry point. */
export function computeRoundProgressPct(input: CompositeProgressInput) {
  return computeCompositeRoundProgress(input).overall;
}

export function snapshotToCompositeInput(
  snapshot: Pick<
    RoundRuntimeSnapshot,
    | "step"
    | "selectionAttempt"
    | "retryCount"
    | "candidatesProcessed"
    | "candidatesRemaining"
    | "scannerTotal"
    | "pumpProcessed"
    | "pumpTotal"
    | "aiProcessed"
    | "aiTotal"
    | "executionPhasePct"
    | "positionHoldSec"
    | "positionMaxWaitSec"
    | "currentPipeline"
    | "currentScannerPhase"
  >,
  context: { roundNo: number; totalRounds: number; maxSelectionAttempts: number },
): CompositeProgressInput {
  return {
    roundNo: context.roundNo,
    totalRounds: context.totalRounds,
    step: snapshot.step,
    selectionAttempt: snapshot.selectionAttempt,
    maxSelectionAttempts: context.maxSelectionAttempts,
    retryCount: snapshot.retryCount,
    candidatesProcessed: snapshot.candidatesProcessed,
    candidatesRemaining: snapshot.candidatesRemaining,
    scannerTotal: snapshot.scannerTotal,
    pumpProcessed: snapshot.pumpProcessed,
    pumpTotal: snapshot.pumpTotal,
    aiProcessed: snapshot.aiProcessed,
    aiTotal: snapshot.aiTotal,
    executionPhasePct: snapshot.executionPhasePct,
    positionHoldSec: snapshot.positionHoldSec,
    positionMaxWaitSec: snapshot.positionMaxWaitSec,
    currentPipeline: snapshot.currentPipeline,
    currentScannerPhase: snapshot.currentScannerPhase,
  };
}

export function mapRuntimeStepToCoarseState(step: RoundRuntimeStep): AutoRoundState {
  switch (step) {
    case "SYMBOL_SELECTED":
      return "coin_secildi";
    case "EXECUTING":
      return "coin_secildi";
    case "POSITION_OPEN":
    case "POSITION_MONITORING":
      return "alim_yapildi";
    case "POSITION_CLOSED":
      return "satis_gerceklesti";
    case "ROUND_COMPLETED":
      return "tur_tamamlandi";
    case "ROUND_FAILED":
    case "TIMEOUT":
      return "tur_basarisiz";
    default:
      return "tariyor";
  }
}
