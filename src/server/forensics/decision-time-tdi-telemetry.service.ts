import { createHash } from "node:crypto";
import type { AIConsensusResult } from "@/src/types/ai";
import type { ScannerCandidate } from "@/src/types/scanner";
import { scoreMomentumImpulse } from "@/src/server/decision-engine/experts/momentum-expert.utils";
import type { AIAnalysisInput } from "@/src/types/ai";

export const DECISION_FEATURE_SNAPSHOT_SCHEMA_VERSION = "decision-feature-snapshot-v1" as const;
export const MOMENTUM_FORMULA_VERSION = "scoreMomentumImpulse-v1" as const;

export type DecisionFeatureFieldState = "AVAILABLE" | "MISSING" | "STALE" | "INVALID" | "UNAVAILABLE";

export type DecisionFeatureField<T> = {
  value: T | null;
  state: DecisionFeatureFieldState;
  source: string;
  timestamp: string | null;
  freshnessMs: number | null;
  unit: string | null;
};

export type DecisionFeatureSnapshot = {
  schemaVersion: typeof DECISION_FEATURE_SNAPSHOT_SCHEMA_VERSION;
  decisionFeatureHash: string;
  capturedAt: string;
  decisionTimestamp: string;
  candidateTimestamp: string | null;
  candidateId: string;
  roundId: string | null;
  runId: string | null;
  sessionId: string | null;
  decisionId: string;
  positionId: string | null;
  tradeId: string | null;
  momentumFormulaVersion: typeof MOMENTUM_FORMULA_VERSION;
  momentumRaw: {
    shortMomentum: DecisionFeatureField<number>;
    change5m: DecisionFeatureField<number>;
    change15m: DecisionFeatureField<number>;
  };
  momentumScore: DecisionFeatureField<number>;
  momentumScorePartialInputs: boolean;
  shortFlow: DecisionFeatureField<number>;
  technicalScore: DecisionFeatureField<number>;
  technicalFormulaVersion: string | null;
  sentimentScore: DecisionFeatureField<number>;
  confidence: {
    aiConfidence: DecisionFeatureField<number>;
    finalConfidence: DecisionFeatureField<number>;
    consensusConfidence: DecisionFeatureField<number>;
  };
  learningScore: DecisionFeatureField<number>;
  mtf: {
    mtfAlignment: DecisionFeatureField<number>;
    mtfScore: DecisionFeatureField<number>;
    mtfState: DecisionFeatureField<string>;
    mtfTimestamp: DecisionFeatureField<string>;
  };
  regime: DecisionFeatureField<string>;
  volume: DecisionFeatureField<number>;
  liquidity: DecisionFeatureField<number>;
  spread: DecisionFeatureField<number>;
  expectedValue: DecisionFeatureField<number>;
};

export type BuildDecisionFeatureSnapshotInput = {
  candidate: ScannerCandidate;
  ai: AIConsensusResult;
  decisionId: string;
  candidateId: string;
  roundId?: string | null;
  runId?: string | null;
  sessionId?: string | null;
  positionId?: string | null;
  tradeId?: string | null;
  decisionTimestamp?: string;
  regime?: string;
  marketRegimeReason?: string;
};

function optionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return value;
}

function resolveFreshnessMs(featureTimestamp: string | null, decisionTimestamp: string): number | null {
  if (!featureTimestamp) return null;
  const delta = new Date(decisionTimestamp).getTime() - new Date(featureTimestamp).getTime();
  return Number.isFinite(delta) ? Math.max(0, delta) : null;
}

export function buildDecisionFeatureField<T extends string | number>(
  value: T | null | undefined,
  input: {
    source: string;
    unit: string | null;
    decisionTimestamp: string;
    featureTimestamp?: string | null;
    staleAfterMs?: number;
  },
): DecisionFeatureField<T> {
  if (value === null || value === undefined) {
    return {
      value: null,
      state: "MISSING",
      source: input.source,
      timestamp: null,
      freshnessMs: null,
      unit: input.unit,
    };
  }
  const featureTimestamp = input.featureTimestamp ?? input.decisionTimestamp;
  const freshnessMs = resolveFreshnessMs(featureTimestamp, input.decisionTimestamp);
  const stale =
    typeof input.staleAfterMs === "number" &&
    freshnessMs !== null &&
    freshnessMs > input.staleAfterMs;
  return {
    value,
    state: stale ? "STALE" : "AVAILABLE",
    source: input.source,
    timestamp: featureTimestamp,
    freshnessMs,
    unit: input.unit,
  };
}

