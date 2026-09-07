import { env } from "@/lib/config";
import { formatAIRequest } from "@/src/server/scanner/ai-request-formatter";
import { runAIConsensusFromInput } from "@/src/server/ai/analysis-orchestrator";
import { getRuntimeStrategyParams } from "@/src/server/config/strategy-runtime.service";
import {
  getCanonicalCandidateStore,
  type CanonicalCandidateRecord,
} from "@/src/server/candidate/candidate-store.service";
import type { AiAdvisory } from "@/src/server/microstructure/types";
import type { AIConsensusResult } from "@/src/types/ai";
import type { ScannerCandidate } from "@/src/types/scanner";

export type CandidateHandoffKind = "canonical_opportunity" | "legacy_scanner_consensus";

export type CanonicalHandoffMetadata = {
  handoffKind: CandidateHandoffKind;
  candidateId: string;
  symbol: string;
  venue: string;
  selectedAt: string;
  recordUpdatedAt: number;
  expiresAt: number;
  lane?: string;
  aiAdvisory?: AiAdvisory;
  aiConsensusStatus: "not_requested" | "ready" | "missing" | "hydration_failed" | "hydration_timeout";
  hydrationReasonCode?: string;
};

export type CanonicalHandoffValidationResult =
  | { ok: true; record: CanonicalCandidateRecord }
  | { ok: false; reasonCode: string; reasonDetail: string };

export type CanonicalHandoffHydrationResult = {
  candidate: ScannerCandidate;
  handoff: CanonicalHandoffMetadata;
  aiSource: "preattached" | "hydrated_consensus" | "advisory_shell" | "none";
};

const HANDOFF_META_KEY = "canonicalHandoff";

export function buildCanonicalHandoffMetadata(input: {
  candidateId: string;
  symbol: string;
  record: CanonicalCandidateRecord;
  aiAdvisory?: AiAdvisory;
  aiConsensusStatus?: CanonicalHandoffMetadata["aiConsensusStatus"];
  hydrationReasonCode?: string;
}): CanonicalHandoffMetadata {
  return {
    handoffKind: "canonical_opportunity",
    candidateId: input.candidateId,
    symbol: input.symbol.toUpperCase(),
    venue: env.BINANCE_PLATFORM === "tr" ? "BINANCE_TR" : "BINANCE_GLOBAL",
    selectedAt: new Date().toISOString(),
    recordUpdatedAt: input.record.lastUpdatedAt,
    expiresAt: input.record.expiresAt,
    lane: input.record.lane,
    aiAdvisory: input.aiAdvisory,
    aiConsensusStatus: input.aiConsensusStatus ?? "not_requested",
    hydrationReasonCode: input.hydrationReasonCode,
  };
}

export function parseCanonicalHandoff(candidate: ScannerCandidate | null | undefined): CanonicalHandoffMetadata | null {
  if (!candidate) return null;
  const raw = candidate.context.metadata[HANDOFF_META_KEY];
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Partial<CanonicalHandoffMetadata>;
  if (rec.handoffKind !== "canonical_opportunity" || !rec.candidateId) return null;
  return rec as CanonicalHandoffMetadata;
}

export function attachCanonicalHandoff(candidate: ScannerCandidate, handoff: CanonicalHandoffMetadata): ScannerCandidate {
  return {
    ...candidate,
    context: {
      ...candidate.context,
      metadata: {
        ...candidate.context.metadata,
        opportunityCandidateId: handoff.candidateId,
        canonicalHandoff: handoff,
      },
    },
  };
}

export function validateCanonicalHandoffRecord(
  handoff: CanonicalHandoffMetadata,
  expectedSymbol?: string,
): CanonicalHandoffValidationResult {
  const store = getCanonicalCandidateStore();
  const record = store.getCandidate(handoff.candidateId);
  if (!record) {
    return {
      ok: false,
      reasonCode: "HANDOFF_CANDIDATE_NOT_FOUND",
      reasonDetail: `Canonical record missing for ${handoff.candidateId}`,
    };
  }
  const symbol = handoff.symbol.toUpperCase();
  if (expectedSymbol && expectedSymbol.toUpperCase() !== symbol) {
    return {
      ok: false,
      reasonCode: "HANDOFF_SYMBOL_MISMATCH",
      reasonDetail: `Expected ${expectedSymbol}, handoff has ${symbol}`,
    };
  }
  if (record.symbol.toUpperCase() !== symbol) {
    return {
      ok: false,
      reasonCode: "HANDOFF_IDENTITY_MISMATCH",
      reasonDetail: `Store symbol ${record.symbol} != handoff ${symbol}`,
    };
  }
  const now = Date.now();
  if (record.expiresAt > 0 && now > record.expiresAt) {
    return {
      ok: false,
      reasonCode: "HANDOFF_CANDIDATE_EXPIRED",
      reasonDetail: `Candidate expired at ${new Date(record.expiresAt).toISOString()}`,
    };
  }
  const staleCutoff = now - 60_000;
  if (record.lastUpdatedAt < staleCutoff) {
    return {
      ok: false,
      reasonCode: "HANDOFF_CANDIDATE_STALE",
      reasonDetail: `Last update ${new Date(record.lastUpdatedAt).toISOString()} older than 60s`,
    };
  }
  const executableStates = new Set(["EXECUTION_READY", "FINAL_RANKED", "MICRO_CONFIRMED"]);
  if (!executableStates.has(record.state)) {
    return {
      ok: false,
      reasonCode: "HANDOFF_CANDIDATE_NOT_READY",
      reasonDetail: `Candidate state ${record.state} is not execution-ready`,
    };
  }
  return { ok: true, record };
}

