import { env } from "@/lib/config";
import { prisma } from "@/src/server/db/prisma";

export async function comparePaperVsLive() {
  const isPaper = env.BINANCE_DRY_RUN ?? true;
  const since = new Date(Date.now() - 7 * 86400_000);

  const [paperPositions, livePositions, paperDecisions, liveDecisions] = await Promise.all([
    isPaper ? prisma.position.findMany({ where: { openedAt: { gte: since } }, take: 100 }).catch(() => []) : [],
    !isPaper ? prisma.position.findMany({ where: { openedAt: { gte: since } }, take: 100 }).catch(() => []) : [],
    prisma.decisionLog.findMany({ where: { createdAt: { gte: since } }, take: 100 }).catch(() => []),
    prisma.decisionLog.findMany({ where: { createdAt: { gte: since }, executionAllowed: true }, take: 100 }).catch(() => []),
  ]);

  const paperProfit = paperPositions.reduce((s, p) => s + (p.realizedPnl ?? 0), 0);
  const liveProfit = livePositions.reduce((s, p) => s + (p.realizedPnl ?? 0), 0);

  return {
    mode: isPaper ? "PAPER" : "LIVE",
    paper: { positions: paperPositions.length, profit: paperProfit, decisions: paperDecisions.length },
    live: { positions: livePositions.length, profit: liveProfit, decisions: liveDecisions.length },
    profitDifference: liveProfit - paperProfit,
    decisionDifference: liveDecisions.length - paperDecisions.length,
    slippageEstimate: isPaper ? 0 : Math.abs(liveProfit - paperProfit) * 0.01,
    note: "Comparison based on available position/decision data — read-only analysis",
  };
}
