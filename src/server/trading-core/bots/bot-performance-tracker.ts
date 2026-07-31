import { clamp } from "@/src/server/trading-core/indicators/math";
import type { BotPerformanceMetrics, BotTradeSample } from "@/src/server/trading-core/bots/bot-performance-types";
import { isSuccessfulNetExit } from "@/src/server/execution/profit-thresholds";

const MAX_SAMPLES_PER_BOT = 500;

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values: number[]) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function duration(sample: BotTradeSample) {
  if (Number.isFinite(sample.durationMs)) return Math.max(0, Number(sample.durationMs));
  const opened = sample.openedAt ? Date.parse(sample.openedAt) : 0;
  const closed = sample.closedAt ? Date.parse(sample.closedAt) : 0;
  return opened > 0 && closed > opened ? closed - opened : 0;
}

export class BotPerformanceTracker {
  private readonly samples = new Map<string, BotTradeSample[]>();

  record(sample: BotTradeSample) {
    const botId = sample.botId;
    const rows = this.samples.get(botId) ?? [];
    rows.unshift({ ...sample, closedAt: sample.closedAt ?? new Date().toISOString() });
    if (rows.length > MAX_SAMPLES_PER_BOT) rows.length = MAX_SAMPLES_PER_BOT;
    this.samples.set(botId, rows);
    return this.metrics(botId);
  }

  metrics(botId: string): BotPerformanceMetrics {
    const rows = this.samples.get(botId) ?? [];
    const wins = rows.filter((row) => isSuccessfulNetExit(row.returnPercent));
    const losses = rows.filter((row) => !isSuccessfulNetExit(row.returnPercent));
    const pnl = rows.map((row) => row.realizedPnl);
    const returns = rows.map((row) => row.returnPercent ?? row.realizedPnl).filter(Number.isFinite);
    const totalPnl = pnl.reduce((sum, value) => sum + value, 0);
    const grossProfit = wins.reduce((sum, row) => sum + row.realizedPnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, row) => sum + row.realizedPnl, 0));
    const avgWin = average(wins.map((row) => row.realizedPnl));
    const avgLoss = Math.abs(average(losses.map((row) => row.realizedPnl)));
    const winrate = rows.length > 0 ? (wins.length / rows.length) * 100 : 0;
    const expectancy = (winrate / 100) * avgWin - (1 - winrate / 100) * avgLoss;
    const returnStd = stddev(returns);
    const sharpeRatio = returnStd > 0 ? (average(returns) / returnStd) * Math.sqrt(Math.max(1, returns.length)) : 0;
    const maxDrawdown = this.maxDrawdown(rows);
    const avgTradeDurationMs = average(rows.map(duration).filter((value) => value > 0));
    const strategyConsistency = this.strategyConsistency(rows);
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
    const flags = this.flags({ rows, winrate, maxDrawdown, sharpeRatio, expectancy, profitFactor, strategyConsistency });
    const botScore = this.score({ winrate, maxDrawdown, sharpeRatio, expectancy, profitFactor, strategyConsistency, rows });
    const adaptiveWeight = Number(clamp(botScore / 60, 0.15, 2.5).toFixed(4));

    return {
      botId,
      tradeCount: rows.length,
      wins: wins.length,
      losses: losses.length,
      winrate: Number(winrate.toFixed(2)),
      averagePnl: Number(average(pnl).toFixed(8)),
      totalPnl: Number(totalPnl.toFixed(8)),
      maxDrawdown: Number(maxDrawdown.toFixed(4)),
      sharpeRatio: Number(sharpeRatio.toFixed(4)),
      expectancy: Number(expectancy.toFixed(8)),
      profitFactor: Number(profitFactor.toFixed(4)),
      avgTradeDurationMs: Number(avgTradeDurationMs.toFixed(2)),
      strategyConsistency: Number(strategyConsistency.toFixed(2)),
      botScore,
      adaptiveWeight,
      poorPerformance: flags.length > 0,
      flags,
      updatedAt: new Date().toISOString(),
    };
  }

  snapshot() {
    return Array.from(this.samples.keys()).map((botId) => this.metrics(botId));
  }

  private maxDrawdown(rows: BotTradeSample[]) {
    let equity = 0;
    let peak = 0;
    let maxDrawdown = 0;
    for (const row of [...rows].reverse()) {
      equity += row.realizedPnl;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, peak - equity);
    }
    return maxDrawdown;
  }

  private strategyConsistency(rows: BotTradeSample[]) {
    if (rows.length < 3) return rows.length > 0 ? 55 : 0;
    const recent = rows.slice(0, 30);
    const positive = recent.filter((row) => isSuccessfulNetExit(row.returnPercent)).length;
    const negative = recent.filter((row) => !isSuccessfulNetExit(row.returnPercent)).length;
    const directionalConsistency = Math.max(positive, negative) / Math.max(1, recent.length);
    const volatilityPenalty = clamp(stddev(recent.map((row) => row.realizedPnl)) * 2, 0, 35);
    return clamp(directionalConsistency * 100 - volatilityPenalty, 0, 100);
  }

  private score(input: {
    winrate: number;
    maxDrawdown: number;
    sharpeRatio: number;
    expectancy: number;
    profitFactor: number;
    strategyConsistency: number;
    rows: BotTradeSample[];
  }) {
    if (input.rows.length === 0) return 50;
    const winrateScore = input.winrate;
    const sharpeScore = clamp(50 + input.sharpeRatio * 18, 0, 100);
    const expectancyScore = clamp(50 + input.expectancy * 6, 0, 100);
    const profitFactorScore = clamp(input.profitFactor * 35, 0, 100);
    const drawdownPenalty = clamp(input.maxDrawdown * 2.5, 0, 45);
    const sampleConfidence = clamp(input.rows.length / 20, 0.35, 1);
    const raw =
      winrateScore * 0.24 +
      sharpeScore * 0.2 +
      expectancyScore * 0.2 +
      profitFactorScore * 0.16 +
      input.strategyConsistency * 0.14 +
      50 * 0.06 -
      drawdownPenalty;
    return Number(clamp(raw * sampleConfidence + 50 * (1 - sampleConfidence), 0, 100).toFixed(2));
  }

  private flags(input: {
    rows: BotTradeSample[];
    winrate: number;
    maxDrawdown: number;
    sharpeRatio: number;
    expectancy: number;
    profitFactor: number;
    strategyConsistency: number;
  }) {
    if (input.rows.length < 5) return [];
    return [
      input.winrate < 38 ? "LOW_WINRATE" : null,
      input.maxDrawdown > 12 ? "HIGH_DRAWDOWN" : null,
      input.sharpeRatio < -0.2 ? "NEGATIVE_SHARPE" : null,
      input.expectancy < 0 ? "NEGATIVE_EXPECTANCY" : null,
      input.profitFactor > 0 && input.profitFactor < 0.85 ? "LOW_PROFIT_FACTOR" : null,
      input.strategyConsistency < 35 ? "LOW_STRATEGY_CONSISTENCY" : null,
    ].filter((flag): flag is string => Boolean(flag));
  }
}

const globalTracker = globalThis as typeof globalThis & { __botPerformanceTracker?: BotPerformanceTracker };
export const botPerformanceTracker = globalTracker.__botPerformanceTracker ?? new BotPerformanceTracker();
globalTracker.__botPerformanceTracker = botPerformanceTracker;
