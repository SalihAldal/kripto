import type { MissedOpportunityCategory, Prisma } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";

export async function analyzeMissedOpportunities(input?: { userId?: string; limit?: number }) {
  const limit = input?.limit ?? 50;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [rejectedDecisions, replays, paperTrades] = await Promise.all([
    prisma.decisionLog.findMany({
      where: {
        decision: "REJECT",
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { decisionId: true, symbol: true, metadata: true },
    }),
    prisma.decisionReplay.findMany({
      where: { status: "COMPLETED", completedAt: { gte: since } },
      include: { evaluation: true, missedOpportunity: true },
      take: limit * 2,
    }),
    prisma.paperTrade.findMany({
      where: input?.userId ? { userId: input.userId, status: "CLOSED" } : { status: "CLOSED", closedAt: { gte: since } },
      take: limit,
    }),
  ]);

  const opportunities: Array<{
    userId: string;
    decisionId: string | null;
    symbol: string;
    category: MissedOpportunityCategory;
    baselineReturnPct: number | null;
    potentialReturnPct: number | null;
    evidence: Record<string, unknown>;
  }> = [];

  for (const decision of rejectedDecisions) {
    const replay = replays.find((r) => r.decisionId === decision.decisionId);
    const missed = replay?.missedOpportunity;
    opportunities.push({
      userId: input?.userId ?? String((decision.metadata as Record<string, unknown> | null)?.userId ?? "system"),
      decisionId: decision.decisionId,
      symbol: decision.symbol,
      category: "REJECTED",
      baselineReturnPct: 0,
      potentialReturnPct: missed ? Number(missed.bestReturnPct) : replay?.evaluation?.peakProfitPct ?? null,
      evidence: { verdict: replay?.evaluation?.verdict, missedProfitPct: replay?.evaluation?.missedProfitPct },
    });
  }

  for (const replay of replays) {
    const verdict = replay.evaluation?.verdict;
    if (!verdict) continue;

    if (verdict === "LATE_ENTRY") {
      opportunities.push({
        userId: input?.userId ?? "system",
        decisionId: replay.decisionId,
        symbol: replay.symbol,
        category: "LATE_ENTRY",
        baselineReturnPct: replay.evaluation?.mfePct ?? null,
        potentialReturnPct: replay.evaluation?.peakProfitPct ?? null,
        evidence: { verdict },
      });
    }
    if (verdict === "EARLY_EXIT") {
      opportunities.push({
        userId: input?.userId ?? "system",
        decisionId: replay.decisionId,
        symbol: replay.symbol,
        category: "EARLY_EXIT",
        baselineReturnPct: replay.evaluation?.maePct ?? null,
        potentialReturnPct: replay.evaluation?.missedProfitPct ?? null,
        evidence: { verdict },
      });
    }
    if (verdict === "LATE_EXIT") {
      opportunities.push({
        userId: input?.userId ?? "system",
        decisionId: replay.decisionId,
        symbol: replay.symbol,
        category: "LATE_EXIT",
        baselineReturnPct: replay.evaluation?.maePct ?? null,
        potentialReturnPct: replay.evaluation?.missedLossPct ?? null,
        evidence: { verdict },
      });
    }
    if (verdict === "FALSE_BUY" || verdict === "WRONG") {
      opportunities.push({
        userId: input?.userId ?? "system",
        decisionId: replay.decisionId,
        symbol: replay.symbol,
        category: "FALSE_POSITIVE",
        baselineReturnPct: replay.evaluation?.maePct ?? null,
        potentialReturnPct: 0,
        evidence: { verdict },
      });
    }
    if (verdict === "MISSED_WINNER" || verdict === "MISSED_BREAKOUT" || verdict === "MISSED_PUMP") {
      opportunities.push({
        userId: input?.userId ?? "system",
        decisionId: replay.decisionId,
        symbol: replay.symbol,
        category: "FALSE_NEGATIVE",
        baselineReturnPct: 0,
        potentialReturnPct: replay.evaluation?.missedProfitPct ?? replay.evaluation?.peakProfitPct ?? null,
        evidence: { verdict },
      });
    }
  }

  for (const trade of paperTrades.filter((t) => t.returnPct < 0)) {
    opportunities.push({
      userId: trade.userId,
      decisionId: trade.decisionId,
      symbol: trade.symbol,
      category: "IGNORED",
      baselineReturnPct: trade.returnPct,
      potentialReturnPct: null,
      evidence: { tradeKey: trade.tradeKey, holdSec: trade.holdSec },
    });
  }

  const persisted = [];
  for (const opp of opportunities.slice(0, limit)) {
    const row = await prisma.paperMissedOpportunity.create({
      data: {
        userId: opp.userId,
        decisionId: opp.decisionId,
        symbol: opp.symbol,
        category: opp.category,
        baselineReturnPct: opp.baselineReturnPct,
        potentialReturnPct: opp.potentialReturnPct,
        evidence: opp.evidence as Prisma.InputJsonValue,
      },
    });
    persisted.push(row);
  }

  return { analyzed: opportunities.length, persisted: persisted.length, categories: summarizeCategories(persisted) };
}

function summarizeCategories(rows: Array<{ category: MissedOpportunityCategory }>) {
  const map = new Map<MissedOpportunityCategory, number>();
  for (const row of rows) {
    map.set(row.category, (map.get(row.category) ?? 0) + 1);
  }
  return Object.fromEntries(map);
}
