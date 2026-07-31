import { persistExecutiveKpi } from "@/src/server/meta-intelligence/meta-intelligence.repository";
import { emitMetaEvent, META_EVENT } from "@/src/server/meta-intelligence/meta-intelligence.events";
import { prisma } from "@/src/server/db/prisma";

export async function trackExecutiveKpis() {
  const [engHealth, openPositions, learningJobs, researchJobs, decisions, newsImpact, whaleAlerts, onChainHealth] = await Promise.all([
    prisma.engineeringHealth.findFirst({ orderBy: { scoredAt: "desc" } }),
    prisma.position.count({ where: { status: "OPEN" } }).catch(() => 0),
    prisma.learningEngineJobState.count({ where: { status: "COMPLETED" } }).catch(() => 0),
    prisma.quantResearchJobState.count({ where: { status: "COMPLETED" } }).catch(() => 0),
    prisma.decisionLog.count().catch(() => 0),
    prisma.newsImpact.count({ where: { impactScore: { gte: 50 } } }).catch(() => 0),
    prisma.whaleAlert.count({ where: { isActive: true } }).catch(() => 0),
    prisma.protocolHealth.findMany({ orderBy: { overallHealth: "desc" }, take: 5 }).catch(() => []),
  ]);

  const platformHealth = engHealth?.overallScore ?? 65;
  const tradingHealth = Math.max(30, 100 - openPositions * 4);
  const learningVelocity = Math.min(100, learningJobs * 10 + 40);
  const researchVelocity = Math.min(100, researchJobs * 12 + 35);
  const systemStability = engHealth?.reliabilityScore ?? 70;
  const decisionAccuracy = Math.min(100, 55 + (decisions > 0 ? 10 : 0));
  const engineeringHealthScore = engHealth?.overallScore ?? 60;
  const riskExposure = Math.min(100, openPositions * 6 + whaleAlerts * 3);
  const portfolioHealth = Math.max(20, 100 - openPositions * 5);
  const onChainAvg = onChainHealth.length > 0 ? onChainHealth.reduce((s, p) => s + p.overallHealth, 0) / onChainHealth.length : 50;
  const marketIntelligenceQuality = Math.min(100, (newsImpact * 2 + onChainAvg) / 3);

  const overallExecutiveScore = Number(
    (
      (platformHealth + tradingHealth + learningVelocity + researchVelocity +
        systemStability + decisionAccuracy + engineeringHealthScore +
        (100 - riskExposure) + portfolioHealth + marketIntelligenceQuality) /
      10
    ).toFixed(1),
  );

  const kpi = await persistExecutiveKpi({
    platformHealth,
    tradingHealth,
    learningVelocity,
    researchVelocity,
    systemStability,
    decisionAccuracy,
    engineeringHealth: engineeringHealthScore,
    riskExposure,
    portfolioHealth,
    marketIntelligenceQuality,
    overallExecutiveScore: Number(overallExecutiveScore),
  });

  emitMetaEvent(META_EVENT.KPI_RECORDED, { overallExecutiveScore, kpiId: kpi.id });
  return kpi;
}
