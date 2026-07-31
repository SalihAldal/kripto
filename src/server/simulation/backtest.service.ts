import { AppSettingScope, ConfigStatus, Prisma } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";
import { scoreContext } from "@/src/server/scanner/signal-scoring.engine";
import type { MarketContext } from "@/src/types/scanner";
import { calculateTakerFee } from "@/src/server/execution/fee-profile";
import { isSuccessfulNetExit } from "@/src/server/execution/profit-thresholds";

type BacktestInput = {
  userId: string;
  startDate: string;
  endDate: string;
  symbols: string[];
  strategy: "balanced" | "aggressive" | "conservative";
  aiEnabled: boolean;
  tpPercents: number[];
  slPercents: number[];
  scanUniverseSize: number;
  forceSimulatedFills: boolean;
  intervalMinutes?: number;
  trailingStartPercent?: number;
  trailingGapPercent?: number;
};

type SimTrade = {
  symbol: string;
  openedAt: string;
  closedAt: string;
  entryPrice: number;
  exitPrice: number;
  pnlPercent: number;
  qty: number;
  tpPercent: number;
  slPercent: number;
  netPnl: number;
  holdSec: number;
  result: "win" | "loss";
  strategy: string;
  exitReason: "target" | "sl" | "timeout" | "synthetic" | "trailing_stop";
  simulatedFill: boolean;
};

type SimSnapshotRow = {
  snapshotAt: Date;
  bidPrice: number;
  askPrice: number;
  lastPrice: number;
  volumeQuote: number;
  tradingPair: {
    symbol: string;
  };
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

function hashSeed(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0) || 1;
}

function makeSyntheticSnapshots(input: { symbol: string; start: Date; end: Date; minBars?: number }): SimSnapshotRow[] {
  const minBars = Math.max(32, input.minBars ?? 220);
  const totalMs = Math.max(1, input.end.getTime() - input.start.getTime());
  const stepMs = Math.max(60_000, Math.floor(totalMs / minBars));
  const bars = Math.max(minBars, Math.floor(totalMs / stepMs) + 1);

  let seed = hashSeed(input.symbol);
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  let price = 0.25 + (hashSeed(input.symbol + ".p") % 9000) / 25;
  const rows: SimSnapshotRow[] = [];
  for (let idx = 0; idx < bars; idx += 1) {
    const wave = Math.sin(idx / 9 + (seed % 17) * 0.13) * 0.004;
    const noise = (rnd() - 0.5) * 0.01;
    const drift = (rnd() - 0.48) * 0.0015;
    price = Math.max(0.000001, price * (1 + wave + noise + drift));
    const spreadPct = Math.max(0.0002, 0.0004 + rnd() * 0.0012);
    const ask = price * (1 + spreadPct / 2);
    const bid = price * (1 - spreadPct / 2);
    const vol = 350_000 + rnd() * 6_500_000;
    rows.push({
      snapshotAt: new Date(input.start.getTime() + idx * stepMs),
      bidPrice: Number(bid.toFixed(8)),
      askPrice: Number(ask.toFixed(8)),
      lastPrice: Number(price.toFixed(8)),
      volumeQuote: Number(vol.toFixed(2)),
      tradingPair: { symbol: input.symbol },
    });
  }
  return rows;
}

function downsampleSnapshots(rows: SimSnapshotRow[], intervalMinutes?: number) {
  const interval = Math.max(1, Math.floor(Number(intervalMinutes ?? 1)));
  if (interval <= 1 || rows.length <= 1) return rows;
  const stepMs = interval * 60_000;
  const filtered: SimSnapshotRow[] = [];
  let nextTs = rows[0].snapshotAt.getTime();
  for (const row of rows) {
    const ts = row.snapshotAt.getTime();
    if (ts >= nextTs) {
      filtered.push(row);
      nextTs = ts + stepMs;
    }
  }
  return filtered.length >= 6 ? filtered : rows;
}

