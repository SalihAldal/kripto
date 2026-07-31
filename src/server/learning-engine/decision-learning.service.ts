import { prisma } from "@/src/server/db/prisma";
import { persistDecisionMemory } from "@/src/server/learning-engine/learning-engine.repository";
import type { DecisionLearningRecord } from "@/src/server/learning-engine/learning-engine.types";

export async function learnFromDecision(decisionId: string) {
  const row = await prisma.decisionLog.findUnique({
    where: { decisionId },
    include: { timelineEvents: true, featureSnapshot: true, rejectReasonRows: true },
  });
  if (!row) return null;

  const evaluation = await prisma.decisionEvaluation.findFirst({
    where: { decisionId },
    orderBy: { createdAt: "desc" },
  });
  const replay = await prisma.decisionReplay.findFirst({
    where: { decisionId },
    orderBy: { completedAt: "desc" },
    include: { evaluation: true },
  });

  const record: DecisionLearningRecord = {
    decisionId: row.decisionId,
    symbol: row.symbol,
    decision: row.decision,
    confidence: row.confidence ?? undefined,
    reasoning: row.humanSummary ?? undefined,
    expertOpinions: (row.metadata as Record<string, unknown> | null)?.expertOpinions,
    scannerProfile: {
      scannerScore: row.scannerScore,
      technicalScore: row.technicalScore,
      volumeScore: row.volumeScore,
      momentumScore: row.momentumScore,
      trendScore: row.trendScore,
      regimeScore: row.regimeScore,
      riskScore: row.riskScore,
      liquidityScore: row.liquidityScore,
      newsScore: row.newsScore,
    },
    marketSnapshot: row.marketState,
    outcome: evaluation?.verdict ?? replay?.evaluation?.verdict ?? undefined,
    learningSummary: buildDecisionSummary(row, evaluation, replay?.evaluation ?? null),
  };

  await persistDecisionMemory(record);
  return record;
}

export async function learnFromRecentDecisions(limit = 50) {
  const rows = await prisma.decisionLog.findMany({ orderBy: { timestamp: "desc" }, take: limit, select: { decisionId: true } });
  let learned = 0;
  for (const row of rows) {
    await learnFromDecision(row.decisionId).catch(() => null);
    learned += 1;
  }
  return { learned };
}

function buildDecisionSummary(
  row: { decision: string; symbol: string; confidence: number | null; executionAllowed: boolean },
  evaluation: { verdict?: string | null; missedProfitPct?: number | null } | null,
  replay: { verdict?: string | null } | null,
) {
  const verdict = evaluation?.verdict ?? replay?.verdict ?? "PENDING";
  const missed = evaluation?.missedProfitPct ?? 0;
  return `${row.decision} on ${row.symbol} conf=${row.confidence ?? 0} verdict=${verdict} missed=${missed}% execAllowed=${row.executionAllowed}`;
}
