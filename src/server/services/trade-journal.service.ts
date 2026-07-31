import { prisma } from "@/src/server/db/prisma";
import { listTradeHistory } from "@/src/server/repositories/trade.repository";
import { buildSetupFeatureSnapshot } from "@/src/server/metrics/setup-feature-utils";

type TradeJournalItem = {
  positionId: string;
  symbol: string;
  openedAt: string;
  closedAt?: string | null;
  mode: string;
  aiReason?: string | null;
  targetPrice?: number | null;
  stopStartPrice?: number | null;
  targetUpdateCount: number;
  sellReason?: string | null;
  outcome: "PROFIT" | "LOSS" | "BREAKEVEN" | "OPEN";
  netPnl?: number | null;
  aiPredictionPercent?: number | null;
  actualMovePercent?: number | null;
  aiPredictionErrorPercent?: number | null;
};

export type TradeJournalSummary = {
  total: number;
  closed: number;
  winRate: number;
  lossRate: number;
  breakevenRate: number;
  avgPnl: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  profitFactor: number | null;
  maxDrawdown: number | null;
  avgPredictionErrorPercent: number | null;
  modeBreakdown: Record<string, { total: number; closed: number; avgPnl: number | null }>;
  setupInsights?: TradeJournalSetupInsights;
};

type TradeJournalSetupFeatureStat = {
  feature: string;
  samples: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnl: number;
};

export type TradeJournalSetupInsights = {
  generatedAt: string;
  samples: number;
  topWinningFeatures: TradeJournalSetupFeatureStat[];
  topLosingFeatures: TradeJournalSetupFeatureStat[];
  optimizationHints: string[];
  featureStats: TradeJournalSetupFeatureStat[];
};

function toPercentChange(entry: number, exit: number, side: "LONG" | "SHORT") {
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(exit) || exit <= 0) return null;
  if (side === "SHORT") {
    return Number((((entry - exit) / entry) * 100).toFixed(4));
  }
  return Number((((exit - entry) / entry) * 100).toFixed(4));
}

function pickClosestLog(logs: Array<{ createdAt: Date }>, targetAt: Date) {
  if (logs.length === 0) return null;
  let best = logs[0];
  let bestDiff = Math.abs(logs[0].createdAt.getTime() - targetAt.getTime());
  for (const row of logs.slice(1)) {
    const diff = Math.abs(row.createdAt.getTime() - targetAt.getTime());
    if (diff < bestDiff) {
      best = row;
      bestDiff = diff;
    }
  }
  return best;
}

