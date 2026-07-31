import type { TradingBotProfile } from "@/src/server/trading-core/bot-profiles";
import type { BotLeaderboardPeriod, BotLeaderboardVerifiedStats } from "@/src/server/trading-core/bot-leaderboard/bot-leaderboard-types";

function periodMinSamples(period: BotLeaderboardPeriod) {
  if (period === "DAILY") return 3;
  if (period === "WEEKLY") return 8;
  return 15;
}

export class BotLeaderboardFakePnlGuard {
  verify(profile: TradingBotProfile, period: BotLeaderboardPeriod): BotLeaderboardVerifiedStats {
    const reasons: string[] = [];
    const minSampleSize = periodMinSamples(period);
    const metrics = profile.metrics;
    let fakePnlScore = 0;

    if (metrics.tradeCount < minSampleSize) {
      fakePnlScore += 28;
      reasons.push(`Sample size below ${period} minimum`);
    }
    if (metrics.totalPnl > 0 && metrics.tradeCount === 0) {
      fakePnlScore += 70;
      reasons.push("PnL exists without closed trades");
    }
    if (metrics.winrate >= 95 && metrics.tradeCount >= 5) {
      fakePnlScore += 22;
      reasons.push("Unrealistically high winrate");
    }
    if (metrics.maxDrawdown === 0 && metrics.totalPnl > 0 && metrics.tradeCount >= 5) {
      fakePnlScore += 24;
      reasons.push("Positive PnL with zero drawdown");
    }
    if (metrics.profitFactor > 25 && metrics.tradeCount >= 5) {
      fakePnlScore += 18;
      reasons.push("Extreme profit factor");
    }
    if (this.largeCurveJump(profile)) {
      fakePnlScore += 32;
      reasons.push("Abnormal performance curve jump");
    }
    if (profile.ratingCount === 0 && metrics.tradeCount < minSampleSize) {
      fakePnlScore += 10;
      reasons.push("No community rating and low sample size");
    }

    const status =
      fakePnlScore >= 75
        ? "REJECTED"
        : fakePnlScore >= 45
          ? "SUSPICIOUS"
          : metrics.tradeCount < minSampleSize
            ? "NEEDS_MORE_DATA"
            : "VERIFIED";

    return {
      status,
      verified: status === "VERIFIED",
      sampleSize: metrics.tradeCount,
      minSampleSize,
      fakePnlScore: Number(Math.min(100, fakePnlScore).toFixed(2)),
      reasons: reasons.length > 0 ? reasons : ["Stats verified"],
    };
  }

  private largeCurveJump(profile: TradingBotProfile) {
    const curve = [...profile.performanceCurve].reverse();
    if (curve.length < 3) return false;
    const jumps = curve.slice(1).map((point, index) => Math.abs(point.pnl - curve[index].pnl));
    const averageJump = jumps.reduce((sum, jump) => sum + jump, 0) / Math.max(1, jumps.length);
    const maxJump = Math.max(...jumps);
    return averageJump > 0 && maxJump > averageJump * 6 && maxJump > Math.max(50, Math.abs(profile.metrics.totalPnl) * 0.5);
  }
}
