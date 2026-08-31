import type {
  TdiDecisionRecord,
  TdiDecisionVerdict,
  TdiFirstBlockingCondition,
  TdiWaitReasonCode,
} from "@/src/server/forensics/forensic.types";
import {
  inferScoreTypeFromCandidateId,
  normalizeTdiDecisionRecord,
} from "@/src/server/forensics/tdi-verdict-replay.service";
import {
  buildTdiInputContract,
  classifyTdiBlock,
  inferDataQualityIssues,
} from "@/src/server/forensics/tdi-data-quality.service";

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
  const master = String(input.masterDecision ?? "").toUpperCase();
  if (master === "WAIT" || master === "WATCHLIST") {
    const score = Number(input.consensusScore ?? 0);
    const confidence = Number(input.confidence ?? 0);
    if (score >= 55 && confidence >= 50) return "NO_SLOT";
    return "NEUTRAL";
  }
  if (input.hybridDecision === "HOLD") return "NEUTRAL";
  if (input.evBelowThreshold || input.hybridRejected) return "BELOW_THRESHOLD";
  return "OTHER";
}

function normalizeBlockingCondition(raw: string): TdiFirstBlockingCondition {
  const token = raw.trim().toUpperCase();
  if (!token) return "OTHER";
  if (token.includes("MOMENTUM")) return "MOMENTUM";
  if (token.includes("TEKNIK") || token.includes("TECH")) return "TECHNICAL";
  if (token.includes("TIMEFRAME") || token.includes("MTF")) return "MTF_ALIGNMENT";
  if (token.includes("RISK") || token.includes("LIKIDITE") || token.includes("MANIPULASYON")) return "RISK";
  if (token.includes("SLOT")) return "NO_SLOT";
  if (token.includes("COOLDOWN")) return "COOLDOWN";
  if (token.includes("LEARNING")) return "LEARNING";
  if (token.includes("CONFIDENCE")) return "CONFIDENCE";
  if (token.includes("NEUTRAL")) return "NEUTRAL";
  return "OTHER";
}

function deriveBlockingConditions(input: {
  reasonDetail?: string;
  firstBlockingCondition?: TdiFirstBlockingCondition;
  blockingConditions?: TdiFirstBlockingCondition[];
  waitReasonCode?: TdiWaitReasonCode;
}): TdiFirstBlockingCondition[] {
  if (Array.isArray(input.blockingConditions) && input.blockingConditions.length > 0) {
    return input.blockingConditions;
  }
  if (input.firstBlockingCondition) {
    return [input.firstBlockingCondition];
  }
  const reasons = String(input.reasonDetail ?? "")
    .split("|")
    .map((row) => normalizeBlockingCondition(row))
    .filter((row, idx, arr) => row !== "OTHER" && arr.indexOf(row) === idx);
  if (reasons.length > 0) {
    return reasons;
  }
  if (input.waitReasonCode === "COOLDOWN") return ["COOLDOWN"];
  if (input.waitReasonCode === "RISK") return ["RISK"];
  if (input.waitReasonCode === "NO_SLOT") return ["NO_SLOT"];
  if (input.waitReasonCode === "NEUTRAL") return ["NEUTRAL"];
  if (input.waitReasonCode === "BELOW_THRESHOLD") return ["CONFIDENCE"];
  return ["OTHER"];
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
  technicalScore?: number;
  momentumScore?: number;
  sentimentScore?: number;
  shortMomentum?: number;
  shortFlow?: number;
  executionScore?: number;
  confidence?: number;
  bullishCount?: number;
  learningScore?: number;
  liquidity?: number;
  volatility?: number;
  expectedValue?: number;
  openInterest?: number;
  marketContext?: string;
  simulation?: string;
  trendData?: string;
  thresholds?: TdiDecisionRecord["thresholds"];
  regime?: string;
  regimeDelta?: TdiDecisionRecord["regimeDelta"];
  paperRelaxed?: boolean;
  learningLane?: boolean;
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
  reasonCode?: string;
  timestamp?: string;
  firstBlockingCondition?: TdiFirstBlockingCondition;
  blockingConditions?: TdiFirstBlockingCondition[];
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
  const reasonDetail =
    input.reasonDetail ??
    (input.verdict === "WAIT"
      ? `TDI WAIT (${waitReasonCode ?? "OTHER"})`
      : input.verdict === "APPROVED"
        ? "TDI APPROVED"
        : "TDI REJECTED");
  const blockingConditions: TdiFirstBlockingCondition[] = deriveBlockingConditions({
    reasonDetail,
    firstBlockingCondition: input.firstBlockingCondition,
    blockingConditions: input.blockingConditions,
    waitReasonCode,
  });
  const firstBlockingCondition: TdiFirstBlockingCondition =
    blockingConditions[0] ?? input.firstBlockingCondition ?? "OTHER";
  const baseRecord: TdiDecisionRecord = {
    candidateId: input.candidateId,
    symbol: input.symbol.toUpperCase(),
    verdict: input.verdict,
    reasonCode:
      input.reasonCode ??
      (input.verdict === "WAIT"
        ? `TDI_WAIT_${waitReasonCode ?? "OTHER"}`
        : input.verdict === "APPROVED"
          ? "TDI_APPROVED"
          : "TDI_REJECTED"),
    waitReasonCode,
    masterDecision: input.masterDecision,
    hybridDecision: input.hybridDecision,
    finalDecision: input.masterDecision ?? input.hybridDecision,
    legacyDecision: input.legacyDecision,
    hybridRejected: input.hybridRejected,
    technicalScore: input.technicalScore,
    momentumScore: input.momentumScore,
    sentimentScore: input.sentimentScore,
    shortMomentum: input.shortMomentum,
    shortFlow: input.shortFlow,
    executionScore: input.executionScore,
    confidence: input.confidence,
    bullishCount: input.bullishCount,
    learningScore: input.learningScore,
    liquidity: input.liquidity,
    volatility: input.volatility,
    expectedValue: input.expectedValue,
    openInterest: input.openInterest,
    marketContext: input.marketContext,
    simulation: input.simulation,
    trendData: input.trendData,
    thresholds: input.thresholds,
    regime: input.regime,
    regimeDelta: input.regimeDelta,
    paperRelaxed: input.paperRelaxed,
    learningLane: input.learningLane,
    rank: input.rank,
    capitalSlot: input.capitalSlot,
    maxSlots: input.maxSlots,
    openPositionCount: input.openPositionCount,
    strategy: input.strategy,
    forensicRegime: input.forensicRegime,
    firstBlockingCondition,
    blockingConditions,
    ...scoreFields,
    reasonDetail,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
  const tdiInputContract = buildTdiInputContract(baseRecord);
  const inferredIssues = inferDataQualityIssues(baseRecord, tdiInputContract);
  const enriched: TdiDecisionRecord = {
    ...baseRecord,
    tdiInputContract,
    missingFields: inferredIssues.missingFields,
    dataQualityIssues: inferredIssues.dataQualityIssues,
  };
  return normalizeTdiDecisionRecord({
    ...enriched,
    blockClassification: classifyTdiBlock(enriched),
    dataQualityBlock: (enriched.dataQualityIssues?.length ?? 0) > 0,
    policyBlock: (enriched.dataQualityIssues?.length ?? 0) === 0,
  });
}

export { normalizeTdiDecisionRecord };