export async function listTradeJournal(input: {
  userId: string;
  limit?: number;
  mode?: string | null;
}): Promise<TradeJournalItem[]> {
  const limit = Math.max(1, Math.min(120, Number(input.limit ?? 60)));
  const modeFilter = input.mode ? String(input.mode).toLowerCase() : null;
  const positions = await prisma.position.findMany({
    where: { userId: input.userId },
    include: {
      tradingPair: true,
      profitLossRecords: {
        orderBy: { recordedAt: "desc" },
        take: 1,
      },
    },
    orderBy: { openedAt: "desc" },
    take: limit,
  });

  const results: TradeJournalItem[] = [];
  for (const position of positions) {
    const meta = (position.metadata as Record<string, unknown> | null) ?? {};
    const mode = String(meta.mode ?? "unknown").toLowerCase();
    if (modeFilter && modeFilter !== "all" && mode !== modeFilter) continue;
    const logs = await prisma.tradeEventLog.findMany({
      where: { positionId: position.id },
      orderBy: { createdAt: "asc" },
    });
    const openAt = position.openedAt;
    const windowStart = new Date(openAt.getTime() - 10 * 60 * 1000);
    const windowEnd = new Date(openAt.getTime() + 10 * 60 * 1000);
    const preLogs = await prisma.tradeEventLog.findMany({
      where: {
        positionId: null,
        symbol: position.tradingPair.symbol.toUpperCase(),
        eventType: { in: ["BUY_DECISION", "TARGET_SELL_CREATED"] },
        createdAt: { gte: windowStart, lte: windowEnd },
      },
      orderBy: { createdAt: "asc" },
    });

    const targetLog = pickClosestLog(
      preLogs.filter((row) => row.eventType === "TARGET_SELL_CREATED"),
      openAt,
    ) as (typeof preLogs)[number] | null;
    const buyDecisionLog = pickClosestLog(
      preLogs.filter((row) => row.eventType === "BUY_DECISION"),
      openAt,
    ) as (typeof preLogs)[number] | null;

    const sellLog = logs.find((row) => row.eventType === "SELL_COMPLETED") ?? null;
    const targetUpdates = logs.filter((row) => row.eventType === "AI_TARGET_RAISED").length;
    const targetPrice = Number((targetLog?.newValue as Record<string, unknown> | undefined)?.targetSellPrice ?? 0) || null;
    const stopStartPrice = Number((targetLog?.newValue as Record<string, unknown> | undefined)?.stopLossPrice ?? 0) || null;
    const aiReason = buyDecisionLog?.reason ?? null;
    const rawSellReason =
      (sellLog?.newValue as Record<string, unknown> | undefined)?.closeReason ??
      sellLog?.reason ??
      (position.metadata as Record<string, unknown> | null)?.closeReason ??
      null;
    const sellReason = typeof rawSellReason === "string" ? rawSellReason : null;
    const entry = position.entryPrice;
    const exit = position.closePrice ?? null;
    const actualMovePercent = exit ? toPercentChange(entry, exit, position.side) : null;
    const aiPredictionPercent =
      targetPrice && entry > 0 ? toPercentChange(entry, targetPrice, position.side) : null;
    const aiPredictionErrorPercent =
      actualMovePercent !== null && aiPredictionPercent !== null
        ? Number(Math.abs(actualMovePercent - aiPredictionPercent).toFixed(4))
        : null;
    const pnl = position.profitLossRecords[0]?.netPnl ?? null;
    const outcome =
      position.status === "OPEN"
        ? "OPEN"
        : pnl === null
          ? "BREAKEVEN"
          : pnl > 0
            ? "PROFIT"
            : pnl < 0
              ? "LOSS"
              : "BREAKEVEN";

    results.push({
      positionId: position.id,
      symbol: position.tradingPair.symbol,
      openedAt: position.openedAt.toISOString(),
      closedAt: position.closedAt?.toISOString() ?? null,
      mode,
      aiReason,
      targetPrice,
      stopStartPrice,
      targetUpdateCount: targetUpdates,
      sellReason,
      outcome,
      netPnl: pnl,
      aiPredictionPercent,
      actualMovePercent,
      aiPredictionErrorPercent,
    });
  }

  return results;
}

export function summarizeTradeJournal(items: TradeJournalItem[]): TradeJournalSummary {
  const total = items.length;
  const closedItems = items.filter((row) => row.outcome !== "OPEN");
  const closed = closedItems.length;
  const wins = closedItems.filter((row) => row.outcome === "PROFIT");
  const losses = closedItems.filter((row) => row.outcome === "LOSS");
  const breakeven = closedItems.filter((row) => row.outcome === "BREAKEVEN");
  const winRate = closed > 0 ? wins.length / closed : 0;
  const lossRate = closed > 0 ? losses.length / closed : 0;
  const breakevenRate = closed > 0 ? breakeven.length / closed : 0;
  const pnlValues = closedItems.map((row) => Number(row.netPnl ?? 0));
  const avgPnl = pnlValues.length > 0 ? Number((pnlValues.reduce((a, b) => a + b, 0) / pnlValues.length).toFixed(4)) : null;
  const avgWin =
    wins.length > 0
      ? Number((wins.map((x) => Number(x.netPnl ?? 0)).reduce((a, b) => a + b, 0) / wins.length).toFixed(4))
      : null;
  const avgLoss =
    losses.length > 0
      ? Number((losses.map((x) => Number(x.netPnl ?? 0)).reduce((a, b) => a + b, 0) / losses.length).toFixed(4))
      : null;
  const grossWin = wins.map((x) => Number(x.netPnl ?? 0)).reduce((a, b) => a + b, 0);
  const grossLossAbs = Math.abs(losses.map((x) => Number(x.netPnl ?? 0)).reduce((a, b) => a + b, 0));
  const profitFactor = grossLossAbs > 0 ? Number((grossWin / grossLossAbs).toFixed(4)) : null;
  const sortedByTime = [...closedItems].sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const row of sortedByTime) {
    equity += Number(row.netPnl ?? 0);
    if (equity > peak) peak = equity;
    const drawdown = peak - equity;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  const predictionErrors = closedItems
    .map((row) => row.aiPredictionErrorPercent)
    .filter((val): val is number => typeof val === "number");
  const avgPredictionErrorPercent =
    predictionErrors.length > 0
      ? Number((predictionErrors.reduce((a, b) => a + b, 0) / predictionErrors.length).toFixed(4))
      : null;
  const modeBreakdown: Record<string, { total: number; closed: number; avgPnl: number | null }> = {};
  for (const item of items) {
    const key = item.mode || "unknown";
    const entry = modeBreakdown[key] ?? { total: 0, closed: 0, avgPnl: null };
    entry.total += 1;
    if (item.outcome !== "OPEN") {
      entry.closed += 1;
    }
    modeBreakdown[key] = entry;
  }
  for (const key of Object.keys(modeBreakdown)) {
    const entries = items.filter((row) => row.mode === key && row.outcome !== "OPEN");
    if (entries.length === 0) {
      modeBreakdown[key].avgPnl = null;
      continue;
    }
    const sum = entries.map((row) => Number(row.netPnl ?? 0)).reduce((a, b) => a + b, 0);
    modeBreakdown[key].avgPnl = Number((sum / entries.length).toFixed(4));
  }

  return {
    total,
    closed,
    winRate,
    lossRate,
    breakevenRate,
    avgPnl,
    avgWin,
    avgLoss,
    profitFactor,
    maxDrawdown: closedItems.length > 0 ? Number(maxDrawdown.toFixed(4)) : null,
    avgPredictionErrorPercent,
    modeBreakdown,
  };
}

