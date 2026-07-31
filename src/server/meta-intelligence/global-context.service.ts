import { prisma } from "@/src/server/db/prisma";
import { persistMetaContext } from "@/src/server/meta-intelligence/meta-intelligence.repository";
import { emitMetaEvent, META_EVENT } from "@/src/server/meta-intelligence/meta-intelligence.events";
import type { GlobalMarketContext, MarketRegime } from "@/src/server/meta-intelligence/meta-intelligence.types";

async function safeSnapshot<T>(fn: () => Promise<T>): Promise<Record<string, unknown>> {
  try {
    const result = await fn();
    return result as Record<string, unknown>;
  } catch {
    return { unavailable: true };
  }
}

function inferRegime(signals: { news?: number; whale?: number; onChain?: number }): MarketRegime {
  const bullish = (signals.news ?? 0) + (signals.whale ?? 0) + (signals.onChain ?? 0);
  if (bullish > 150) return "BULL_EXPANSION";
  if (bullish < 50) return "RISK_OFF";
  if ((signals.whale ?? 0) > 70 && (signals.onChain ?? 0) < 40) return "LIQUIDITY_ROTATION";
  return "SIDEWAYS";
}

export async function buildGlobalContext() {
  const [
    newsImpact,
    whaleScores,
    onChainHealth,
    engineeringHealth,
    openPositions,
    recentDecisions,
    learningJobs,
    governanceHealth,
  ] = await Promise.all([
    safeSnapshot(() => prisma.newsImpact.findMany({ orderBy: { impactScore: "desc" }, take: 10 })),
    safeSnapshot(() => prisma.whaleScore.findMany({ orderBy: { whaleActivityScore: "desc" }, take: 10 })),
    safeSnapshot(() => prisma.protocolHealth.findMany({ orderBy: { overallHealth: "desc" }, take: 10 })),
    safeSnapshot(() => prisma.engineeringHealth.findFirst({ orderBy: { scoredAt: "desc" } })),
    safeSnapshot(() => prisma.position.count({ where: { status: "OPEN" } }).then((c) => ({ openPositions: c }))),
    safeSnapshot(() => prisma.decisionLog.findMany({ orderBy: { createdAt: "desc" }, take: 10, select: { symbol: true, decision: true, confidence: true } })),
    safeSnapshot(() => prisma.learningEngineJobState.findMany({ take: 5 })),
    safeSnapshot(() => prisma.aiGovernanceJobState.findMany({ take: 5 })),
  ]);

  const newsScore = Array.isArray(newsImpact) ? (newsImpact as Array<{ impactScore?: number }>).reduce((s, n) => s + (n.impactScore ?? 0), 0) / Math.max(1, (newsImpact as unknown[]).length) : 50;
  const whaleScore = Array.isArray(whaleScores) ? (whaleScores as Array<{ whaleActivityScore?: number }>).reduce((s, w) => s + (w.whaleActivityScore ?? 0), 0) / Math.max(1, (whaleScores as unknown[]).length) : 50;
  const onChainScore = Array.isArray(onChainHealth) ? (onChainHealth as Array<{ overallHealth?: number }>).reduce((s, o) => s + (o.overallHealth ?? 0), 0) / Math.max(1, (onChainHealth as unknown[]).length) : 50;

  const marketRegime = inferRegime({ news: newsScore, whale: whaleScore, onChain: onChainScore });

  const context: GlobalMarketContext = {
    marketRegime,
    scanner: { status: "read-only", note: "Scanner not modified — snapshot placeholder" },
    news: { topImpact: newsImpact, avgScore: newsScore },
    whale: { topScores: whaleScores, avgActivity: whaleScore },
    onChain: { protocolHealth: onChainHealth, avgHealth: onChainScore },
    portfolio: openPositions,
    risk: { status: "read-only", exposureLevel: whaleScore > 70 ? "ELEVATED" : "NORMAL" },
    learning: { jobs: learningJobs },
    research: { status: "read-only" },
    governance: { jobs: governanceHealth },
    engineering: engineeringHealth,
  };

  const row = await persistMetaContext({
    ...context,
    confidence: {
      overallConfidence: (newsScore + whaleScore + onChainScore) / 3,
      dataConfidence: engineeringHealth && typeof engineeringHealth === "object" && "overallScore" in engineeringHealth ? Number((engineeringHealth as { overallScore: number }).overallScore) : 60,
    },
  });

  emitMetaEvent(META_EVENT.CONTEXT_BUILT, { contextId: row.id, marketRegime });
  return { contextId: row.id, marketRegime, context };
}
