import type { ExpertOpinionType, ExpertType, MasterDecisionType } from "@prisma/client";
import type { AIDecision } from "@/src/types/ai";
import type {
  ConflictPair,
  DecisionAttributionSnapshot,
  DecisionMatrixSnapshot,
  ExpertOpinionResult,
} from "@/src/server/decision-engine/decision-engine.types";
import { OPINION_POLARITY } from "@/src/server/decision-engine/decision-engine.types";
import { avg } from "@/src/server/decision-engine/experts/expert.utils";

/** Stable Trading Decision policy — hybrid BUY preservation when master defers without hard conflict. */
export const TRADING_DECISION_POLICY = {
  preserveHybridBuyOnMasterDefer: true,
  minHybridConfidenceToPreserve: 65,
  minMasterConsensusToPreserve: 45,
  minMasterConfidenceToPreserve: 40,
  maxBearishExpertsToPreserve: 1,
  minExpertCoverageToTrustMasterReject: 5,
} as const;

function isBullish(opinion: ExpertOpinionType) {
  return opinion === "BUY" || opinion === "WEAK_BUY";
}

function isBearish(opinion: ExpertOpinionType) {
  return opinion === "SELL" || opinion === "WEAK_SELL";
}

export function buildDecisionMatrix(opinions: ExpertOpinionResult[]): DecisionMatrixSnapshot {
  const byType = new Map(opinions.map((row) => [row.expertType, row.score]));
  return {
    market: byType.get("MARKET") ?? 0,
    momentum: byType.get("MOMENTUM") ?? 0,
    volume: byType.get("VOLUME") ?? 0,
    liquidity: byType.get("LIQUIDITY") ?? 0,
    risk: byType.get("RISK") ?? 0,
    news: byType.get("NEWS") ?? 0,
    execution: byType.get("EXECUTION") ?? 0,
    learning: byType.get("LEARNING") ?? 0,
  };
}

export function detectConflicts(opinions: ExpertOpinionResult[]): ConflictPair[] {
  const conflicts: ConflictPair[] = [];
  for (let i = 0; i < opinions.length; i += 1) {
    for (let j = i + 1; j < opinions.length; j += 1) {
      const a = opinions[i];
      const b = opinions[j];
      if (a.opinion === "NO_OPINION" || b.opinion === "NO_OPINION") continue;
      const bullishA = isBullish(a.opinion);
      const bullishB = isBullish(b.opinion);
      const bearishA = isBearish(a.opinion);
      const bearishB = isBearish(b.opinion);
      if ((bullishA && bearishB) || (bearishA && bullishB)) {
        conflicts.push({
          expertA: a.expertType,
          opinionA: a.opinion,
          expertB: b.expertType,
          opinionB: b.opinion,
          severity: Math.abs(a.score - b.score) / 100,
          description: `${a.expertType} ${a.opinion} vs ${b.expertType} ${b.opinion}`,
        });
      }
    }
  }
  return conflicts.sort((x, y) => y.severity - x.severity);
}

export function buildAttribution(opinions: ExpertOpinionResult[]): DecisionAttributionSnapshot {
  const supporters = opinions
    .filter((row) => isBullish(row.opinion))
    .map((row) => ({ expert: row.expertType, opinion: row.opinion, score: row.score }))
    .sort((a, b) => b.score - a.score);
  const blockers = opinions
    .filter((row) => isBearish(row.opinion))
    .map((row) => ({ expert: row.expertType, opinion: row.opinion, score: row.score }))
    .sort((a, b) => a.score - b.score);
  const confidenceReducers = opinions
    .filter((row) => row.topRisks.length > 0 || row.opinion === "NO_OPINION")
    .flatMap((row) => row.topRisks.map((reason) => ({ expert: row.expertType, reason })));
  return { supporters, blockers, confidenceReducers };
}

export function computeConsensusMetrics(opinions: ExpertOpinionResult[], conflicts: ConflictPair[]) {
  const actionableOpinions = opinions.filter((row) => row.opinion !== "NO_OPINION");
  const polarities = actionableOpinions.map((row) => OPINION_POLARITY[row.opinion]);
  const consensusScore = avg((actionableOpinions.length > 0 ? actionableOpinions : opinions).map((row) => row.score));
  const agreementScore =
    polarities.length === 0
      ? 0
      : Math.max(0, 100 - Math.abs(Math.max(...polarities) - Math.min(...polarities)) * 50 - stddev(polarities) * 25);
  const conflictScore = Math.min(100, conflicts.length * 12 + conflicts.reduce((sum, row) => sum + row.severity * 20, 0));
  const stability = Math.max(0, 100 - conflictScore * 0.6);
  const confidence = Math.max(0, Math.min(100, consensusScore * 0.55 + agreementScore * 0.35 - conflictScore * 0.15));
  const reliability = Math.max(0, Math.min(100, confidence * 0.7 + stability * 0.3));
  return { consensusScore, agreementScore, conflictScore, stability, confidence, reliability };
}