function buildSetupFeatureStats(rows: Awaited<ReturnType<typeof listTradeHistory>>) {
  const stats = new Map<
    string,
    { samples: number; wins: number; losses: number; netPnl: number }
  >();
  for (const row of rows) {
    const position = row.position;
    if (!position || position.status !== "CLOSED") continue;
    const pnl = Number(position.realizedPnl ?? 0);
    if (!Number.isFinite(pnl)) continue;
    const meta = (position.metadata as Record<string, unknown> | null) ?? {};
    const snapshot = buildSetupFeatureSnapshot(meta);
    if (snapshot.features.length === 0) continue;
    const win = pnl > 0;
    for (const feature of snapshot.features) {
      const entry = stats.get(feature) ?? { samples: 0, wins: 0, losses: 0, netPnl: 0 };
      entry.samples += 1;
      if (win) entry.wins += 1;
      else entry.losses += 1;
      entry.netPnl += pnl;
      stats.set(feature, entry);
    }
  }

  const list = Array.from(stats.entries()).map(([feature, row]) => {
    const winRate = row.samples > 0 ? row.wins / row.samples : 0;
    const avgPnl = row.samples > 0 ? row.netPnl / row.samples : 0;
    return {
      feature,
      samples: row.samples,
      wins: row.wins,
      losses: row.losses,
      winRate: Number(winRate.toFixed(4)),
      avgPnl: Number(avgPnl.toFixed(4)),
    };
  });
  return list;
}

function topFeatures(
  rows: TradeJournalSetupFeatureStat[],
  direction: "WIN" | "LOSS",
  minSamples: number,
  limit: number,
) {
  const filtered = rows.filter((row) => row.samples >= minSamples);
  const sorted = [...filtered].sort((a, b) => {
    if (direction === "WIN") {
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      return b.avgPnl - a.avgPnl;
    }
    if (a.winRate !== b.winRate) return a.winRate - b.winRate;
    return a.avgPnl - b.avgPnl;
  });
  return sorted.slice(0, limit);
}

export async function buildTradeJournalSetupInsights(input: {
  userId: string;
  limit?: number;
}): Promise<TradeJournalSetupInsights> {
  const limit = Math.max(80, Math.min(900, Number(input.limit ?? 480)));
  const rows = await listTradeHistory({ userId: input.userId, limit });
  const stats = buildSetupFeatureStats(rows);
  const topWinningFeatures = topFeatures(stats, "WIN", 6, 8);
  const topLosingFeatures = topFeatures(stats, "LOSS", 6, 8);
  const optimizationHints: string[] = [];
  if (topWinningFeatures.length > 0) {
    optimizationHints.push(
      `Kazanan patternleri agirlastir: ${topWinningFeatures
        .slice(0, 3)
        .map((row) => row.feature)
        .join(", ")}`,
    );
  }
  if (topLosingFeatures.length > 0) {
    optimizationHints.push(
      `Kaybeden patternleri zayiflat: ${topLosingFeatures
        .slice(0, 3)
        .map((row) => row.feature)
        .join(", ")}`,
    );
  }
  if (stats.length < 8) {
    optimizationHints.push("Setup hafizasi icin daha fazla kapali islem gerekiyor.");
  }
  return {
    generatedAt: new Date().toISOString(),
    samples: rows.length,
    topWinningFeatures,
    topLosingFeatures,
    optimizationHints,
    featureStats: stats,
  };
}
