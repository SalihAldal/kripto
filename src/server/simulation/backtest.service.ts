import { AppSettingScope, ConfigStatus, Prisma } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";
import { scoreContext } from "@/src/server/scanner/signal-scoring.engine";
import type { MarketContext } from "@/src/types/scanner";

type BacktestInput = {
  userId: string;
  startDate: string;
  endDate: string;
  symbols: string[];
  strategy: "balanced" | "aggressive" | "conservative";
  aiEnabled: boolean;
  tpPercents: number[];
  slPercents: number[];
};

type SimTrade = {
  symbol: string;
  openedAt: string;
  closedAt: string;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  tpPercent: number;
  slPercent: number;
  netPnl: number;
  holdSec: number;
  result: "win" | "loss";
  strategy: string;
};

function avg(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((acc, cur) => acc + cur, 0) / values.length;
}

function std(values: number[]) {
  if (values.length < 2) return 0;
  const mean = avg(values);
  const variance = values.reduce((acc, cur) => acc + (cur - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function clamp(min: number, value: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function toNum(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function toDateSafe(raw: string) {
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) {
    throw new Error(`Gecersiz tarih: ${raw}`);
  }
  return dt;
}

function buildSyntheticContext(input: {
  symbol: string;
  closes: number[];
  idx: number;
  volume24h: number;
  bid: number;
  ask: number;
}): MarketContext {
  const price = input.closes[input.idx] ?? input.closes[input.closes.length - 1] ?? 0;
  const prev = input.closes[Math.max(0, input.idx - 6)] ?? price;
  const momentumPercent = prev > 0 ? ((price - prev) / prev) * 100 : 0;
  const localWindow = input.closes.slice(Math.max(0, input.idx - 20), input.idx + 1);
  const volPercent = price > 0 ? (std(localWindow) / price) * 100 : 0;
  const spreadPercent = ask > 0 ? ((ask - bid) / ask) * 100 : 0;
  return {
    symbol: input.symbol,
    lastPrice: price,
    change24h: 0,
    volume24h: input.volume24h,
    spreadPercent,
    volatilityPercent: Number(volPercent.toFixed(4)),
    momentumPercent: Number(momentumPercent.toFixed(4)),
    orderBookImbalance: 0.1,
    buyPressure: momentumPercent >= 0 ? 0.56 : 0.44,
    shortCandleSignal: momentumPercent >= 0 ? 2 : -2,
    fakeSpikeScore: 0.1,
    tradable: true,
    rejectReasons: [],
    metadata: {
      shortMomentumPercent: Number(momentumPercent.toFixed(4)),
      shortFlowImbalance: momentumPercent >= 0 ? 0.12 : -0.12,
      tradeVelocity: 0.9,
    },
  };
}

function computeMetrics(trades: SimTrade[]) {
  const totalPnl = trades.reduce((acc, cur) => acc + cur.netPnl, 0);
  const wins = trades.filter((x) => x.netPnl > 0).length;
  const losses = trades.length - wins;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  const avgHoldSec = avg(trades.map((x) => x.holdSec));

  const byCoin = new Map<string, { pnl: number; count: number }>();
  const equity: number[] = [];
  let cumulative = 0;
  for (const trade of trades) {
    cumulative += trade.netPnl;
    equity.push(cumulative);
    const cur = byCoin.get(trade.symbol) ?? { pnl: 0, count: 0 };
    cur.pnl += trade.netPnl;
    cur.count += 1;
    byCoin.set(trade.symbol, cur);
  }

  let peak = 0;
  let maxDrawdown = 0;
  for (const point of equity) {
    peak = Math.max(peak, point);
    maxDrawdown = Math.max(maxDrawdown, peak - point);
  }

  const coins = Array.from(byCoin.entries()).map(([symbol, stats]) => ({
    symbol,
    pnl: Number(stats.pnl.toFixed(8)),
    count: stats.count,
  }));
  const bestCoins = [...coins].sort((a, b) => b.pnl - a.pnl).slice(0, 5);
  const worstCoins = [...coins].sort((a, b) => a.pnl - b.pnl).slice(0, 5);

  return {
    totalPnl: Number(totalPnl.toFixed(8)),
    winRate: Number(winRate.toFixed(2)),
    maxDrawdown: Number(maxDrawdown.toFixed(8)),
    avgHoldSec: Math.round(avgHoldSec),
    bestCoins,
    worstCoins,
    wins,
    losses,
    tradeCount: trades.length,
  };
}

async function persistBacktestHistory(userId: string, item: Record<string, unknown>) {
  const key = `backtest.history.${userId}`;
  const existing = await prisma.appSetting.findUnique({ where: { key } });
  const current = (existing?.value as Record<string, unknown> | null) ?? {};
  const historyRaw = Array.isArray(current.history) ? current.history : [];
  const history = [item, ...historyRaw].slice(0, 20);
  await prisma.appSetting.upsert({
    where: { key },
    create: {
      key,
      scope: AppSettingScope.USER,
      userId,
      valueType: "json",
      status: ConfigStatus.ACTIVE,
      description: "Backtest run history",
      value: {
        updatedAt: new Date().toISOString(),
        history,
      } as Prisma.InputJsonValue,
    },
    update: {
      status: ConfigStatus.ACTIVE,
      value: {
        updatedAt: new Date().toISOString(),
        history,
      } as Prisma.InputJsonValue,
    },
  });
}

export async function listBacktestHistory(userId: string) {
  const key = `backtest.history.${userId}`;
  const existing = await prisma.appSetting.findUnique({ where: { key } });
  const value = (existing?.value as Record<string, unknown> | null) ?? {};
  return Array.isArray(value.history) ? value.history : [];
}

export async function runBacktest(input: BacktestInput) {
  const start = toDateSafe(input.startDate);
  const end = toDateSafe(input.endDate);
  if (start > end) {
    throw new Error("Baslangic tarihi bitis tarihinden buyuk olamaz.");
  }
  const symbols = Array.from(new Set(input.symbols.map((x) => x.trim().toUpperCase()).filter(Boolean)));
  if (symbols.length === 0) {
    throw new Error("En az bir coin secilmelidir.");
  }
  const tpList = input.tpPercents.filter((x) => Number.isFinite(x) && x > 0);
  const slList = input.slPercents.filter((x) => Number.isFinite(x) && x > 0);
  if (tpList.length === 0 || slList.length === 0) {
    throw new Error("TP/SL listeleri bos olamaz.");
  }

  const snapshots = await prisma.marketSnapshot.findMany({
    where: {
      snapshotAt: { gte: start, lte: end },
      tradingPair: { symbol: { in: symbols } },
    },
    include: {
      tradingPair: true,
    },
    orderBy: { snapshotAt: "asc" },
    take: 20000,
  });

  if (snapshots.length < 20) {
    throw new Error("Backtest icin yeterli historical market snapshot bulunamadi.");
  }

  const grouped = new Map<string, typeof snapshots>();
  for (const row of snapshots) {
    const symbol = row.tradingPair.symbol;
    const list = grouped.get(symbol) ?? [];
    list.push(row);
    grouped.set(symbol, list);
  }

  const strategyRows: Array<{
    key: string;
    tpPercent: number;
    slPercent: number;
    totalPnl: number;
    winRate: number;
    tradeCount: number;
    maxDrawdown: number;
  }> = [];
  let bestTrades: SimTrade[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const tpPercent of tpList) {
    for (const slPercent of slList) {
      const trades: SimTrade[] = [];
      for (const [symbol, rows] of grouped.entries()) {
        if (rows.length < 16) continue;
        const closes = rows.map((x) => toNum(x.lastPrice));
        let open: {
          entryPrice: number;
          openedAt: Date;
          qty: number;
          entryIndex: number;
        } | null = null;
        const holdLimit =
          input.strategy === "aggressive" ? 6 : input.strategy === "conservative" ? 18 : 10;
        const minScore =
          input.strategy === "aggressive" ? 44 : input.strategy === "conservative" ? 60 : 52;

        for (let idx = 14; idx < rows.length; idx += 1) {
          const row = rows[idx];
          const bid = toNum(row.bidPrice || row.lastPrice);
          const ask = toNum(row.askPrice || row.lastPrice);
          const context = buildSyntheticContext({
            symbol,
            closes,
            idx,
            volume24h: toNum(row.volumeQuote),
            bid,
            ask,
          });
          const scannerScore = scoreContext(context);
          const aiConfidenceProxy = clamp(
            0,
            scannerScore.confidence - context.volatilityPercent * 1.5 - context.spreadPercent * 20,
            100,
          );
          const aiRiskProxy = clamp(0, context.volatilityPercent * 12 + context.spreadPercent * 100, 100);
          const aiPass = !input.aiEnabled || (aiConfidenceProxy >= 55 && aiRiskProxy <= 65);

          if (!open) {
            if (scannerScore.status === "QUALIFIED" && scannerScore.score >= minScore && aiPass) {
              open = {
                entryPrice: context.lastPrice,
                openedAt: row.snapshotAt,
                qty: 1,
                entryIndex: idx,
              };
            }
            continue;
          }

          const currentPrice = context.lastPrice;
          const pnlPercent = open.entryPrice > 0 ? ((currentPrice - open.entryPrice) / open.entryPrice) * 100 : 0;
          const holdBars = idx - open.entryIndex;
          const shouldClose = pnlPercent >= tpPercent || pnlPercent <= -slPercent || holdBars >= holdLimit;
          if (!shouldClose) continue;

          const fee = (open.entryPrice * open.qty + currentPrice * open.qty) * 0.001;
          const netPnl = (currentPrice - open.entryPrice) * open.qty - fee;
          const holdSec = Math.max(1, Math.floor((row.snapshotAt.getTime() - open.openedAt.getTime()) / 1000));
          trades.push({
            symbol,
            openedAt: open.openedAt.toISOString(),
            closedAt: row.snapshotAt.toISOString(),
            entryPrice: Number(open.entryPrice.toFixed(8)),
            exitPrice: Number(currentPrice.toFixed(8)),
            qty: open.qty,
            tpPercent,
            slPercent,
            netPnl: Number(netPnl.toFixed(8)),
            holdSec,
            result: netPnl >= 0 ? "win" : "loss",
            strategy: input.strategy,
          });
          open = null;
        }
      }

      const metrics = computeMetrics(trades);
      const key = `${input.strategy}|tp=${tpPercent}|sl=${slPercent}`;
      strategyRows.push({
        key,
        tpPercent,
        slPercent,
        totalPnl: metrics.totalPnl,
        winRate: metrics.winRate,
        tradeCount: metrics.tradeCount,
        maxDrawdown: metrics.maxDrawdown,
      });
      const score = metrics.totalPnl - metrics.maxDrawdown * 0.4 + metrics.winRate * 0.15;
      if (score > bestScore) {
        bestScore = score;
        bestTrades = trades;
      }
    }
  }

  const finalMetrics = computeMetrics(bestTrades);
  const strategyComparison = [...strategyRows].sort((a, b) => b.totalPnl - a.totalPnl);
  const result = {
    id: `bt-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    range: {
      start: start.toISOString(),
      end: end.toISOString(),
    },
    symbols,
    strategy: input.strategy,
    aiEnabled: input.aiEnabled,
    metrics: {
      totalPnl: finalMetrics.totalPnl,
      winRate: finalMetrics.winRate,
      maxDrawdown: finalMetrics.maxDrawdown,
      avgHoldSec: finalMetrics.avgHoldSec,
      tradeCount: finalMetrics.tradeCount,
      wins: finalMetrics.wins,
      losses: finalMetrics.losses,
      bestCoins: finalMetrics.bestCoins,
      worstCoins: finalMetrics.worstCoins,
    },
    strategyComparison,
    trades: bestTrades.slice(0, 300),
    sampleScenarios: [
      {
        label: "Muhafazakar AI",
        strategy: "conservative",
        aiEnabled: true,
        tpPercents: [1.2, 1.8],
        slPercents: [0.7, 1.0],
      },
      {
        label: "Agresif AI Kapali",
        strategy: "aggressive",
        aiEnabled: false,
        tpPercents: [2.2, 3.0],
        slPercents: [1.2, 1.8],
      },
    ],
  };

  await persistBacktestHistory(input.userId, {
    id: result.id,
    generatedAt: result.generatedAt,
    range: result.range,
    symbols: result.symbols,
    strategy: result.strategy,
    aiEnabled: result.aiEnabled,
    metrics: result.metrics,
    strategyComparison: result.strategyComparison.slice(0, 8),
  });

  return result;
}
