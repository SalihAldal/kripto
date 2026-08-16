import type { AIDecision } from "@/src/types/ai";
import type { MasterDecisionType } from "@prisma/client";
import {
  mapMasterToLegacy,
  resolveEffectiveTradingDecision,
} from "@/src/server/decision-engine/conflict-detection.service";
import type {
  TdiDecisionRecord,
  TdiDecisionVerdict,
  TdiProductionReplayStatus,
  TdiScoreType,
} from "@/src/server/forensics/forensic.types";

export type TdiProductionReplayResult = {
  verdict: TdiDecisionVerdict;
  productionApprovalEquivalent: boolean;
  replayStatus: TdiProductionReplayStatus;
  replayReason?: string;
  decisionSource: "HYBRID" | "MASTER" | "RECORDED" | "UNKNOWN";
  legacyDecision?: string;
};

export const SCORE_THRESHOLD_EXPLANATION =
  "Score threshold pass is a counterfactual metric and is not equivalent to production TDI APPROVED.";

export function inferScoreTypeFromCandidateId(candidateId: string): TdiScoreType {
  if (candidateId.startsWith("hybrid:")) return "HYBRID_COMPOSITE";
  if (candidateId.startsWith("tdi:")) return "MASTER_EXPERT_AVERAGE";
  return "UNKNOWN";
}

export function normalizeTdiDecisionRecord(record: TdiDecisionRecord): TdiDecisionRecord {
  const scoreType = record.scoreType ?? inferScoreTypeFromCandidateId(record.candidateId);
  const legacyConsensus = record.consensusScore;
  let hybridCompositeScore = record.hybridCompositeScore ?? null;
  let masterExpertConsensusScore = record.masterExpertConsensusScore ?? null;

  if (scoreType === "HYBRID_COMPOSITE" && hybridCompositeScore == null && legacyConsensus != null) {
    hybridCompositeScore = legacyConsensus;
  }
  if (scoreType === "MASTER_EXPERT_AVERAGE" && masterExpertConsensusScore == null && legacyConsensus != null) {
    masterExpertConsensusScore = legacyConsensus;
  }

  return {
    ...record,
    scoreType,
    hybridCompositeScore,
    masterExpertConsensusScore,
    consensusScore: legacyConsensus ?? hybridCompositeScore ?? masterExpertConsensusScore ?? undefined,
  };
}

export function getThresholdScore(record: TdiDecisionRecord, scoreType = record.scoreType): number | null {
  const normalized = normalizeTdiDecisionRecord(record);
  const resolvedType = scoreType ?? normalized.scoreType ?? "UNKNOWN";
  if (resolvedType === "HYBRID_COMPOSITE") {
    return normalized.hybridCompositeScore ?? normalized.consensusScore ?? null;
  }
  if (resolvedType === "MASTER_EXPERT_AVERAGE") {
    return normalized.masterExpertConsensusScore ?? normalized.consensusScore ?? null;
  }
  return normalized.consensusScore ?? null;
}

export function replayHybridTdiVerdict(hybridDecision?: string | null): TdiDecisionVerdict {
  if (hybridDecision === "BUY") return "APPROVED";
  if (hybridDecision === "HOLD") return "WAIT";
  return "REJECTED";
}

export function mapLegacyDecisionToTdiVerdict(
  legacyDecision: string,
  masterDecision?: string | null,
): TdiDecisionVerdict {
  if (legacyDecision === "BUY") return "APPROVED";
  if (masterDecision === "WAIT" || masterDecision === "WATCHLIST") return "WAIT";
  if (legacyDecision === "HOLD") return "WAIT";
  return "REJECTED";
}