export function computeDecisionFeatureHash(input: {
  candidateId: string;
  roundId: string | null;
  decisionTimestamp: string;
  momentumScore: number | null;
  shortMomentum: number | null;
  shortFlow: number | null;
  change5m: number | null;
  change15m: number | null;
  technicalScore: number | null;
  confidence: number | null;
  mtfScore: number | null;
}): string {
  const payload = [
    input.candidateId,
    input.roundId ?? "",
    input.decisionTimestamp,
    input.momentumScore ?? "null",
    input.shortMomentum ?? "null",
    input.shortFlow ?? "null",
    input.change5m ?? "null",
    input.change15m ?? "null",
    input.technicalScore ?? "null",
    input.confidence ?? "null",
    input.mtfScore ?? "null",
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

export function computeMomentumScoreForSnapshot(input: {
  shortMomentum: number | null;
  change5m: number | null;
  change15m: number | null;
}): { value: number | null; partialInputs: boolean } {
  const partialInputs =
    input.shortMomentum === null || input.change5m === null || input.change15m === null;
  const score = scoreMomentumImpulse({
    symbol: "SNAPSHOT",
    marketSignals: {
      shortMomentumPercent: input.shortMomentum ?? undefined,
      change5m: input.change5m ?? undefined,
      change15m: input.change15m ?? undefined,
    },
  } as AIAnalysisInput);
  return {
    value: Number.isFinite(score) ? Number(score.toFixed(6)) : null,
    partialInputs,
  };
}

export function buildDecisionFeatureSnapshot(input: BuildDecisionFeatureSnapshotInput): DecisionFeatureSnapshot {
  const metadata = input.candidate.context.metadata;
  const decisionTimestamp = input.decisionTimestamp ?? input.ai.generatedAt ?? new Date().toISOString();
  const candidateTimestamp = optionalString(metadata.candidateTimestamp);
  const roleScores = Array.isArray(input.ai.roleScores) ? input.ai.roleScores : [];
  const technicalRole = roleScores.find((row) => row.role === "AI-1_TECHNICAL");
  const sentimentRole = roleScores.find((row) => row.role === "AI-2_SENTIMENT");
  const timeframe = input.ai.decisionPayload?.timeframeAnalysis;
  const masterMatrix =
    input.ai.decisionPayload?.masterDecisionEngine &&
    typeof input.ai.decisionPayload.masterDecisionEngine === "object" &&
    input.ai.decisionPayload.masterDecisionEngine !== null &&
    typeof (input.ai.decisionPayload.masterDecisionEngine as Record<string, unknown>).matrix === "object"
      ? ((input.ai.decisionPayload.masterDecisionEngine as Record<string, unknown>).matrix as Record<string, unknown>)
      : null;
  const learningRaw = masterMatrix ? optionalNumber(masterMatrix.learning) : null;

  const shortMomentum = optionalNumber(metadata.shortMomentumPercent);
  const shortFlow = optionalNumber(metadata.shortFlowImbalance);
  const change5m = optionalNumber(metadata.change5m);
  const change15m = optionalNumber(metadata.change15m);
  const technicalScore = optionalNumber(technicalRole?.score);
  const sentimentScore = optionalNumber(sentimentRole?.score);
  const aiConfidence = optionalNumber(metadata.aiConfidence ?? input.ai.finalConfidence);
  const finalConfidence = optionalNumber(input.ai.finalConfidence);
  const consensusConfidence = optionalNumber(input.ai.finalConsensusConfidence);
  const mtfAlignment = optionalNumber(metadata.mtfAlignmentScore ?? timeframe?.alignmentScore);
  const mtfScore = optionalNumber(timeframe?.alignmentScore ?? metadata.mtfAlignmentScore);
  const mtfState = optionalString(timeframe?.dominantTrend ?? metadata.mtfDominantTrend);
  const mtfTimestamp = optionalString(timeframe?.capturedAt ?? metadata.mtfCapturedAt);
  const regime = optionalString(input.regime ?? metadata.marketRegime);
  const volume = optionalNumber(input.candidate.context.volume24h);
  const liquidity = optionalNumber(metadata.effectiveLiquidity24h ?? input.candidate.context.volume24h);
  const spread = optionalNumber(input.candidate.context.spreadPercent);
  const expectedValue = optionalNumber(input.ai.score);

  const momentumComputed = computeMomentumScoreForSnapshot({ shortMomentum, change5m, change15m });

  const snapshotCore = {
    candidateId: input.candidateId,
    roundId: input.roundId ?? null,
    decisionTimestamp,
    momentumScore: momentumComputed.value,
    shortMomentum,
    shortFlow,
    change5m,
    change15m,
    technicalScore,
    confidence: finalConfidence,
    mtfScore: mtfAlignment ?? mtfScore,
  };

  const snapshot: DecisionFeatureSnapshot = {
    schemaVersion: DECISION_FEATURE_SNAPSHOT_SCHEMA_VERSION,
    decisionFeatureHash: computeDecisionFeatureHash(snapshotCore),
    capturedAt: new Date().toISOString(),
    decisionTimestamp,
    candidateTimestamp,
    candidateId: input.candidateId,
    roundId: input.roundId ?? optionalString(metadata.roundId) ?? null,
    runId: input.runId ?? optionalString(metadata.runId) ?? null,
    sessionId: input.sessionId ?? optionalString(metadata.sessionId ?? metadata.jobId) ?? null,
    decisionId: input.decisionId,
    positionId: input.positionId ?? null,
    tradeId: input.tradeId ?? null,
    momentumFormulaVersion: MOMENTUM_FORMULA_VERSION,
    momentumRaw: {
      shortMomentum: buildDecisionFeatureField(shortMomentum, {
        source: "candidate.context.metadata.shortMomentumPercent",
        unit: "percent_points",
        decisionTimestamp,
        featureTimestamp: candidateTimestamp,
      }),
      change5m: buildDecisionFeatureField(change5m, {
        source: "candidate.context.metadata.change5m",
        unit: "percent_points",
        decisionTimestamp,
        featureTimestamp: candidateTimestamp,
      }),
      change15m: buildDecisionFeatureField(change15m, {
        source: "candidate.context.metadata.change15m",
        unit: "percent_points",
        decisionTimestamp,
        featureTimestamp: candidateTimestamp,
      }),
    },
    momentumScore: buildDecisionFeatureField(momentumComputed.value, {
      source: "scoreMomentumImpulse",
      unit: "score_0_100",
      decisionTimestamp,
      featureTimestamp: decisionTimestamp,
    }),
    momentumScorePartialInputs: momentumComputed.partialInputs,
    shortFlow: buildDecisionFeatureField(shortFlow, {
      source: "candidate.context.metadata.shortFlowImbalance",
      unit: "ratio_-1_1",
      decisionTimestamp,
      featureTimestamp: candidateTimestamp,
    }),
    technicalScore: buildDecisionFeatureField(technicalScore, {
      source: "ai.roleScores.AI-1_TECHNICAL",
      unit: "score_0_100",
      decisionTimestamp,
      featureTimestamp: decisionTimestamp,
    }),
    technicalFormulaVersion: technicalScore !== null ? "hybrid-role-technical-v1" : null,
    sentimentScore: buildDecisionFeatureField(sentimentScore, {
      source: "ai.roleScores.AI-2_SENTIMENT",
      unit: "score_0_100",
      decisionTimestamp,
      featureTimestamp: decisionTimestamp,
    }),
    confidence: {
      aiConfidence: buildDecisionFeatureField(aiConfidence, {
        source: "metadata.aiConfidence|ai.finalConfidence",
        unit: "score_0_100",
        decisionTimestamp,
        featureTimestamp: decisionTimestamp,
      }),
      finalConfidence: buildDecisionFeatureField(finalConfidence, {
        source: "ai.finalConfidence",
        unit: "score_0_100",
        decisionTimestamp,
        featureTimestamp: decisionTimestamp,
      }),
      consensusConfidence: buildDecisionFeatureField(consensusConfidence, {
        source: "ai.finalConsensusConfidence",
        unit: "score_0_100",
        decisionTimestamp,
        featureTimestamp: decisionTimestamp,
      }),
    },
    learningScore: buildDecisionFeatureField(learningRaw, {
      source: "masterDecisionEngine.matrix.learning",
      unit: "score_0_100",
      decisionTimestamp,
      featureTimestamp: decisionTimestamp,
    }),
    mtf: {
      mtfAlignment: buildDecisionFeatureField(mtfAlignment, {
        source: "metadata.mtfAlignmentScore|timeframeAnalysis.alignmentScore",
        unit: "score_0_100",
        decisionTimestamp,
        featureTimestamp: mtfTimestamp,
      }),
      mtfScore: buildDecisionFeatureField(mtfScore, {
        source: "timeframeAnalysis.alignmentScore",
        unit: "score_0_100",
        decisionTimestamp,
        featureTimestamp: mtfTimestamp,
      }),
      mtfState: buildDecisionFeatureField(mtfState, {
        source: "timeframeAnalysis.dominantTrend",
        unit: "enum",
        decisionTimestamp,
        featureTimestamp: mtfTimestamp,
      }),
      mtfTimestamp: buildDecisionFeatureField(mtfTimestamp, {
        source: "timeframeAnalysis.capturedAt",
        unit: "iso_timestamp",
        decisionTimestamp,
        featureTimestamp: mtfTimestamp,
      }),
    },
    regime: buildDecisionFeatureField(regime, {
      source: "marketRegime.mode|metadata.marketRegime",
      unit: "enum",
      decisionTimestamp,
      featureTimestamp: decisionTimestamp,
    }),
    volume: buildDecisionFeatureField(volume, {
      source: "candidate.context.volume24h",
      unit: "quote_volume",
      decisionTimestamp,
      featureTimestamp: candidateTimestamp,
    }),
    liquidity: buildDecisionFeatureField(liquidity, {
      source: "metadata.effectiveLiquidity24h|volume24h",
      unit: "quote_volume",
      decisionTimestamp,
      featureTimestamp: candidateTimestamp,
    }),
    spread: buildDecisionFeatureField(spread, {
      source: "candidate.context.spreadPercent",
      unit: "percent_points",
      decisionTimestamp,
      featureTimestamp: candidateTimestamp,
    }),
    expectedValue: buildDecisionFeatureField(expectedValue, {
      source: "ai.score",
      unit: "composite_score",
      decisionTimestamp,
      featureTimestamp: decisionTimestamp,
    }),
  };

  return Object.freeze(snapshot);
}

export function freezeDecisionFeatureSnapshot(snapshot: DecisionFeatureSnapshot): DecisionFeatureSnapshot {
  return Object.freeze(snapshot);
}

export function preserveDecisionFeatureSnapshot(
  existing: Record<string, unknown> | null | undefined,
  update: Record<string, unknown>,
): Record<string, unknown> {
  const base = { ...(existing ?? {}) };
  const preserved = base.decisionFeatureSnapshot;
  const next = { ...base, ...update };
  if (preserved !== undefined) {
    next.decisionFeatureSnapshot = preserved;
  }
  return next;
}

export function attachPositionIdToSnapshot(
  snapshot: DecisionFeatureSnapshot,
  positionId: string,
): DecisionFeatureSnapshot {
  return Object.freeze({
    ...snapshot,
    positionId,
  });
}

export function verifyMomentumFormulaParity(snapshot: DecisionFeatureSnapshot): boolean {
  const shortMomentum = snapshot.momentumRaw.shortMomentum.value;
  const change5m = snapshot.momentumRaw.change5m.value;
  const change15m = snapshot.momentumRaw.change15m.value;
  const stored = snapshot.momentumScore.value;
  if (stored === null) return false;
  const recomputed = computeMomentumScoreForSnapshot({ shortMomentum, change5m, change15m }).value;
  if (recomputed === null) return false;
  return Math.abs(stored - recomputed) < 1e-6;
}
