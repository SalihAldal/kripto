import { AsyncLocalStorage } from "node:async_hooks";
import type {
  AiCallAudit,
  CandidateTerminalRecord,
  CandidateTraceRecord,
  ConsensusAudit,
  DecisionTraceRecord,
  EvAudit,
  NativePaperDiagnostics,
  PaperOrderAudit,
  PaperSessionSnapshot,
  PnlLedgerEntry,
  RiskSizingTrace,
  ScannerCycleSummary,
  SimulationIntegrityReport,
  MeanReversionEntryRecord,
  ScannerQualificationRejection,
  NotDiscoveredAnalysisRecord,
  EntryTimingRecord,
  ScannerCoverageSnapshot,
  TdiDecisionRecord,
  FeeAwareEntryPolicyEvaluation,
} from "@/src/server/forensics/forensic.types";

export type ForensicSessionContext = {
  sessionId: string;
  roundId?: string;
  jobId?: string;
  runId?: string;
  mode: "paper" | "live" | "simulation";
  startedAt: string;
  terminals: CandidateTerminalRecord[];
  scannerCycles: ScannerCycleSummary[];
  candidates: CandidateTraceRecord[];
  aiCalls: AiCallAudit[];
  consensus: ConsensusAudit[];
  evAudits: EvAudit[];
  decisions: DecisionTraceRecord[];
  riskSizing: RiskSizingTrace[];
  orders: PaperOrderAudit[];
  pnlEntries: PnlLedgerEntry[];
  meanReversionEntries?: MeanReversionEntryRecord[];
  scannerQualificationRejections?: ScannerQualificationRejection[];
  notDiscoveredRecords?: NotDiscoveredAnalysisRecord[];
  entryTimingRecords?: EntryTimingRecord[];
  scannerCoverageSnapshots?: ScannerCoverageSnapshot[];
  tdiDecisions?: TdiDecisionRecord[];
  feePolicyEvaluations?: FeeAwareEntryPolicyEvaluation[];
  scannerUniverseSnapshot?: {
    watchlist: string[];
    cycleSymbols: string[];
    capturedAt: string;
  };
  sessionState?: PaperSessionSnapshot;
  simulationIntegrity?: SimulationIntegrityReport;
  rejectionCountsByStage: Record<string, number>;
  rejectionCountsByReason: Record<string, number>;
};

const forensicStorage = new AsyncLocalStorage<ForensicSessionContext>();
let moduleForensicSession: ForensicSessionContext | null = null;

export function runWithForensicSession<T>(ctx: ForensicSessionContext, fn: () => Promise<T>): Promise<T> {
  moduleForensicSession = ctx;
  return forensicStorage.run(ctx, fn).finally(() => {
    if (moduleForensicSession === ctx) moduleForensicSession = null;
  });
}

export function setForensicSession(session: ForensicSessionContext) {
  moduleForensicSession = session;
}

export function clearForensicSession() {
  moduleForensicSession = null;
}

export function getForensicSession(): ForensicSessionContext | undefined {
  return forensicStorage.getStore() ?? moduleForensicSession ?? undefined;
}

export function ensureForensicSession(input?: Partial<ForensicSessionContext>): ForensicSessionContext {
  const existing = getForensicSession();
  if (existing) return existing;
  const session: ForensicSessionContext = {
    sessionId: input?.sessionId ?? `forensic-${Date.now()}`,
    roundId: input?.roundId,
    jobId: input?.jobId,
    runId: input?.runId,
    mode: input?.mode ?? "paper",
    startedAt: input?.startedAt ?? new Date().toISOString(),
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
    scannerCoverageSnapshots: [],
    tdiDecisions: [],
    feePolicyEvaluations: [],
    rejectionCountsByStage: {},
    rejectionCountsByReason: {},
    sessionState: input?.sessionState,
  };
  moduleForensicSession = session;
  return session;
}

export function attachForensicRound(input: { runId: string; roundId?: string; jobId?: string }) {
  const session = getForensicSession();
  if (!session) return null;
  session.runId = input.runId;
  session.roundId = input.roundId ?? input.runId;
  if (input.jobId) session.jobId = input.jobId;
  return session;
}

export function getOrCreateForensicSession(input?: Partial<ForensicSessionContext>): ForensicSessionContext {
  return getForensicSession() ?? ensureForensicSession(input);
}
