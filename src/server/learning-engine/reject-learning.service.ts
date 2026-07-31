import { prisma } from "@/src/server/db/prisma";
import { persistRejectLearning } from "@/src/server/learning-engine/learning-engine.repository";
import type { RejectLearningVerdict } from "@/src/server/learning-engine/learning-engine.types";

export async function evaluateRejectLearning(decisionId: string): Promise<RejectLearningVerdict | null> {
  const log = await prisma.decisionLog.findUnique({ where: { decisionId } });
  if (!log) return null;
  if (!["NO_TRADE", "HOLD", "REJECT", "WATCHLIST"].includes(log.decision.toUpperCase())) return null;

  const evaluation = await prisma.decisionEvaluation.findFirst({
    where: { decisionId },
    orderBy: { createdAt: "desc" },
  });
  const missed = await prisma.missedOpportunity.findFirst({ where: { decisionId }, orderBy: { createdAt: "desc" } });

  const missedProfit = Number(evaluation?.missedProfitPct ?? missed?.missedProfitPct ?? 0);
  const avoidedLoss = Number(evaluation?.missedLossPct ?? missed?.missedLossPct ?? 0);
  const wasCorrect =
    evaluation?.verdict === "CORRECT" ||
    (missedProfit <= 1 && avoidedLoss >= 0) ||
    (["WRONG", "MISSED_WINNER", "MISSED_BREAKOUT", "MISSED_PUMP"].includes(evaluation?.verdict ?? "")
      ? false
      : missedProfit < 2);

  const verdict: RejectLearningVerdict = {
    decisionId,
    wasCorrect,
    missedProfitPct: missedProfit,
    avoidedLossPct: avoidedLoss,
    verdict: wasCorrect ? "CORRECT" : "WRONG",
  };
  await persistRejectLearning(verdict);
  return verdict;
}

export async function learnFromRecentRejects(limit = 100) {
  const rows = await prisma.decisionLog.findMany({
    where: { decision: { in: ["NO_TRADE", "HOLD", "REJECT", "WATCHLIST"] } },
    orderBy: { timestamp: "desc" },
    take: limit,
    select: { decisionId: true },
  });
  let learned = 0;
  for (const row of rows) {
    const result = await evaluateRejectLearning(row.decisionId).catch(() => null);
    if (result) learned += 1;
  }
  return { learned };
}
