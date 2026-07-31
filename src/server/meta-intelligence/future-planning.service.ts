import { persistExecutiveRecommendation } from "@/src/server/meta-intelligence/meta-intelligence.repository";
import { getLatestContext } from "@/src/server/meta-intelligence/meta-intelligence.repository";
import { prisma } from "@/src/server/db/prisma";

export async function planFutureHorizon() {
  const ctx = await getLatestContext();
  const regime = ctx?.marketRegime ?? "UNKNOWN";

  const tomorrow = {
    focus: ["Monitor overnight news flow", "Review whale alert queue", "Check open position exposure"],
    risks: ["Gap risk on macro events", "Exchange flow anomalies"],
    opportunities: regime === "BULL_EXPANSION" ? ["Momentum continuation setups"] : ["Mean reversion if oversold"],
  };

  const nextWeek = {
    focus: ["Weekly CIO report", "Research pipeline review", "Engineering health check"],
    watchlist: ["BTC", "ETH", "SOL"],
    researchWatchlist: ["AI narrative tokens", "Layer2 protocols"],
  };

  const nextMonth = {
    focus: ["Monthly IC report", "Strategic objective review", "Learning engine calibration"],
    potentialRisks: ["Regulatory developments", "Liquidity rotation", "Technical debt accumulation"],
    potentialOpportunities: ["New narrative emergence", "Institutional flow increase"],
  };

  await persistExecutiveRecommendation({
    category: "PLANNING",
    title: "Tomorrow — Executive Focus Areas",
    description: tomorrow.focus.join("; "),
    supportingEvidence: tomorrow,
    confidence: 70,
    expectedBenefit: "Proactive risk management",
    priority: "MEDIUM",
    affectedModules: ["meta-intelligence"],
  });

  await persistExecutiveRecommendation({
    category: "PLANNING",
    title: "Next Week — Research & Market Watchlist",
    description: `Watch: ${nextWeek.watchlist.join(", ")}. Research: ${nextWeek.researchWatchlist.join(", ")}`,
    supportingEvidence: nextWeek,
    confidence: 65,
    priority: "MEDIUM",
    affectedModules: ["quant-research", "scanner"],
  });

  const narratives = await prisma.marketNarrative.findMany({ where: { active: true }, orderBy: { heatScore: "desc" }, take: 5 });

  return { tomorrow, nextWeek, nextMonth, activeNarratives: narratives.length, regime };
}
