import { prisma } from "@/src/server/db/prisma";
import { persistStrategyCandidate } from "@/src/server/quant-research/quant-research.repository";
import { PROMOTION_RULES, type PerformanceMetrics } from "@/src/server/quant-research/quant-research.types";

export type PromotionEvaluation = {
  eligible: boolean;
  status: "NOT_ELIGIBLE" | "UNDER_REVIEW" | "ELIGIBLE" | "REJECTED";
  blockers: string[];
  metrics: Partial<PerformanceMetrics & { rejectAccuracy?: number; replayAccuracy?: number; outperformDays?: number; walkForwardPassed?: boolean; monteCarloPassed?: boolean }>;
};

export function evaluatePromotionEligibility(input: PromotionEvaluation["metrics"]): PromotionEvaluation {
  const blockers: string[] = [];

  if ((input.tradeCount ?? 0) < PROMOTION_RULES.minSimulatedTrades) {
    blockers.push(`tradeCount<${PROMOTION_RULES.minSimulatedTrades}`);
  }
  if ((input.profitFactor ?? 0) < PROMOTION_RULES.minProfitFactor) {
    blockers.push(`profitFactor<${PROMOTION_RULES.minProfitFactor}`);
  }
  if ((input.expectancy ?? 0) <= PROMOTION_RULES.minExpectancy) {
    blockers.push("expectancy<=0");
  }
  if ((input.sharpe ?? 0) < PROMOTION_RULES.minSharpe) {
    blockers.push(`sharpe<${PROMOTION_RULES.minSharpe}`);
  }
  if ((input.maxDrawdownPct ?? 100) > PROMOTION_RULES.maxDrawdownPct) {
    blockers.push(`maxDrawdown>${PROMOTION_RULES.maxDrawdownPct}%`);
  }
  if ((input.rejectAccuracy ?? 0) < PROMOTION_RULES.minRejectAccuracy) {
    blockers.push(`rejectAccuracy<${PROMOTION_RULES.minRejectAccuracy}%`);
  }
  if ((input.replayAccuracy ?? 0) < PROMOTION_RULES.minReplayAccuracy) {
    blockers.push(`replayAccuracy<${PROMOTION_RULES.minReplayAccuracy}%`);
  }
  if (!input.walkForwardPassed) blockers.push("walkForwardFailed");
  if (!input.monteCarloPassed) blockers.push("monteCarloFailed");
  if ((input.outperformDays ?? 0) < PROMOTION_RULES.minOutperformDays) {
    blockers.push(`outperformDays<${PROMOTION_RULES.minOutperformDays}`);
  }

  const eligible = blockers.length === 0;
  return {
    eligible,
    status: eligible ? "ELIGIBLE" : blockers.length <= 3 ? "UNDER_REVIEW" : "NOT_ELIGIBLE",
    blockers,
    metrics: input,
  };
}

export async function evaluateCandidatePromotion(candidateId: string) {
  const candidate = await prisma.strategyCandidate.findUnique({
    where: { id: candidateId },
    include: { genome: true },
  });
  if (!candidate) return null;

  const metrics = (candidate.metrics as PromotionEvaluation["metrics"] | null) ?? {};
  const [wf, mc] = await Promise.all([
    prisma.walkForwardRun.findFirst({ where: { genomeId: candidate.genomeId }, orderBy: { createdAt: "desc" } }),
    prisma.monteCarloRun.findFirst({ where: { genomeId: candidate.genomeId }, orderBy: { createdAt: "desc" } }),
  ]);

  const evalInput: PromotionEvaluation["metrics"] = {
    ...metrics,
    walkForwardPassed: wf?.passed ?? false,
    monteCarloPassed: mc?.passed ?? false,
  };

  const result = evaluatePromotionEligibility(evalInput);
  await persistStrategyCandidate({
    genomeId: candidate.genomeId,
    candidateKey: candidate.candidateKey,
    rank: candidate.rank ?? undefined,
    score: candidate.score ?? undefined,
    metrics: metrics as PerformanceMetrics,
    promotionStatus: result.status,
    blockers: result.blockers,
  });

  return result;
}

export async function listPromotionCandidates(limit = 30) {
  return prisma.strategyCandidate.findMany({
    orderBy: { score: "desc" },
    take: limit,
    include: { genome: true },
  });
}
