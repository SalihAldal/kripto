export type PipelineTraceAiStatus = "ADVISORY" | "PASS" | "TIMEOUT" | "NO_OPINION" | "MISSING" | "CONFLICT";

export type CandidatePipelineTrace = {
  candidateId: string;
  symbol: string;
  detectedAt: string;
  updatedAt: string;
  signal: {
    score: number | null;
    lane: string | null;
    reasons: string[];
  };
  ai: {
    decision: string | null;
    confidence: number | null;
    status: PipelineTraceAiStatus | null;
  };
  tdi: {
    decision: string | null;
    confidence: number | null;
    role: "SHADOW" | "ADVISORY";
  };
  risk: {
    verdict: "ALLOW" | "REJECT" | null;
    reasonCodes: string[];
  };
  execution: {
    attempted: boolean;
    orderId: string | null;
    result: string | null;
  };
};

const traces = new Map<string, CandidatePipelineTrace>();
const MAX_TRACES = 5_000;

function nowIso() {
  return new Date().toISOString();
}

function emptyTrace(candidateId: string, symbol: string): CandidatePipelineTrace {
  const timestamp = nowIso();
  return {
    candidateId,
    symbol: symbol.toUpperCase(),
    detectedAt: timestamp,
    updatedAt: timestamp,
    signal: { score: null, lane: null, reasons: [] },
    ai: { decision: null, confidence: null, status: null },
    tdi: { decision: null, confidence: null, role: "SHADOW" },
    risk: { verdict: null, reasonCodes: [] },
    execution: { attempted: false, orderId: null, result: null },
  };
}

export function upsertCandidatePipelineTrace(input: {
  candidateId: string;
  symbol: string;
  signal?: Partial<CandidatePipelineTrace["signal"]>;
  ai?: Partial<CandidatePipelineTrace["ai"]>;
  tdi?: Partial<CandidatePipelineTrace["tdi"]>;
  risk?: Partial<CandidatePipelineTrace["risk"]>;
  execution?: Partial<CandidatePipelineTrace["execution"]>;
}): CandidatePipelineTrace {
  const key = input.candidateId.trim();
  const current = traces.get(key) ?? emptyTrace(key, input.symbol);
  const next: CandidatePipelineTrace = {
    ...current,
    symbol: input.symbol.toUpperCase(),
    updatedAt: nowIso(),
    signal: { ...current.signal, ...input.signal },
    ai: { ...current.ai, ...input.ai },
    tdi: { ...current.tdi, ...input.tdi },
    risk: {
      verdict: input.risk?.verdict ?? current.risk.verdict,
      reasonCodes: input.risk?.reasonCodes ?? current.risk.reasonCodes,
    },
    execution: { ...current.execution, ...input.execution },
  };
  traces.set(key, next);
  if (traces.size > MAX_TRACES) {
    const oldest = traces.keys().next().value;
    if (oldest) traces.delete(oldest);
  }
  return next;
}

export function getCandidatePipelineTrace(candidateId: string): CandidatePipelineTrace | null {
  return traces.get(candidateId.trim()) ?? null;
}

export function findCandidatePipelineTracesBySymbol(symbol: string): CandidatePipelineTrace[] {
  const needle = symbol.toUpperCase();
  return [...traces.values()].filter((row) => row.symbol === needle);
}

export function resetCandidatePipelineTracesForTests(): void {
  traces.clear();
}