async function resolveBacktestSymbols(input: { start: Date; end: Date; symbols: string[]; targetSize: number }) {
  const requested = Array.from(new Set(input.symbols.map((x) => x.trim().toUpperCase()).filter(Boolean)));
  const targetSize = clamp(requested.length || 1, input.targetSize, 300);
  if (requested.length >= targetSize) {
    return requested.slice(0, targetSize);
  }

  const marketRows = await prisma.marketSnapshot.findMany({
    where: {
      snapshotAt: { gte: input.start, lte: input.end },
    },
    include: {
      tradingPair: true,
    },
    orderBy: [{ volumeQuote: "desc" }, { snapshotAt: "desc" }],
    take: 15_000,
  });

  const picked = new Set(requested);
  for (const row of marketRows) {
    const symbol = row.tradingPair.symbol.toUpperCase();
    if (picked.has(symbol)) continue;
    picked.add(symbol);
    if (picked.size >= targetSize) break;
  }

  return Array.from(picked);
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
  const spreadPercent = input.ask > 0 ? ((input.ask - input.bid) / input.ask) * 100 : 0;
  return {
    symbol: input.symbol,
    lastPrice: price,
    change24h: 0,
    volume24h: input.volume24h,
    volumeSpikePercent: 0,
    spreadPercent,
    volatilityPercent: Number(volPercent.toFixed(4)),
    momentumPercent: Number(momentumPercent.toFixed(4)),
    orderBookImbalance: 0.1,
    buyPressure: momentumPercent >= 0 ? 0.56 : 0.44,
    shortCandleSignal: momentumPercent >= 0 ? 2 : -2,
    fakeSpikeScore: 0.1,
    pumpIntensity: 0,
    pumpRisk: 0,
    tradable: true,
    rejectReasons: [],
    metadata: {
      shortMomentumPercent: Number(momentumPercent.toFixed(4)),
      shortFlowImbalance: momentumPercent >= 0 ? 0.12 : -0.12,
      tradeVelocity: 0.9,
    },
  };
}

function buildForcedSimTrade(input: {
  rows: Array<{ snapshotAt: Date; lastPrice: number }>;
  symbol: string;
  tpPercent: number;
  slPercent: number;
  strategy: "balanced" | "aggressive" | "conservative";
}) {
  if (input.rows.length < 16) return null;
  const holdLimit = input.strategy === "aggressive" ? 6 : input.strategy === "conservative" ? 18 : 10;
  const entryIndex = Math.max(8, Math.min(input.rows.length - 2, Math.floor(input.rows.length * 0.3)));
  const maxExitIndex = Math.min(input.rows.length - 1, entryIndex + holdLimit * 2);
  const entryRow = input.rows[entryIndex];
  const entryPrice = toNum(entryRow.lastPrice);
  if (entryPrice <= 0) return null;

  let exitRow = input.rows[maxExitIndex];
  let exitReason: SimTrade["exitReason"] = "synthetic";
  for (let idx = entryIndex + 1; idx <= maxExitIndex; idx += 1) {
    const candidate = input.rows[idx];
    const price = toNum(candidate.lastPrice);
    if (price <= 0) continue;
    const pnlPercent = ((price - entryPrice) / entryPrice) * 100;
    if (pnlPercent >= input.tpPercent) {
      exitRow = candidate;
      exitReason = "target";
      break;
    }
    if (pnlPercent <= -input.slPercent) {
      exitRow = candidate;
      exitReason = "sl";
      break;
    }
  }

  const exitPrice = toNum(exitRow.lastPrice);
  if (exitPrice <= 0) return null;
  const qty = 1;
  const grossPnl = (exitPrice - entryPrice) * qty;
  const fee = calculateTakerFee(entryPrice * qty) + calculateTakerFee(exitPrice * qty);
  const netPnl = grossPnl - fee;
  const roePercent = entryPrice > 0 ? (netPnl / (entryPrice * qty)) * 100 : 0;
  const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
  const holdSec = Math.max(1, Math.floor((exitRow.snapshotAt.getTime() - entryRow.snapshotAt.getTime()) / 1000));

  return {
    symbol: input.symbol,
    openedAt: entryRow.snapshotAt.toISOString(),
    closedAt: exitRow.snapshotAt.toISOString(),
    entryPrice: Number(entryPrice.toFixed(8)),
    exitPrice: Number(exitPrice.toFixed(8)),
    pnlPercent: Number(pnlPercent.toFixed(4)),
    qty,
    tpPercent: input.tpPercent,
    slPercent: input.slPercent,
    netPnl: Number(netPnl.toFixed(8)),
    holdSec,
    result: isSuccessfulNetExit(roePercent) ? ("win" as const) : ("loss" as const),
    strategy: input.strategy,
    exitReason,
    simulatedFill: true,
  } satisfies SimTrade;
}

