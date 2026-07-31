import { clamp } from "@/src/server/trading-core/indicators/math";
import type { BotMemoryState } from "@/src/server/trading-core/bots/bot-types";
import type { BotPerformanceMetrics } from "@/src/server/trading-core/bots/bot-performance-types";

export class BotPerformanceScorer {
  score(state: BotMemoryState, metrics?: BotPerformanceMetrics) {
    if (metrics && metrics.tradeCount > 0) return metrics.botScore;
    const winrate = state.trades > 0 ? state.wins / state.trades : 0.5;
    const pnlScore = clamp(50 + state.realizedPnl * 2 + state.unrealizedPnl, 0, 100);
    const streakPenalty = state.consecutiveLosses * 12;
    const activityBonus = Math.min(state.trades, 20) * 0.7;
    return Number(clamp(winrate * 45 + pnlScore * 0.45 + activityBonus - streakPenalty, 0, 100).toFixed(2));
  }

  weight(state: BotMemoryState, metrics?: BotPerformanceMetrics) {
    if (metrics && metrics.tradeCount > 0) return metrics.adaptiveWeight;
    const scoreWeight = clamp(state.score / 60, 0.15, 1.8);
    const pnlWeight = clamp(1 + state.realizedPnl / 100, 0.2, 2.2);
    const lossPenalty = clamp(1 - state.consecutiveLosses * 0.18, 0.2, 1);
    return Number((scoreWeight * pnlWeight * lossPenalty).toFixed(4));
  }

  shouldDisable(state: BotMemoryState, metrics?: BotPerformanceMetrics) {
    if (metrics?.poorPerformance && metrics.tradeCount >= 8 && metrics.botScore < 35) {
      return `Poor performance detected: ${metrics.flags.join(", ")}`;
    }
    if (state.trades < 5) return null;
    if (state.consecutiveLosses >= 4) return "Consecutive loss limit reached";
    if (state.score < 28) return "Bot performance score too low";
    if (state.realizedPnl <= -8) return "Realized PnL drawdown limit reached";
    return null;
  }
}
