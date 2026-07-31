import { prisma } from "@/src/server/db/prisma";
import { persistExecutiveRecommendation } from "@/src/server/meta-intelligence/meta-intelligence.repository";

export async function learnExecutiveInsights(limit = 50) {
  const [engHealth, openRecs, zeroImpactNews, weakModules] = await Promise.all([
    prisma.engineeringHealth.findFirst({ orderBy: { scoredAt: "desc" } }),
    prisma.engineeringRecommendation.count({ where: { status: "OPEN" } }).catch(() => 0),
    prisma.newsImpact.count({ where: { impactScore: { lt: 20 } } }).catch(() => 0),
    prisma.architectureAudit.count({ where: { status: "WARNING" } }).catch(() => 0),
  ]);

  const weaknesses = [];
  if ((engHealth?.overallScore ?? 100) < 70) weaknesses.push({ area: "ENGINEERING", score: engHealth?.overallScore, issue: "Platform engineering health below target" });
  if (openRecs > 10) weaknesses.push({ area: "ARCHITECTURE", count: openRecs, issue: "Accumulated engineering recommendations unresolved" });
  if (zeroImpactNews > 20) weaknesses.push({ area: "NEWS_INTELLIGENCE", count: zeroImpactNews, issue: "Many news events had zero market impact" });
  if (weakModules > 5) weaknesses.push({ area: "ARCHITECTURE", count: weakModules, issue: "Multiple architecture warnings detected" });

  let recommendations = 0;
  for (const w of weaknesses.slice(0, limit)) {
    await persistExecutiveRecommendation({
      category: w.area,
      title: `Address ${w.area} weakness`,
      description: w.issue,
      supportingEvidence: w,
      confidence: 70,
      expectedBenefit: "Improved platform reliability and decision quality",
      expectedRisk: "Low — recommendation only",
      implementationCost: "Varies by area",
      priority: w.area === "ENGINEERING" ? "HIGH" : "MEDIUM",
      affectedModules: [w.area.toLowerCase()],
    });
    recommendations += 1;
  }

  return { weaknesses, recommendationsCreated: recommendations };
}