function stddev(values: number[]) {
  if (values.length === 0) return 0;
  const mean = avg(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

export function resolveMasterDecision(input: {
  matrix: DecisionMatrixSnapshot;
  metrics: ReturnType<typeof computeConsensusMetrics>;
  opinions: ExpertOpinionResult[];
  conflicts: ConflictPair[];
}): MasterDecisionType {
  const { matrix, metrics, opinions, conflicts } = input;
  const bullishCount = opinions.filter((row) => isBullish(row.opinion)).length;
  const bearishCount = opinions.filter((row) => isBearish(row.opinion)).length;
  const momentum = matrix.momentum;
  const execution = matrix.execution;
  const risk = matrix.risk;

  if (bearishCount >= 3 && metrics.consensusScore < 45) return "SELL";
  if (bearishCount >= 2 && risk < 40) return "REDUCE";
  if (metrics.consensusScore >= 85 && metrics.confidence >= 78 && bullishCount >= 5 && conflicts.length <= 1) return "STRONG_BUY";
  if (metrics.consensusScore >= 68 && metrics.confidence >= 62 && bullishCount >= 4 && momentum >= 60 && execution >= 55) return "BUY";
  if (metrics.consensusScore >= 55 && metrics.confidence >= 50 && bullishCount >= 2 && conflicts.length <= 2) return "WATCHLIST";
  if (metrics.consensusScore >= 45 && metrics.confidence >= 40) return "WAIT";
  return "NO_TRADE";
}

export function mapMasterToLegacy(decision: MasterDecisionType): "BUY" | "SELL" | "HOLD" | "NO_TRADE" {
  if (decision === "STRONG_BUY" || decision === "BUY") return "BUY";
  if (decision === "SELL" || decision === "REDUCE") return "SELL";
  if (decision === "WATCHLIST") return "HOLD";
  return "NO_TRADE";
}

function countBearishExperts(opinions: ExpertOpinionResult[]) {
  return opinions.filter((row) => isBearish(row.opinion)).length;
}

function countActionableExperts(opinions: ExpertOpinionResult[]) {
  return opinions.filter((row) => row.opinion !== "NO_OPINION").length;
}

/**
 * Master engine WAIT/WATCHLIST previously mapped to NO_TRADE/HOLD and erased hybrid BUY approvals.
 * Preserve hybrid BUY when master only defers and no material bearish conflict exists.
 */
export function resolveEffectiveTradingDecision(input: {
  masterDecision: MasterDecisionType;
  hybridDecision: AIDecision;
  hybridRejected: boolean;
  hybridConfidence: number;
  metrics: ReturnType<typeof computeConsensusMetrics>;
  opinions: ExpertOpinionResult[];
}): {
  legacyDecision: "BUY" | "SELL" | "HOLD" | "NO_TRADE";
  preservedHybridBuy: boolean;
  preservationReason?: string;
} {
  const mapped = mapMasterToLegacy(input.masterDecision);
  if (!TRADING_DECISION_POLICY.preserveHybridBuyOnMasterDefer) {
    return { legacyDecision: mapped, preservedHybridBuy: false };
  }
  if (input.hybridDecision !== "BUY" || input.hybridRejected) {
    return { legacyDecision: mapped, preservedHybridBuy: false };
  }
  if (input.masterDecision === "STRONG_BUY" || input.masterDecision === "BUY") {
    return { legacyDecision: "BUY", preservedHybridBuy: false };
  }
  if (input.masterDecision === "SELL" || input.masterDecision === "REDUCE") {
    return { legacyDecision: "SELL", preservedHybridBuy: false };
  }

  const bearishExperts = countBearishExperts(input.opinions);
  const expertCoverage = countActionableExperts(input.opinions);
  const masterHardReject =
    input.masterDecision === "NO_TRADE" &&
    expertCoverage >= TRADING_DECISION_POLICY.minExpertCoverageToTrustMasterReject &&
    input.metrics.consensusScore < TRADING_DECISION_POLICY.minMasterConsensusToPreserve;
  if (masterHardReject || bearishExperts > TRADING_DECISION_POLICY.maxBearishExpertsToPreserve) {
    return { legacyDecision: mapped, preservedHybridBuy: false };
  }

  const hybridConfidenceOk = input.hybridConfidence >= TRADING_DECISION_POLICY.minHybridConfidenceToPreserve;
  const masterDefer =
    input.masterDecision === "WAIT" ||
    input.masterDecision === "WATCHLIST" ||
    (input.masterDecision === "NO_TRADE" && expertCoverage < TRADING_DECISION_POLICY.minExpertCoverageToTrustMasterReject);
  const masterMetricsOk =
    input.metrics.consensusScore >= TRADING_DECISION_POLICY.minMasterConsensusToPreserve ||
    input.metrics.confidence >= TRADING_DECISION_POLICY.minMasterConfidenceToPreserve;

  if (masterDefer && hybridConfidenceOk && masterMetricsOk) {
    return {
      legacyDecision: "BUY",
      preservedHybridBuy: true,
      preservationReason: `Hybrid BUY preserved — master ${input.masterDecision} deferred (consensus=${input.metrics.consensusScore.toFixed(0)}, confidence=${input.metrics.confidence.toFixed(0)})`,
    };
  }

  return { legacyDecision: mapped, preservedHybridBuy: false };
}

export function buildHumanReadableDecision(input: {
  decision: MasterDecisionType;
  matrix: DecisionMatrixSnapshot;
  metrics: ReturnType<typeof computeConsensusMetrics>;
  attribution: DecisionAttributionSnapshot;
}): string {
  const leadSupporters = input.attribution.supporters.slice(0, 2).map((row) => row.expert).join(" and ");
  const leadBlockers = input.attribution.blockers.slice(0, 2).map((row) => row.expert).join(" and ");
  const base = `${input.decision} resolved by master decision engine. Overall confidence ${input.metrics.confidence.toFixed(0)}.`;
  const support = leadSupporters ? ` Supported by ${leadSupporters}.` : "";
  const block = leadBlockers ? ` Blocked/reduced by ${leadBlockers}.` : "";
  const riskNote = input.matrix.risk < 60 ? " Risk remains elevated." : " Risk acceptable.";
  return `${base}${support}${block}${riskNote}`.trim();
}
