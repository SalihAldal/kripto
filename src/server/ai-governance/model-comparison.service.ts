import { prisma } from "@/src/server/db/prisma";
import type { ModelScorecard } from "@/src/server/ai-governance/ai-governance.types";

export async function compareModelScorecards(candidateVersionId: string, productionVersionId?: string) {
  const candidate = await buildScorecard(candidateVersionId);
  const production = productionVersionId
    ? await buildScorecard(productionVersionId)
    : emptyScorecard("production-baseline");

  const delta = {
    scoreDelta: candidate.score - production.score,
    profitFactorDelta: (candidate.profitFactor ?? 0) - (production.profitFactor ?? 0),
    winRateDelta: (candidate.winRate ?? 0) - (production.winRate ?? 0),
    drawdownDelta: (candidate.maxDrawdownPct ?? 0) - (production.maxDrawdownPct ?? 0),
  };

  return { candidate, production, delta, winner: candidate.score >= production.score ? "candidate" : "production" };
}

async function buildScorecard(versionId: string): Promise<ModelScorecard> {
  const version = await prisma.modelVersion.findUnique({ where: { id: versionId }, include: { registry: true } });
  if (!version) return emptyScorecard(versionId);

  const trades = await prisma.learningTrade.findMany({
    where: { closedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60_000) } },
    take: 300,
    select: { returnPercent: true, outcome: true },
  });
  const returns = trades.map((t) => Number(t.returnPercent ?? 0));
  const wins = trades.filter((t) => t.outcome === "WIN").length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  const grossProfit = returns.filter((r) => r > 0).reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(returns.filter((r) => r < 0).reduce((s, r) => s + r, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit;
  let equity = 100;
  let peak = 100;
  let maxDd = 0;
  for (const r of returns) {
    equity *= 1 + r / 100;
    if (equity > peak) peak = equity;
    maxDd = Math.max(maxDd, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
  }
  const sharpe = returns.length > 1 ? calcSharpe(returns) : 0;
  const score = winRate * 0.2 + profitFactor * 10 + sharpe * 5 - maxDd * 2;

  return {
    versionId,
    versionTag: version.versionTag,
    stage: version.stage,
    profitFactor: Number(profitFactor.toFixed(3)),
    winRate: Number(winRate.toFixed(2)),
    sharpe: Number(sharpe.toFixed(3)),
    maxDrawdownPct: Number(maxDd.toFixed(2)),
    score: Number(score.toFixed(2)),
  };
}

function calcSharpe(returns: number[]) {
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return variance > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(252) : 0;
}

function emptyScorecard(id: string): ModelScorecard {
  return { versionId: id, versionTag: "0.0.0", stage: "EXPERIMENTAL", score: 0 };
}

export async function compareAllVersions(registryId: string) {
  const versions = await prisma.modelVersion.findMany({ where: { registryId }, orderBy: { createdAt: "desc" }, take: 10 });
  const scorecards = [];
  for (const v of versions) {
    scorecards.push(await buildScorecard(v.id));
  }
  scorecards.sort((a, b) => b.score - a.score);
  return scorecards;
}
