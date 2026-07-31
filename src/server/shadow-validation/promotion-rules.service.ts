import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import { PROMOTION_RULES, type EngineScorecard } from "@/src/server/shadow-validation/shadow-validation.types";

export function evaluatePromotionEligibility(scorecard: EngineScorecard) {
  const blockers: string[] = [];
  if (scorecard.completedTrades < PROMOTION_RULES.minCompletedTrades) {
    blockers.push(`completedTrades<${PROMOTION_RULES.minCompletedTrades}`);
  }
  if (scorecard.profitFactor < PROMOTION_RULES.minProfitFactor) {
    blockers.push(`profitFactor<${PROMOTION_RULES.minProfitFactor}`);
  }
  if (scorecard.expectancy <= PROMOTION_RULES.minExpectancy) {
    blockers.push("expectancy<=0");
  }
  if (scorecard.sharpeRatio < PROMOTION_RULES.minSharpe) {
    blockers.push(`sharpe<${PROMOTION_RULES.minSharpe}`);
  }
  if (scorecard.maxDrawdownPct > PROMOTION_RULES.maxDrawdownPct) {
    blockers.push(`maxDrawdown>${PROMOTION_RULES.maxDrawdownPct}%`);
  }
  if (scorecard.winRate < PROMOTION_RULES.minWinRate) {
    blockers.push(`winRate<${PROMOTION_RULES.minWinRate}%`);
  }
  if ((scorecard.rejectAccuracy ?? 0) < PROMOTION_RULES.minRejectAccuracy) {
    blockers.push(`rejectAccuracy<${PROMOTION_RULES.minRejectAccuracy}%`);
  }
  if ((scorecard.decisionStability ?? 0) < PROMOTION_RULES.minDecisionStability) {
    blockers.push(`decisionStability<${PROMOTION_RULES.minDecisionStability}%`);
  }
  if ((scorecard.replayAccuracy ?? 0) < PROMOTION_RULES.minReplayAccuracy) {
    blockers.push(`replayAccuracy<${PROMOTION_RULES.minReplayAccuracy}%`);
  }

  const eligible = blockers.length === 0;
  return {
    eligible,
    blockers,
    rationale: eligible
      ? "Engine meets all promotion thresholds"
      : `Engine blocked: ${blockers.join(", ")}`,
  };
}

export async function persistPromotionCandidate(engineId: string, scorecard: EngineScorecard) {
  const result = evaluatePromotionEligibility(scorecard);
  return prisma.promotionCandidate.create({
    data: {
      engineId,
      eligible: result.eligible,
      completedTrades: scorecard.completedTrades,
      profitFactor: scorecard.profitFactor,
      expectancy: scorecard.expectancy,
      sharpeRatio: scorecard.sharpeRatio,
      maxDrawdownPct: scorecard.maxDrawdownPct,
      winRate: scorecard.winRate,
      rejectAccuracy: scorecard.rejectAccuracy,
      decisionStability: scorecard.decisionStability,
      replayAccuracy: scorecard.replayAccuracy,
      blockers: result.blockers as Prisma.InputJsonValue,
      rationale: result.rationale,
    },
  });
}

export async function getLatestPromotionStatus(engineId?: string) {
  return prisma.promotionCandidate.findMany({
    where: engineId ? { engineId } : undefined,
    orderBy: { evaluatedAt: "desc" },
    take: engineId ? 1 : 50,
  });
}