export function replayProductionTdiVerdict(record: TdiDecisionRecord): TdiProductionReplayResult {
  const normalized = normalizeTdiDecisionRecord(record);
  const candidateId = normalized.candidateId;

  if (candidateId.startsWith("hybrid:")) {
    const verdict = replayHybridTdiVerdict(normalized.hybridDecision);
    return {
      verdict,
      productionApprovalEquivalent: verdict === "APPROVED",
      replayStatus: normalized.hybridDecision ? "COMPLETE" : "INCOMPLETE",
      replayReason: normalized.hybridDecision ? undefined : "Missing hybridDecision on hybrid record",
      decisionSource: "HYBRID",
      legacyDecision: normalized.hybridDecision ?? undefined,
    };
  }

  if (candidateId.startsWith("tdi:")) {
    if (!normalized.masterDecision) {
      return {
        verdict: normalized.verdict,
        productionApprovalEquivalent: normalized.verdict === "APPROVED",
        replayStatus: "INCOMPLETE",
        replayReason: "Missing masterDecision on master TDI record",
        decisionSource: "RECORDED",
      };
    }

    const masterDecision = normalized.masterDecision as MasterDecisionType;
    let legacyDecision = normalized.legacyDecision;
    let replayStatus: TdiProductionReplayStatus = "COMPLETE";
    let replayReason: string | undefined;

    if (legacyDecision) {
      legacyDecision = legacyDecision.toUpperCase();
    } else {
      const effective = resolveEffectiveTradingDecision({
        masterDecision,
        hybridDecision: (normalized.hybridDecision ?? "NO_TRADE") as AIDecision,
        hybridRejected: Boolean(normalized.hybridRejected),
        hybridConfidence: Number(normalized.confidence ?? 0),
        metrics: {
          consensusScore: Number(
            normalized.masterExpertConsensusScore ?? normalized.consensusScore ?? 0,
          ),
          confidence: Number(normalized.confidence ?? 0),
          agreementScore: 0,
          conflictScore: 0,
          stability: 0,
          reliability: 0,
        },
        opinions: [],
      });
      legacyDecision = effective.legacyDecision;
      replayStatus = "INCOMPLETE";
      replayReason =
        "legacyDecision inferred without recorded expert opinions; hybrid BUY preservation may differ from runtime";
    }

    const verdict = mapLegacyDecisionToTdiVerdict(legacyDecision, masterDecision);
    return {
      verdict,
      productionApprovalEquivalent: verdict === "APPROVED",
      replayStatus,
      replayReason,
      decisionSource: "MASTER",
      legacyDecision,
    };
  }

  if (normalized.hybridDecision) {
    const verdict = replayHybridTdiVerdict(normalized.hybridDecision);
    return {
      verdict,
      productionApprovalEquivalent: verdict === "APPROVED",
      replayStatus: "INCOMPLETE",
      replayReason: "Unknown candidate source; replayed from hybridDecision only",
      decisionSource: "HYBRID",
      legacyDecision: normalized.hybridDecision,
    };
  }

  return {
    verdict: normalized.verdict,
    productionApprovalEquivalent: normalized.verdict === "APPROVED",
    replayStatus: "INCOMPLETE",
    replayReason: "Insufficient decision fields for production replay",
    decisionSource: "RECORDED",
  };
}

export function summarizeProductionReplayStatus(
  results: TdiProductionReplayResult[],
): { status: TdiProductionReplayStatus; reason?: string } {
  const incomplete = results.filter((row) => row.replayStatus === "INCOMPLETE").length;
  if (results.length === 0) {
    return { status: "INCOMPLETE", reason: "No TDI decisions available" };
  }
  if (incomplete === 0) {
    return { status: "COMPLETE" };
  }
  if (incomplete < results.length) {
    return {
      status: "PARTIAL",
      reason: `${incomplete}/${results.length} records missing fields required for full master replay`,
    };
  }
  return {
    status: "INCOMPLETE",
    reason: `${incomplete}/${results.length} records could not be fully replayed from stored evidence`,
  };
}

/** Forensic-only helper mirroring master map without mutating runtime behavior. */
export function mapMasterDecisionToLegacyPreview(masterDecision: MasterDecisionType): string {
  return mapMasterToLegacy(masterDecision);
}