function computeMetrics(trades: SimTrade[]) {
  const totalPnl = trades.reduce((acc, cur) => acc + cur.netPnl, 0);
  const totalEntryNotional = trades.reduce((acc, cur) => acc + cur.entryPrice * cur.qty, 0);
  const totalPnlPercent = totalEntryNotional > 0 ? (totalPnl / totalEntryNotional) * 100 : 0;
  const wins = trades.filter((x) => x.result === "win").length;
  const losses = trades.length - wins;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  const avgHoldSec = avg(trades.map((x) => x.holdSec));
  const bestTrade = trades.reduce<SimTrade | null>((best, cur) => {
    if (!best || cur.netPnl > best.netPnl) return cur;
    return best;
  }, null);
  const worstTrade = trades.reduce<SimTrade | null>((worst, cur) => {
    if (!worst || cur.netPnl < worst.netPnl) return cur;
    return worst;
  }, null);

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
    totalPnlPercent: Number(totalPnlPercent.toFixed(4)),
    winRate: Number(winRate.toFixed(2)),
    maxDrawdown: Number(maxDrawdown.toFixed(8)),
    avgHoldSec: Math.round(avgHoldSec),
    bestTrade,
    worstTrade,
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
  const requestedSymbols = Array.from(new Set(input.symbols.map((x) => x.trim().toUpperCase()).filter(Boolean)));
  if (requestedSymbols.length === 0) {
    throw new Error("En az bir coin secilmelidir.");
  }
  const symbols = await resolveBacktestSymbols({
    start,
    end,
    symbols: requestedSymbols,
    targetSize: input.scanUniverseSize,
  });
  const tpList = input.tpPercents.filter((x) => Number.isFinite(x) && x > 0);
  const slList = input.slPercents.filter((x) => Number.isFinite(x) && x > 0);
  if (tpList.length === 0 || slList.length === 0) {
    throw new Error("TP/SL listeleri bos olamaz.");
  }

  const dbSnapshots = await prisma.marketSnapshot.findMany({
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

  const grouped = new Map<string, SimSnapshotRow[]>();
  for (const row of dbSnapshots) {
    const symbol = row.tradingPair.symbol.toUpperCase();
    const list = grouped.get(symbol) ?? [];
    list.push({
      snapshotAt: row.snapshotAt,
      bidPrice: toNum(row.bidPrice),
      askPrice: toNum(row.askPrice),
      lastPrice: toNum(row.lastPrice),
      volumeQuote: toNum(row.volumeQuote),
      tradingPair: { symbol },
    });
    grouped.set(symbol, list);
  }
  for (const symbol of symbols) {
    const rows = grouped.get(symbol) ?? [];
    if (rows.length >= 16) continue;
    grouped.set(
      symbol,
      makeSyntheticSnapshots({
        symbol,
        start,
        end,
        minBars: 240,
      }),
    );
  }
  for (const symbol of symbols) {
    const rows = grouped.get(symbol) ?? [];
    grouped.set(symbol, downsampleSnapshots(rows, input.intervalMinutes));
  }

  const strategyRows: Array<{
    key: string;
    tpPercent: number;
    slPercent: number;
    totalPnl: number;
    totalPnlPercent: number;
    winRate: number;
    tradeCount: number;
    maxDrawdown: number;
  }> = [];
  let bestTrades: SimTrade[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const tpPercent of tpList) {
    for (const slPercent of slList) {
      const trades: SimTrade[] = [];
      for (const symbol of symbols) {
        const rows = grouped.get(symbol) ?? [];
        if (rows.length < 16) continue;
        const closes = rows.map((x) => toNum(x.lastPrice));
        let open: {
          entryPrice: number;
          openedAt: Date;
          qty: number;
          entryIndex: number;
          highestPrice: number;
          trailingActive: boolean;
          trailingStopPrice: number | null;
        } | null = null;
        const holdLimit =
          input.strategy === "aggressive" ? 6 : input.strategy === "conservative" ? 18 : 10;
        const minScore =
          input.strategy === "aggressive" ? 55 : input.strategy === "conservative" ? 65 : 60;
        const minAiConfidence =
          input.strategy === "aggressive" ? 55 : input.strategy === "conservative" ? 65 : 60;

        let symbolTradeCount = 0;
        const defaultTrailingStart = Number.isFinite(input.trailingStartPercent ?? NaN)
          ? Math.max(0, Number(input.trailingStartPercent))
          : Math.max(0.4, tpPercent * 0.75);
        const defaultTrailingGap = Number.isFinite(input.trailingGapPercent ?? NaN)
          ? Math.max(0, Number(input.trailingGapPercent))
          : Math.max(0.2, Math.min(slPercent, tpPercent * 0.45));
        const trailingStart = Math.max(0.2, Math.min(defaultTrailingStart, Math.max(tpPercent - 0.1, 0.2)));
        const trailingGap = Math.max(0.1, Math.min(defaultTrailingGap, Math.max(trailingStart - 0.1, 0.2)));

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
          const aiPass = !input.aiEnabled || (aiConfidenceProxy >= minAiConfidence && aiRiskProxy <= 65);

          if (!open) {
            if (scannerScore.status === "QUALIFIED" && scannerScore.score >= minScore && aiPass) {
              open = {
                entryPrice: context.lastPrice,
                openedAt: row.snapshotAt,
                qty: 1,
                entryIndex: idx,
                highestPrice: context.lastPrice,
                trailingActive: false,
                trailingStopPrice: null,
              };
            }
            continue;
          }

          const currentPrice = context.lastPrice;
          const pnlPercent = open.entryPrice > 0 ? ((currentPrice - open.entryPrice) / open.entryPrice) * 100 : 0;
          const holdBars = idx - open.entryIndex;
          const targetPrice = open.entryPrice * (1 + tpPercent / 100);
          const stopPrice = open.entryPrice * (1 - slPercent / 100);
          open.highestPrice = Math.max(open.highestPrice, currentPrice);
          let activeStopPrice = stopPrice;
          if (pnlPercent >= trailingStart) {
            open.trailingActive = true;
            const dynamicStop = currentPrice * (1 - trailingGap / 100);
            open.trailingStopPrice = Math.max(open.trailingStopPrice ?? 0, dynamicStop);
            activeStopPrice = Math.max(activeStopPrice, open.trailingStopPrice);
          }
          const hitTarget = currentPrice >= targetPrice;
          const hitStop = currentPrice <= activeStopPrice;
          const timedOut = holdBars >= holdLimit;
          const shouldClose = hitTarget || hitStop || timedOut;
          if (!shouldClose) continue;

          const fee = calculateTakerFee(open.entryPrice * open.qty) + calculateTakerFee(currentPrice * open.qty);
          const netPnl = (currentPrice - open.entryPrice) * open.qty - fee;
          const roePercent = open.entryPrice > 0 ? (netPnl / (open.entryPrice * open.qty)) * 100 : 0;
          const holdSec = Math.max(1, Math.floor((row.snapshotAt.getTime() - open.openedAt.getTime()) / 1000));
          trades.push({
            symbol,
            openedAt: open.openedAt.toISOString(),
            closedAt: row.snapshotAt.toISOString(),
            entryPrice: Number(open.entryPrice.toFixed(8)),
            exitPrice: Number(currentPrice.toFixed(8)),
            pnlPercent: Number(pnlPercent.toFixed(4)),
            qty: open.qty,
            tpPercent,
            slPercent,
            netPnl: Number(netPnl.toFixed(8)),
            holdSec,
            result: isSuccessfulNetExit(roePercent) ? "win" : "loss",
            strategy: input.strategy,
            exitReason: hitTarget ? "target" : hitStop ? (open.trailingActive ? "trailing_stop" : "sl") : "timeout",
            simulatedFill: false,
          });
          symbolTradeCount += 1;
          open = null;
        }

        if (input.forceSimulatedFills && symbolTradeCount === 0) {
          const synthetic = buildForcedSimTrade({
            rows,
            symbol,
            tpPercent,
            slPercent,
            strategy: input.strategy,
          });
          if (synthetic) trades.push(synthetic);
        }
      }

      const metrics = computeMetrics(trades);
      const key = `${input.strategy}|tp=${tpPercent}|sl=${slPercent}`;
      strategyRows.push({
        key,
        tpPercent,
        slPercent,
        totalPnl: metrics.totalPnl,
        totalPnlPercent: metrics.totalPnlPercent,
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
    intervalMinutes: Math.max(1, Math.floor(Number(input.intervalMinutes ?? 1))),
    symbols,
    strategy: input.strategy,
    aiEnabled: input.aiEnabled,
    scanUniverseSize: input.scanUniverseSize,
    scannedSymbols: symbols,
    simulatedFillCount: bestTrades.filter((x) => x.simulatedFill).length,
    metrics: {
      totalPnl: finalMetrics.totalPnl,
      totalPnlPercent: finalMetrics.totalPnlPercent,
      winRate: finalMetrics.winRate,
      maxDrawdown: finalMetrics.maxDrawdown,
      avgHoldSec: finalMetrics.avgHoldSec,
      tradeCount: finalMetrics.tradeCount,
      wins: finalMetrics.wins,
      losses: finalMetrics.losses,
      bestCoins: finalMetrics.bestCoins,
      worstCoins: finalMetrics.worstCoins,
      bestTrade: finalMetrics.bestTrade,
      worstTrade: finalMetrics.worstTrade,
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
    scanUniverseSize: result.scanUniverseSize,
    scannedSymbols: result.scannedSymbols.slice(0, 100),
    simulatedFillCount: result.simulatedFillCount,
    strategyComparison: result.strategyComparison.slice(0, 8),
  });

  return result;
}
