import { prisma } from "@/src/server/db/prisma";

export async function rankPriorities(limit = 30) {
  const [decisions, recommendations, alerts, narratives, debt] = await Promise.all([
    prisma.executiveDecision.findMany({ orderBy: [{ priority: "asc" }, { decidedAt: "desc" }], take: limit }),
    prisma.executiveRecommendation.findMany({ where: { status: "OPEN" }, orderBy: [{ priority: "asc" }, { createdAt: "desc" }], take: limit }),
    prisma.whaleAlert.findMany({ where: { isActive: true }, orderBy: { severity: "desc" }, take: limit }).catch(() => []),
    prisma.marketNarrative.findMany({ where: { active: true }, orderBy: { heatScore: "desc" }, take: limit }),
    prisma.technicalDebt.findMany({ where: { isResolved: false }, orderBy: { interestScore: "desc" }, take: 10 }).catch(() => []),
  ]);

  const ranked = [
    ...decisions.map((d) => ({ type: "DECISION" as const, priority: d.priority, title: d.recommendation, score: d.overallConfidence, id: d.id })),
    ...recommendations.map((r) => ({ type: "RECOMMENDATION" as const, priority: r.priority, title: r.title, score: r.confidence, id: r.id })),
    ...alerts.map((a) => ({ type: "ALERT" as const, priority: "HIGH" as const, title: a.message, score: a.severity, id: a.id })),
    ...narratives.map((n) => ({ type: "NARRATIVE" as const, priority: "MEDIUM" as const, title: n.title, score: n.heatScore, id: n.id })),
    ...debt.map((d) => ({ type: "DEBT" as const, priority: d.severity as "CRITICAL" | "HIGH" | "MEDIUM" | "LOW", title: d.title, score: d.interestScore, id: d.id })),
  ];

  const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  ranked.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || b.score - a.score);

  return { ranked: ranked.slice(0, limit), counts: { decisions: decisions.length, recommendations: recommendations.length, alerts: alerts.length, narratives: narratives.length } };
}
