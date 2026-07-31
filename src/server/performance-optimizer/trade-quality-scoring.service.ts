import { prisma } from "@/src/server/db/prisma";
import { persistTradeQuality } from "@/src/server/performance-optimizer/performance-optimizer.repository";
import { emitPerfOptEvent, PERF_OPT_EVENT } from "@/src/server/performance-optimizer/performance-optimizer.events";

function clamp(v: number) { return Math.max(0, Math.min(100, v)); }

export async function scoreTradeQuality(limit = 30) {
  const positions = await prisma.position.findMany({
    where: { status: "CLOSED" },
    orderBy: { closedAt: "desc" },
    take: limit,
    include: { tradingPair: { select: { symbol: true } } },
  }).catch(() => []);

  const results = [];
  for (const pos of positions) {
    const symbol = pos.tradingPair?.symbol ?? "";
    if (!symbol) continue;

    const [entryAnalysis, exitAnalysis, entryQuality, exitQuality] = await Promise.all([
      prisma.entryAnalysis.findFirst({ where: { symbol }, orderBy: { analyzedAt: "desc" } }).catch(() => null),
      prisma.exitAnalysis.findFirst({ where: { symbol, positionId: pos.id }, orderBy: { analyzedAt: "desc" } }).catch(() => null),
      prisma.entryQuality.findFirst({ where: { symbol }, orderBy: { scoredAt: "desc" } }).catch(() => null),
      prisma.exitQuality.findFirst({ where: { symbol }, orderBy: { scoredAt: "desc" } }).catch(() => null),
    ]);

    const entryQ = entryQuality?.qualityScore ?? entryAnalysis?.entryScore ?? 50;
    const exitQ = exitQuality?.qualityScore ?? exitAnalysis?.exitScore ?? 50;
    const pnlPct = pos.entryPrice > 0 ? ((pos.closePrice ?? pos.entryPrice) - pos.entryPrice) / pos.entryPrice * 100 : 0;
    const timingScore = clamp(50 + pnlPct * 5);
    const decisionQuality = clamp(entryAnalysis?.entryConfidence ?? 50);
    const executionQuality = clamp(pos.realizedPnl >= 0 ? 70 : 40);
    const riskScore = clamp(100 - (exitAnalysis?.riskScore ?? 50));
    const overall = clamp(entryQ * 0.25 + exitQ * 0.25 + timingScore * 0.2 + decisionQuality * 0.15 + executionQuality * 0.1 + riskScore * 0.05);

    const record = await persistTradeQuality({
      positionId: pos.id,
      symbol,
      entryQuality: Number(entryQ.toFixed(1)),
      exitQuality: Number(exitQ.toFixed(1)),
      timingScore: Number(timingScore.toFixed(1)),
      riskScore: Number(riskScore.toFixed(1)),
      decisionQuality: Number(decisionQuality.toFixed(1)),
      executionQuality: Number(executionQuality.toFixed(1)),
      overallScore: Number(overall.toFixed(1)),
      metadata: { pnlPct, realizedPnl: pos.realizedPnl },
    });
    results.push(record);
    emitPerfOptEvent(PERF_OPT_EVENT.TRADE_QUALITY_SCORED, { symbol, overallScore: overall });
  }
  return { scored: results.length, qualities: results };
}
