import { prisma } from "@/src/server/db/prisma";
import { persistLearningInsight } from "@/src/server/learning-platform/learning-platform.repository";

export async function evaluateMissedOpportunitiesForLearning(limit = 100) {
  const rows = await prisma.missedOpportunity.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      replay: {
        include: { evaluation: { select: { peakProfitPct: true, verdict: true } } },
      },
    },
  });

  const insights = [];
  for (const row of rows) {
    const missedProfit = Number(row.missedProfitPct ?? 0);
    const shouldHaveEntered = missedProfit > 0.5;
    const rejectionCorrect = !shouldHaveEntered;

    const insight = await persistLearningInsight({
      category: "MISSED_OPPORTUNITY",
      title: `${row.symbol}: ${shouldHaveEntered ? "Should have entered" : "Rejection correct"}`,
      content: `Missed profit ${missedProfit.toFixed(2)}%. Rejection reason: ${row.reasonRejected ?? "unknown"}. Was rejection correct: ${rejectionCorrect}`,
      symbol: row.symbol,
      severity: missedProfit > 2 ? "WARN" : "INFO",
      metadata: {
        decisionId: row.decisionId,
        missedProfitPct: missedProfit,
        shouldHaveEntered,
        rejectionCorrect,
        verdict: row.replay?.evaluation?.verdict,
      },
    });
    insights.push(insight);
  }

  return { evaluated: rows.length, insights: insights.length };
}
