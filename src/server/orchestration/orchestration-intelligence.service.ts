import type { OrchestrationAction } from "@prisma/client";
import type { SignalQualityResult } from "@/src/server/execution/signal-quality-gate.service";
import { persistOrchestrationEnvelope } from "@/src/server/orchestration/orchestration-persistence.service";
import { buildSelfPerformanceSnapshot } from "@/src/server/orchestration/self-performance-intelligence.service";
import { buildTradeClusterSnapshot } from "@/src/server/orchestration/trade-cluster-intelligence.service";
import { evaluateUncertainty } from "@/src/server/orchestration/uncertainty-engine";
import {
  ORCHESTRATION_VERSIONS,
  type OrchestrationAdaptiveRecommendation,
  type OrchestrationPersistenceEnvelope,
  type OrchestrationReasonMap,
} from "@/src/server/orchestration/orchestration-types";
import type { AIConsensusResult } from "@/src/types/ai";
import type { ScannerCandidate } from "@/src/types/scanner";

export type OrchestrationEvaluationResult = {
  action: OrchestrationAction;
  confidenceAdjusted: number;
  confidencePenalty: number;
  riskMultiplier: number;
  suppressionScore: number;
  orchestrationScore: number;
  uncertaintyScore: number;
  edgeHealthScore: number;
  clusterRiskScore: number;
  vetoLayer?: string;
  vetoReasons: string[];
  reasonMap: OrchestrationReasonMap;
  adaptiveActions: OrchestrationAdaptiveRecommendation[];
  envelope: OrchestrationPersistenceEnvelope;
  persisted?: {
    decisionId: string | null;
    outboxId: string | null;
    error?: string;
  };
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pushReason(map: OrchestrationReasonMap, key: string, reason: string) {
  map[key] = [...(map[key] ?? []), reason];
}

function idempotencyKey(input: {
  executionId?: string;
  tradeId?: string;
  positionId?: string;
  symbol?: string;
  stage: string;
}) {
  return [
    "orch",
    input.stage,
    input.executionId || input.tradeId || input.positionId || input.symbol || "unknown",
  ].join(":");
}

function resolveAction(input: {
  ai?: AIConsensusResult;
  qualityGate?: SignalQualityResult;
  suppressionScore: number;
  uncertaintyScore: number;
  edgeHealthScore: number;
  clusterRiskScore: number;
}): OrchestrationAction {
  if (input.ai?.finalDecision === "NO_TRADE" || input.ai?.rejected) return "SUPPRESS";
  if (input.qualityGate?.decision === "REJECT") return "SUPPRESS";
  if (input.suppressionScore >= 82 || input.uncertaintyScore >= 82 || input.clusterRiskScore >= 86) return "BLOCK";
  if (input.suppressionScore >= 62 || input.uncertaintyScore >= 64 || input.edgeHealthScore < 38 || input.qualityGate?.decision === "CAUTION") {
    return "CAUTION";
  }
  return "ALLOW";
}

export async function evaluateOrchestration(input: {
  userId?: string;
  candidate: ScannerCandidate;
  ai?: AIConsensusResult;
  qualityGate?: SignalQualityResult;
  executionId?: string;
  tradeId?: string;
  positionId?: string;
  mode?: string;
  decisionStage?: "PRE_TRADE" | "POST_TRADE" | "REJECT" | "SETTLEMENT";
  persist?: boolean;
}): Promise<OrchestrationEvaluationResult> {
  const { candidate, ai } = input;
  const meta = candidate.context.metadata ?? {};
  const marketRegime = String(meta.marketRegime ?? "UNKNOWN");
  const strategy = String(meta.marketRegimeStrategy ?? ai?.decisionPayload?.selectedStrategy ?? "UNKNOWN_STRATEGY");
  const uncertainty = evaluateUncertainty({
    candidate,
    ai,
    executionId: input.executionId,
    tradeId: input.tradeId,
    positionId: input.positionId,
  });
  const [edgeHealth, cluster] = await Promise.all([
    buildSelfPerformanceSnapshot({
      userId: input.userId,
      symbol: candidate.context.symbol,
      strategy,
      marketRegime,
      rollingWindow: 50,
    }),
    buildTradeClusterSnapshot({
      userId: input.userId,
      symbol: candidate.context.symbol,
      strategy,
      marketRegime,
      window: 35,
    }),
  ]);

  const reasonMap: OrchestrationReasonMap = { ...(uncertainty.reasonMap ?? {}) };
  const vetoReasons: string[] = [];
  const regimeChaos = num(meta.regimeChaosProbability);
  const futuresRisk = num(meta.futuresRiskScore);
  const leveragedTrap = num(meta.leveragedTrapProbability);
  const qualityScore = num(input.qualityGate?.qualityScore ?? input.qualityGate?.weightedTotal, 55);
  const aiConfidence = num(ai?.finalConfidence, candidate.score.confidence);
  const edgeHealthScore = num(edgeHealth.edgeStabilityScore, 50);
  const clusterRiskScore = num(cluster.marketHostilityScore, 0);
  const manipulationRisk = clamp(candidate.context.fakeSpikeScore * 18 + candidate.context.pumpRisk * 0.42 + futuresRisk * 0.2 + leveragedTrap * 0.2);
  const suppressionScore = clamp(
    uncertainty.uncertaintyScore * 0.34 +
      (100 - qualityScore) * 0.18 +
      manipulationRisk * 0.16 +
      clusterRiskScore * 0.16 +
      (100 - edgeHealthScore) * 0.12 +
      regimeChaos * 0.04,
  );
  const orchestrationScore = clamp(
    aiConfidence * 0.34 +
      candidate.score.score * 0.18 +
      qualityScore * 0.2 +
      edgeHealthScore * 0.16 +
      uncertainty.confidenceReliability * 0.12 -
      suppressionScore * 0.18,
  );
  const confidencePenalty = clamp(
    uncertainty.uncertaintyScore * 0.12 +
      clusterRiskScore * 0.08 +
      Math.max(0, 52 - edgeHealthScore) * 0.18 +
      manipulationRisk * 0.05,
    0,
    32,
  );
  const confidenceAdjusted = clamp(aiConfidence - confidencePenalty);
  const riskMultiplier = Number(
    clamp(1 - uncertainty.uncertaintyScore * 0.003 - clusterRiskScore * 0.0025 - Math.max(0, 50 - edgeHealthScore) * 0.003, 0.25, 1.08).toFixed(4),
  );
  const adaptiveActions: OrchestrationAdaptiveRecommendation[] = [];

  if (uncertainty.uncertaintyScore >= 68) {
    vetoReasons.push("High uncertainty");
    pushReason(reasonMap, "orchestration", "Uncertainty requires stricter execution");
    adaptiveActions.push({
      actionType: "CONFIDENCE_PENALTY",
      scope: "symbol",
      targetKey: candidate.context.symbol,
      reason: "High uncertainty reduced confidence reliability",
      confidence: uncertainty.uncertaintyScore,
      confidenceDelta: -confidencePenalty,
      riskMultiplier,
    });
  }
  if (edgeHealthScore < 42) {
    vetoReasons.push("Strategy edge health degraded");
    pushReason(reasonMap, "edge", "Strategy edge health is below safe band");
    adaptiveActions.push({
      actionType: "THRESHOLD_INCREASE",
      scope: "strategy",
      targetKey: strategy,
      reason: "Rolling edge health degraded",
      confidence: 75,
      thresholdDelta: 5,
      sizeMultiplier: 0.7,
      riskMultiplier: Math.min(riskMultiplier, 0.75),
    });
  }
  if (clusterRiskScore >= 62) {
    vetoReasons.push("Temporary market hostility cluster");
    pushReason(reasonMap, "cluster", "Recent trades show hostile cluster conditions");
    adaptiveActions.push({
      actionType: clusterRiskScore >= 78 ? "STRATEGY_COOLDOWN" : "RISK_REDUCTION",
      scope: "cluster",
      targetKey: cluster.clusterKey,
      reason: cluster.recommendedAction ?? "Cluster risk elevated",
      confidence: clusterRiskScore,
      sizeMultiplier: clusterRiskScore >= 78 ? 0.45 : 0.7,
      riskMultiplier: Math.min(riskMultiplier, clusterRiskScore >= 78 ? 0.55 : 0.75),
      cooldownUntil: cluster.cooldownUntil,
    });
  }
  if (manipulationRisk >= 70) {
    vetoReasons.push("Manipulation exposure elevated");
    pushReason(reasonMap, "manipulation", "Fake spike/futures trap risk raised suppression score");
  }

  const action = resolveAction({
    ai,
    qualityGate: input.qualityGate,
    suppressionScore,
    uncertaintyScore: uncertainty.uncertaintyScore,
    edgeHealthScore,
    clusterRiskScore,
  });
  const vetoLayer = action === "BLOCK" ? "ORCHESTRATION_HARD_BLOCK" : action === "SUPPRESS" ? "ORCHESTRATION_SUPPRESSION" : undefined;
  const envelope: OrchestrationPersistenceEnvelope = {
    decision: {
      userId: input.userId,
      idempotencyKey: idempotencyKey({
        executionId: input.executionId,
        tradeId: input.tradeId,
        positionId: input.positionId,
        symbol: candidate.context.symbol,
        stage: input.decisionStage ?? "PRE_TRADE",
      }),
      executionId: input.executionId,
      tradeId: input.tradeId,
      positionId: input.positionId,
      symbol: candidate.context.symbol,
      mode: input.mode,
      decisionStage: input.decisionStage ?? "PRE_TRADE",
      action,
      strategy,
      marketRegime,
      regimeLifecyclePhase: String(meta.regimeLifecyclePhase ?? "UNKNOWN"),
      confidenceOriginal: aiConfidence,
      confidenceAdjusted,
      confidencePenalty,
      riskMultiplier,
      suppressionScore: Number(suppressionScore.toFixed(2)),
      orchestrationScore: Number(orchestrationScore.toFixed(2)),
      uncertaintyScore: uncertainty.uncertaintyScore,
      edgeHealthScore,
      clusterRiskScore,
      vetoLayer,
      vetoReasons,
      reasonMap,
      factorWeights: {
        uncertainty: 0.34,
        quality: 0.18,
        manipulation: 0.16,
        cluster: 0.16,
        edgeHealth: 0.12,
        regimeChaos: 0.04,
      },
      forensicReport: {
        action,
        aiDecision: ai?.finalDecision,
        aiRejected: ai?.rejected ?? false,
        qualityGate: input.qualityGate?.decision,
        uncertainty,
        edgeHealth,
        cluster,
      },
      adaptiveActions,
      metadata: {
        scannerScore: candidate.score.score,
        scannerConfidence: candidate.score.confidence,
        marketMetadata: meta,
        qualityGate: input.qualityGate,
        ...ORCHESTRATION_VERSIONS,
      },
    },
    uncertainty,
    edgeHealth,
    cluster,
  };
  const persisted = input.persist === false ? undefined : await persistOrchestrationEnvelope(envelope);
  return {
    action,
    confidenceAdjusted,
    confidencePenalty,
    riskMultiplier,
    suppressionScore: Number(suppressionScore.toFixed(2)),
    orchestrationScore: Number(orchestrationScore.toFixed(2)),
    uncertaintyScore: uncertainty.uncertaintyScore,
    edgeHealthScore,
    clusterRiskScore,
    vetoLayer,
    vetoReasons,
    reasonMap,
    adaptiveActions,
    envelope,
    persisted,
  };
}
