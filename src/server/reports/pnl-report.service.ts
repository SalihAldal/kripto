import { prisma } from "@/src/server/db/prisma";

export type PnlReportPeriod = "daily" | "weekly" | "monthly" | "custom";
export type PnlTradeMode = "manual" | "auto" | "all";

type DateRange = {
  start: Date;
  end: Date;
};

type ReportFilters = {
  period: PnlReportPeriod;
  startDate?: string;
  endDate?: string;
  coin?: string;
  aiModel?: string;
  mode?: PnlTradeMode;
};

type ReportRow = {
  id: string;
  coin: string;
  buyTime: string | null;
  buyPrice: number;
  buyQty: number;
  sellTime: string | null;
  sellPrice: number;
  sellQty: number;
  fee: number;
  netPnl: number;
  durationSec: number;
  aiModel: string;
  tradeType: "manual" | "auto";
  result: "profit" | "loss" | "open";
  warnings: string[];
};

function toNumber(value: unknown) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function resolveDateRange(filters: ReportFilters): DateRange {
  const now = new Date();
  if (filters.period === "custom") {
    const startRaw = filters.startDate ? new Date(filters.startDate) : startOfDay(now);
    const endRaw = filters.endDate ? new Date(filters.endDate) : now;
    const start = Number.isNaN(startRaw.getTime()) ? startOfDay(now) : startRaw;
    const end = Number.isNaN(endRaw.getTime()) ? now : endRaw;
    return start <= end ? { start, end } : { start: end, end: start };
  }
  if (filters.period === "daily") {
    return { start: startOfDay(now), end: now };
  }
  if (filters.period === "weekly") {
    const start = new Date(now);
    start.setDate(now.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return { start, end: now };
  }
  const start = new Date(now);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return { start, end: now };
}

function deriveTradeType(source: string | undefined) {
  const lower = String(source ?? "").toLowerCase();
  if (lower.includes("analyze-and-trade") || lower.includes("fast-entry") || lower.includes("auto")) {
    return "auto" as const;
  }
  return "manual" as const;
}

function sumExecutedQty(order: {
  quantity: number;
  executions?: Array<{ executedQty: number }>;
}) {
  const executionSum = (order.executions ?? []).reduce((acc, row) => acc + toNumber(row.executedQty), 0);
  if (executionSum > 0) return executionSum;
  return toNumber(order.quantity);
}

function buildCsv(rows: ReportRow[]) {
  const headers = [
    "coin",
    "buy_time",
    "buy_price",
    "buy_qty",
    "sell_time",
    "sell_price",
    "sell_qty",
    "fee",
    "net_pnl",
    "duration_sec",
    "ai_model",
    "trade_type",
    "result",
    "warnings",
  ];
  const body = rows.map((row) =>
    [
      row.coin,
      row.buyTime ?? "",
      row.buyPrice.toFixed(8),
      row.buyQty.toFixed(8),
      row.sellTime ?? "",
      row.sellPrice.toFixed(8),
      row.sellQty.toFixed(8),
      row.fee.toFixed(8),
      row.netPnl.toFixed(8),
      row.durationSec,
      row.aiModel,
      row.tradeType,
      row.result,
      row.warnings.join("|"),
    ]
      .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
      .join(","),
  );
  return [headers.join(","), ...body].join("\n");
}

function maxDrawdownFromSeries(points: Array<{ date: string; cumulative: number }>) {
  let peak = 0;
  let maxDrawdown = 0;
  for (const point of points) {
    peak = Math.max(peak, point.cumulative);
    const drawdown = peak - point.cumulative;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }
  return Number(maxDrawdown.toFixed(8));
}

function resolveStreaks(rows: ReportRow[]) {
  const closed = rows
    .filter((row) => row.result !== "open")
    .sort((a, b) => (a.sellTime ?? "").localeCompare(b.sellTime ?? ""));
  let bestWin = 0;
  let bestLoss = 0;
  let currentWin = 0;
  let currentLoss = 0;
  for (const row of closed) {
    if (row.netPnl >= 0) {
      currentWin += 1;
      currentLoss = 0;
    } else {
      currentLoss += 1;
      currentWin = 0;
    }
    bestWin = Math.max(bestWin, currentWin);
    bestLoss = Math.max(bestLoss, currentLoss);
  }
  return { bestWin, bestLoss };
}

export async function buildPnlReport(filters: ReportFilters) {
  const range = resolveDateRange(filters);
  const coinFilter = filters.coin?.trim().toUpperCase();

  const positions = await prisma.position.findMany({
    where: {
      tradingPair: coinFilter ? { symbol: coinFilter } : undefined,
      OR: [
        { openedAt: { gte: range.start, lte: range.end } },
        { closedAt: { gte: range.start, lte: range.end } },
        { status: "OPEN", openedAt: { lte: range.end } },
      ],
    },
    include: {
      tradingPair: true,
      tradeOrders: {
        include: {
          executions: true,
          tradeSignal: {
            include: {
              aiModelConfig: true,
              aiProvider: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { openedAt: "desc" },
    take: 1000,
  });

  const rows: ReportRow[] = [];
  for (const position of positions) {
    const warnings: string[] = [];
    const openingOrder = position.tradeOrders.find((order) => order.side === "BUY") ?? position.tradeOrders[0];
    const closingOrder = [...position.tradeOrders].reverse().find((order) => order.side === "SELL");
    const openQty = openingOrder ? sumExecutedQty(openingOrder) : toNumber(position.quantity);
    const closeQty = closingOrder ? sumExecutedQty(closingOrder) : 0;
    const buyPrice = toNumber(openingOrder?.avgExecutionPrice ?? openingOrder?.price ?? position.entryPrice);
    const sellPrice = toNumber(closingOrder?.avgExecutionPrice ?? closingOrder?.price ?? position.closePrice ?? 0);
    const fee =
      position.tradeOrders.reduce((acc, order) => acc + toNumber(order.fee), 0) +
      position.tradeOrders.flatMap((order) => order.executions ?? []).reduce((acc, ex) => acc + toNumber(ex.fee), 0);
    const realized = toNumber(position.realizedPnl);
    const unrealized = toNumber(position.unrealizedPnl);
    const netPnl = position.status === "OPEN" ? unrealized : realized;
    const aiModel =
      openingOrder?.tradeSignal?.aiModelConfig?.displayName ??
      openingOrder?.tradeSignal?.aiProvider?.name ??
      "UNKNOWN";
    const metadataSource = String((openingOrder?.metadata as { source?: string } | null)?.source ?? "");
    const tradeType = deriveTradeType(metadataSource);
    if (filters.mode && filters.mode !== "all" && tradeType !== filters.mode) {
      continue;
    }
    if (filters.aiModel && filters.aiModel !== "all" && aiModel.toLowerCase() !== filters.aiModel.toLowerCase()) {
      continue;
    }
    if (buyPrice <= 0) warnings.push("invalid_buy_price");
    if (position.status === "CLOSED" && sellPrice <= 0) warnings.push("invalid_sell_price");
    if (openQty <= 0) warnings.push("invalid_buy_qty");
    if (position.status === "CLOSED" && closeQty <= 0) warnings.push("invalid_sell_qty");
    if (warnings.length > 0 && position.status === "CLOSED" && netPnl === 0) warnings.push("pnl_suspect");

    rows.push({
      id: position.id,
      coin: position.tradingPair.symbol,
      buyTime: openingOrder?.executedAt?.toISOString() ?? openingOrder?.createdAt?.toISOString() ?? position.openedAt.toISOString(),
      buyPrice,
      buyQty: openQty,
      sellTime:
        position.status === "CLOSED"
          ? closingOrder?.executedAt?.toISOString() ?? closingOrder?.createdAt?.toISOString() ?? position.closedAt?.toISOString() ?? null
          : null,
      sellPrice,
      sellQty: closeQty,
      fee: Number(fee.toFixed(8)),
      netPnl: Number(netPnl.toFixed(8)),
      durationSec: Math.max(
        0,
        Math.round(
          ((position.closedAt?.getTime() ?? Date.now()) - position.openedAt.getTime()) / 1000,
        ),
      ),
      aiModel,
      tradeType,
      result: position.status === "OPEN" ? "open" : netPnl >= 0 ? "profit" : "loss",
      warnings,
    });
  }

  const closedRows = rows.filter((row) => row.result !== "open");
  const openRows = rows.filter((row) => row.result === "open");
  const totalProfit = closedRows.filter((row) => row.netPnl > 0).reduce((acc, row) => acc + row.netPnl, 0);
  const totalLoss = closedRows.filter((row) => row.netPnl < 0).reduce((acc, row) => acc + row.netPnl, 0);
  const realizedPnl = closedRows.reduce((acc, row) => acc + row.netPnl, 0);
  const unrealizedPnl = openRows.reduce((acc, row) => acc + row.netPnl, 0);
  const netPnl = realizedPnl + unrealizedPnl;
  const totalFee = rows.reduce((acc, row) => acc + row.fee, 0);
  const winCount = closedRows.filter((row) => row.netPnl >= 0).length;
  const failCount = closedRows.filter((row) => row.netPnl < 0).length;
  const tradeCount = rows.length;
  const winRate = closedRows.length > 0 ? (winCount / closedRows.length) * 100 : 0;
  const avgProfit = winCount > 0 ? totalProfit / winCount : 0;
  const avgLoss = failCount > 0 ? totalLoss / failCount : 0;

  const byCoin = new Map<string, { pnl: number; count: number }>();
  const byAi = new Map<string, { pnl: number; wins: number; count: number }>();
  const byTradeType = new Map<string, { pnl: number; wins: number; count: number }>();
  const byHour = new Map<string, { wins: number; count: number }>();
  const byDay = new Map<string, { wins: number; count: number }>();
  const byDate = new Map<string, { pnl: number; count: number }>();
  for (const row of rows) {
    const coinStats = byCoin.get(row.coin) ?? { pnl: 0, count: 0 };
    coinStats.pnl += row.netPnl;
    coinStats.count += 1;
    byCoin.set(row.coin, coinStats);

    const aiStats = byAi.get(row.aiModel) ?? { pnl: 0, wins: 0, count: 0 };
    aiStats.pnl += row.netPnl;
    aiStats.count += 1;
    aiStats.wins += row.result === "profit" ? 1 : 0;
    byAi.set(row.aiModel, aiStats);

    const strategyKey = row.tradeType;
    const strategyStats = byTradeType.get(strategyKey) ?? { pnl: 0, wins: 0, count: 0 };
    strategyStats.pnl += row.netPnl;
    strategyStats.count += 1;
    strategyStats.wins += row.result === "profit" ? 1 : 0;
    byTradeType.set(strategyKey, strategyStats);

    const timeSource = row.sellTime ?? row.buyTime;
    if (!timeSource) continue;
    const dt = new Date(timeSource);
    if (Number.isNaN(dt.getTime())) continue;
    const hourKey = String(dt.getHours()).padStart(2, "0");
    const hourStats = byHour.get(hourKey) ?? { wins: 0, count: 0 };
    hourStats.count += 1;
    hourStats.wins += row.result === "profit" ? 1 : 0;
    byHour.set(hourKey, hourStats);

    const dayKey = dt.toLocaleDateString("en-US", { weekday: "short" });
    const dayStats = byDay.get(dayKey) ?? { wins: 0, count: 0 };
    dayStats.count += 1;
    dayStats.wins += row.result === "profit" ? 1 : 0;
    byDay.set(dayKey, dayStats);

    const dateKey = dt.toISOString().slice(0, 10);
    const dateStats = byDate.get(dateKey) ?? { pnl: 0, count: 0 };
    dateStats.pnl += row.netPnl;
    dateStats.count += 1;
    byDate.set(dateKey, dateStats);
  }

  const coinEntries = Array.from(byCoin.entries()).map(([coin, stats]) => ({ coin, ...stats }));
  const bestCoin = [...coinEntries].sort((a, b) => b.pnl - a.pnl)[0] ?? null;
  const worstCoin = [...coinEntries].sort((a, b) => a.pnl - b.pnl)[0] ?? null;

  const timeline = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, netPnl: Number(value.pnl.toFixed(8)), tradeCount: value.count }));
  let cumulative = 0;
  const netPnlTimeline = timeline.map((row) => {
    cumulative += row.netPnl;
    return { ...row, cumulative: Number(cumulative.toFixed(8)) };
  });
  const drawdown = maxDrawdownFromSeries(netPnlTimeline);
  const streaks = resolveStreaks(rows);

  const aiPerformance = Array.from(byAi.entries())
    .map(([aiModel, stats]) => ({
      aiModel,
      tradeCount: stats.count,
      netPnl: Number(stats.pnl.toFixed(8)),
      winRate: stats.count > 0 ? Number(((stats.wins / stats.count) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.netPnl - a.netPnl);

  const strategyPerformance = Array.from(byTradeType.entries()).map(([strategy, stats]) => ({
    strategy,
    tradeCount: stats.count,
    netPnl: Number(stats.pnl.toFixed(8)),
    winRate: stats.count > 0 ? Number(((stats.wins / stats.count) * 100).toFixed(2)) : 0,
  }));

  const filterOptions = {
    coins: Array.from(new Set(rows.map((row) => row.coin))).sort(),
    aiModels: Array.from(new Set(rows.map((row) => row.aiModel))).sort(),
    modes: ["all", "manual", "auto"] as const,
  };

  return {
    filters: {
      ...filters,
      period: filters.period,
      mode: filters.mode ?? "all",
      coin: filters.coin ?? "all",
      aiModel: filters.aiModel ?? "all",
      rangeStart: range.start.toISOString(),
      rangeEnd: range.end.toISOString(),
    },
    summary: {
      totalProfit: Number(totalProfit.toFixed(8)),
      totalLoss: Number(totalLoss.toFixed(8)),
      netPnl: Number(netPnl.toFixed(8)),
      realizedPnl: Number(realizedPnl.toFixed(8)),
      unrealizedPnl: Number(unrealizedPnl.toFixed(8)),
      tradeCount,
      successCount: winCount,
      failedCount: failCount,
      openCount: openRows.length,
      winRate: Number(winRate.toFixed(2)),
      avgProfit: Number(avgProfit.toFixed(8)),
      avgLoss: Number(avgLoss.toFixed(8)),
      bestCoin: bestCoin?.coin ?? null,
      worstCoin: worstCoin?.coin ?? null,
      totalFee: Number(totalFee.toFixed(8)),
    },
    analysis: {
      mostTradedCoins: [...coinEntries].sort((a, b) => b.count - a.count).slice(0, 10),
      bestPerformingCoins: [...coinEntries].sort((a, b) => b.pnl - a.pnl).slice(0, 10),
      worstPerformingCoins: [...coinEntries].sort((a, b) => a.pnl - b.pnl).slice(0, 10),
      hourlySuccessRate: Array.from(byHour.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([hour, stats]) => ({
          hour,
          tradeCount: stats.count,
          winRate: stats.count > 0 ? Number(((stats.wins / stats.count) * 100).toFixed(2)) : 0,
        })),
      dailySuccessRate: Array.from(byDay.entries()).map(([day, stats]) => ({
        day,
        tradeCount: stats.count,
        winRate: stats.count > 0 ? Number(((stats.wins / stats.count) * 100).toFixed(2)) : 0,
      })),
      aiPerformance,
      strategyPerformance,
      maxDrawdown: drawdown,
      streaks: {
        maxWinStreak: streaks.bestWin,
        maxLossStreak: streaks.bestLoss,
      },
    },
    charts: {
      netPnlTimeline,
      coinPnlDistribution: [...coinEntries].map((row) => ({ label: row.coin, value: Number(row.pnl.toFixed(8)) })),
      aiPerformanceComparison: aiPerformance.map((row) => ({ label: row.aiModel, value: row.netPnl })),
      tradeCountTimeline: timeline.map((row) => ({ date: row.date, count: row.tradeCount })),
      pnlDistribution: {
        profitTrades: closedRows.filter((row) => row.netPnl > 0).length,
        lossTrades: closedRows.filter((row) => row.netPnl < 0).length,
        openTrades: openRows.length,
      },
    },
    rows,
    filterOptions,
    exports: {
      csv: buildCsv(rows),
    },
  };
}