/** Explicit advisory shell — NOT a BUY; used only when real hydration failed under ADVISORY policy. */
export function buildCanonicalAdvisoryAiShell(input: {
  symbol: string;
  lastPrice: number;
  scannerConfidence: number;
  reasonCode: string;
  reasonDetail: string;
}): AIConsensusResult {
  const now = new Date().toISOString();
  return {
    finalDecision: "NO_TRADE",
    finalConfidence: 0,
    finalRiskScore: 0,
    score: 0,
    explanation: `Canonical advisory shell: ${input.reasonDetail}`,
    outputs: [],
    rejected: false,
    rejectReason: input.reasonCode,
    generatedAt: now,
    analysisScorecard: {
      symbol: input.symbol,
      currentPrice: input.lastPrice,
      direction: "WAIT",
      confidenceScore: 0,
      expectedMovePercent: 0,
      expectedMoveRange: { min: 0, max: 0 },
      targetSellPercent: 0,
      initialStopPercent: 0,
      trailingStartPercent: 0,
      trailingGapPercent: 0,
      riskLevel: "MEDIUM",
      reasons: [`scannerConfidence=${input.scannerConfidence}`, input.reasonDetail],
      invalidationReason: input.reasonCode,
      timeHorizonMinutes: 15,
    },
  };
}

export async function hydrateCanonicalHandoffCandidate(input: {
  candidate: ScannerCandidate;
  handoff: CanonicalHandoffMetadata;
  allowAdvisoryShell: boolean;
}): Promise<CanonicalHandoffHydrationResult> {
  let candidate = input.candidate;
  let handoff = { ...input.handoff };

  if (candidate.ai) {
    return {
      candidate,
      handoff: { ...handoff, aiConsensusStatus: "ready" },
      aiSource: "preattached",
    };
  }

  try {
    const runtimeStrategy = await getRuntimeStrategyParams();
    const aiInput = await formatAIRequest(candidate.context, {
      scannerScore: candidate.score.score,
      ...runtimeStrategy,
      executionMode: env.EXECUTION_MODE,
    });
    const ai = await runAIConsensusFromInput(aiInput);
    handoff = {
      ...handoff,
      aiConsensusStatus: "ready",
      hydrationReasonCode: "AI_CONSENSUS_HYDRATED",
    };
    candidate = { ...candidate, ai };
    return { candidate, handoff, aiSource: "hydrated_consensus" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    handoff = {
      ...handoff,
      aiConsensusStatus: "hydration_failed",
      hydrationReasonCode: "AI_HYDRATION_FAILED",
    };
    if (!input.allowAdvisoryShell) {
      return { candidate, handoff, aiSource: "none" };
    }
    const shell = buildCanonicalAdvisoryAiShell({
      symbol: candidate.context.symbol,
      lastPrice: candidate.context.lastPrice,
      scannerConfidence: candidate.score.confidence,
      reasonCode: "AI_HYDRATION_FAILED",
      reasonDetail: detail,
    });
    handoff = {
      ...handoff,
      aiConsensusStatus: "missing",
      hydrationReasonCode: "AI_ADVISORY_SHELL",
    };
    candidate = { ...candidate, ai: shell };
    return { candidate, handoff, aiSource: "advisory_shell" };
  }
}

export function resolveExecutionConfidenceScore(input: {
  selected: ScannerCandidate;
  ai: AIConsensusResult;
  learningLane: boolean;
  requestedDurationSec?: number;
}): number {
  const scorecardConfidenceRaw = Number(input.ai.analysisScorecard?.confidenceScore ?? input.ai.finalConfidence ?? 0);
  const scorecardConfidence = input.learningLane
    ? Math.max(scorecardConfidenceRaw, Number(input.ai.finalConfidence ?? 0))
    : scorecardConfidenceRaw;
  if (scorecardConfidence > 0) return scorecardConfidence;
  const handoff = parseCanonicalHandoff(input.selected);
  if (handoff?.handoffKind === "canonical_opportunity") {
    const scannerConfidence = Number(input.selected.score.confidence ?? 0);
    if (scannerConfidence > 0) return scannerConfidence;
  }
  return scorecardConfidence;
}

/** Entry-quality admission uses AI/scorecard confidence only — never scanner fallback. */
export function resolveEntryQualityConfidenceScore(input: {
  ai: AIConsensusResult;
  learningLane: boolean;
}): number {
  const scorecardConfidenceRaw = Number(input.ai.analysisScorecard?.confidenceScore ?? input.ai.finalConfidence ?? 0);
  return input.learningLane
    ? Math.max(scorecardConfidenceRaw, Number(input.ai.finalConfidence ?? 0))
    : scorecardConfidenceRaw;
}

export function isLegacyScannerConsensusCandidate(candidate: ScannerCandidate): boolean {
  if (parseCanonicalHandoff(candidate)) return false;
  return Boolean(candidate.ai);
}
