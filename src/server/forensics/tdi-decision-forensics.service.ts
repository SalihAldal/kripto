import type {
  TdiDecisionRecord,
  TdiDecisionVerdict,
  TdiWaitReasonCode,
} from "@/src/server/forensics/forensic.types";
import {
  inferScoreTypeFromCandidateId,
  normalizeTdiDecisionRecord,
} from "@/src/server/forensics/tdi-verdict-replay.service";

export function classifyTdiWaitReason(input: {
  masterDecision?: string;
  hybridDecision?: string;
  hybridRejected?: boolean;
  consensusScore?: number;
  confidence?: number;
  portfolioBlocked?: boolean;
  openPositionCount?: number;
  maxSlots?: number;
  rank?: number;
  approvedRankLimit?: number;
  cooldownActive?: boolean;
  riskBlocked?: boolean;
  evBelowThreshold?: boolean;
  capitalSlotRejected?: boolean;
}): TdiWaitReasonCode {
  if (input.cooldownActive) return "COOLDOWN";
  if (input.riskBlocked) return "RISK";
  if (
    input.portfolioBlocked ||
    input.capitalSlotRejected ||
    (Number(input.openPositionCount ?? 0) >= Number(input.maxSlots ?? 3) &&
      Number(input.rank ?? 999) > Number(input.approvedRankLimit ?? 3))
  ) {
    return "NO_SLOT";
  }
  if (input.evBelowThreshold || input.hybridRejected) return "BELOW_THRESHOLD";
  const master = String(input.masterDecision ?? "").toUpperCase();
  if (master === "WAIT" || master === "WATCHLIST") {
    const score = Number(input.consensusScore ?? 0);
    const confidence = Number(input.confidence ?? 0);
    if (score >= 55 && confidence >= 50) return "NO_SLOT";
    return "NEUTRAL";
  }
  if (input.hybridDecision === "HOLD") return "NEUTRAL";
  return "OTHER";
}

function resolveScoreFields(input: {
  candidateId: string;
  consensusScore?: number;
  hybridCompositeScore?: number | null;
  masterExpertConsensusScore?: number | null;
  scoreType?: TdiDecisionRecord["scoreType"];
}) {
  const scoreType = input.scoreType ?? inferScoreTypeFromCandidateId(input.candidateId);
  const legacyScore = input.consensusScore;
  if (scoreType === "HYBRID_COMPOSITE") {
    const hybridCompositeScore = input.hybridCompositeScore ?? legacyScore ?? null;
    return {
      scoreType,
      hybridCompositeScore,
      masterExpertConsensusScore: null as number | null,
      consensusScore: hybridCompositeScore ?? undefined,
    };
  }
  if (scoreType === "MASTER_EXPERT_AVERAGE") {
    const masterExpertConsensusScore = input.masterExpertConsensusScore ?? legacyScore ?? null;
    return {
      scoreType,
      hybridCompositeScore: null as number | null,
      masterExpertConsensusScore,
      consensusScore: masterExpertConsensusScore ?? undefined,
    };
  }
  return {
    scoreType: "UNKNOWN" as const,
    hybridCompositeScore: null as number | null,
    masterExpertConsensusScore: null as number | null,
    consensusScore: legacyScore,
  };
}

export function buildTdiDecisionRecord(input: {
  candidateId: string;
  symbol: string;
  verdict: TdiDecisionVerdict;
  masterDecision?: string;
  hybridDecision?: string;
  legacyDecision?: string;
  hybridRejected?: boolean;
  consensusScore?: number;
  hybridCompositeScore?: number | null;
  masterExpertConsensusScore?: number | null;
  scoreType?: TdiDecisionRecord["scoreType"];
  confidence?: number;
  rank?: number;
  capitalSlot?: number;
  maxSlots?: number;
  openPositionCount?: number;
  strategy?: string;
  forensicRegime?: TdiDecisionRecord["forensicRegime"];
  portfolioBlocked?: boolean;
  cooldownActive?: boolean;
  riskBlocked?: boolean;
  evBelowThreshold?: boolean;
  capitalSlotRejected?: boolean;
  reasonDetail?: string;
  timestamp?: string;
}): TdiDecisionRecord {
  const scoreFields = resolveScoreFields(input);
  const waitReasonCode =
    input.verdict === "WAIT"
      ? classifyTdiWaitReason({
          masterDecision: input.masterDecision,
          hybridDecision: input.hybridDecision,
          hybridRejected: input.hybridRejected,
          consensusScore: scoreFields.consensusScore,
          confidence: input.confidence,
          portfolioBlocked: input.portfolioBlocked,
          openPositionCount: input.openPositionCount,
          maxSlots: input.maxSlots,
          rank: input.rank,
          approvedRankLimit: input.maxSlots,
          cooldownActive: input.cooldownActive,
          riskBlocked: input.riskBlocked,
          evBelowThreshold: input.evBelowThreshold,
          capitalSlotRejected: input.capitalSlotRejected,
        })
      : undefined;
  return normalizeTdiDecisionRecord({
    candidateId: input.candidateId,
    symbol: input.symbol.toUpperCase(),
    verdict: input.verdict,
    waitReasonCode,
    masterDecision: input.masterDecision,
    hybridDecision: input.hybridDecision,
    legacyDecision: input.legacyDecision,
    hybridRejected: input.hybridRejected,
    confidence: input.confidence,
    rank: input.rank,
    capitalSlot: input.capitalSlot,
    maxSlots: input.maxSlots,
    openPositionCount: input.openPositionCount,
    strategy: input.strategy,
    forensicRegime: input.forensicRegime,
    ...scoreFields,
    reasonDetail:
      input.reasonDetail ??
      (input.verdict === "WAIT"
        ? `TDI WAIT (${waitReasonCode ?? "OTHER"})`
        : input.verdict === "APPROVED"
          ? "TDI APPROVED"
          : "TDI REJECTED"),
    timestamp: input.timestamp ?? new Date().toISOString(),
  });
}

export { normalizeTdiDecisionRecord };
