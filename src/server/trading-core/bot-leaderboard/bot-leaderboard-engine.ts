import { botProfileStore } from "@/src/server/trading-core/bot-profiles";
import type { TradingBotProfile } from "@/src/server/trading-core/bot-profiles";
import { BotLeaderboardFakePnlGuard } from "@/src/server/trading-core/bot-leaderboard/fake-pnl-guard";
import type { BotLeaderboardPeriod, BotLeaderboardRow, BotLeaderboardSnapshot } from "@/src/server/trading-core/bot-leaderboard/bot-leaderboard-types";
import { clamp } from "@/src/server/trading-core/indicators/math";
import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";

function periodDays(period: BotLeaderboardPeriod) {
  if (period === "DAILY") return 1;
  if (period === "WEEKLY") return 7;
  return 30;
}

function round(value: number, decimals = 2) {
  return Number(value.toFixed(decimals));
}

export class BotLeaderboardEngine {
  private readonly guard = new BotLeaderboardFakePnlGuard();

  leaderboard(period: BotLeaderboardPeriod = "DAILY"): BotLeaderboardSnapshot {
    const rows = botProfileStore
      .list()
      .map((profile) => this.toRow(profile, period))
      .sort((a, b) => b.score - a.score)
      .map((row, index) => ({ ...row, rank: index + 1 }));

    tradingLogger.info({
      category: "BOT",
      source: "trading-core.bot-leaderboard",
      message: `Bot leaderboard updated: ${period}`,
      status: "SUCCESS",
      metricName: "bot_leaderboard.size",
      metricValue: rows.length,
      context: { topBot: rows[0]?.botId, period },
    });

    return {
      period,
      leaderboard: rows,
      featured: rows.filter((row) => row.verifiedStats.status !== "REJECTED").slice(0, 5),
      liveUpdating: true,
      updatedAt: new Date().toISOString(),
    };
  }

  private toRow(profile: TradingBotProfile, period: BotLeaderboardPeriod): BotLeaderboardRow {
    const metrics = profile.metrics;
    const verifiedStats = this.guard.verify(profile, period);
    const roi = this.periodRoi(profile, period);
    const consistency = metrics.strategyConsistency;
    const drawdown = metrics.maxDrawdown;
    const sharpeRatio = metrics.sharpeRatio;
    const riskAdjustedReturn = this.riskAdjustedReturn(roi, drawdown, sharpeRatio, verifiedStats.fakePnlScore);
    const score =
      clamp(roi * 1.4, -20, 60) +
      consistency * 0.22 +
      clamp(50 + sharpeRatio * 16, 0, 100) * 0.22 +
      riskAdjustedReturn * 0.28 +
      metrics.winrate * 0.12 -
      drawdown * 1.25 -
      verifiedStats.fakePnlScore * 0.65;

    return {
      rank: 0,
      botId: profile.botId,
      name: profile.name,
      strategyType: profile.strategyType,
      riskLevel: profile.riskLevel,
      period,
      roi: round(roi),
      consistency: round(consistency),
      drawdown: round(drawdown),
      sharpeRatio: round(sharpeRatio, 4),
      riskAdjustedReturn: round(riskAdjustedReturn),
      winrate: round(metrics.winrate),
      totalPnl: round(this.periodPnl(profile, period), 4),
      score: round(clamp(score, 0, 100)),
      verifiedStats,
      metrics,
      updatedAt: metrics.updatedAt,
    };
  }

  private periodPnl(profile: TradingBotProfile, period: BotLeaderboardPeriod) {
    const since = Date.now() - periodDays(period) * 86_400_000;
    const points = profile.performanceCurve.filter((point) => Date.parse(point.timestamp) >= since).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    if (points.length < 2) return profile.metrics.totalPnl;
    return points[points.length - 1].pnl - points[0].pnl;
  }

  private periodRoi(profile: TradingBotProfile, period: BotLeaderboardPeriod) {
    const pnl = this.periodPnl(profile, period);
    const estimatedCapital = Math.max(100, Math.abs(profile.metrics.averagePnl) * Math.max(10, profile.metrics.tradeCount) * 10, Math.abs(profile.metrics.maxDrawdown) * 25);
    return (pnl / estimatedCapital) * 100;
  }

  private riskAdjustedReturn(roi: number, drawdown: number, sharpeRatio: number, fakePnlScore: number) {
    const denominator = Math.max(1, drawdown + fakePnlScore * 0.08);
    return clamp((roi / denominator) * 18 + sharpeRatio * 10 + 50, 0, 100);
  }
}

const globalLeaderboard = globalThis as typeof globalThis & { __botLeaderboardEngine?: BotLeaderboardEngine };
export const botLeaderboardEngine = globalLeaderboard.__botLeaderboardEngine ?? new BotLeaderboardEngine();
globalLeaderboard.__botLeaderboardEngine = botLeaderboardEngine;
