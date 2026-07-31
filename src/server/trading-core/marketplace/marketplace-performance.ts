import type { BotPerformanceMetrics } from "@/src/server/trading-core/bots/bot-performance-types";
import type { StrategyLeaderboardRow, StrategyPerformanceHistory } from "@/src/server/trading-core/marketplace/marketplace-types";
import { strategyMarketplaceStore } from "@/src/server/trading-core/marketplace/marketplace-store";

export class StrategyMarketplacePerformance {
  private readonly history: StrategyPerformanceHistory[] = [];

  record(input: { listingId: string; botId: string; metrics: BotPerformanceMetrics }) {
    const row: StrategyPerformanceHistory = {
      listingId: input.listingId,
      botId: input.botId,
      metrics: input.metrics,
      recordedAt: new Date().toISOString(),
    };
    this.history.unshift(row);
    if (this.history.length > 1000) this.history.length = 1000;
    return row;
  }

  historyFor(listingId: string) {
    return this.history.filter((row) => row.listingId === listingId);
  }

  leaderboard(): StrategyLeaderboardRow[] {
    return strategyMarketplaceStore
      .list({ status: "VERIFIED" })
      .map((listing) => {
        const latest = this.historyFor(listing.listingId)[0];
        const metrics = latest?.metrics;
        const performanceScore = metrics
          ? metrics.botScore + metrics.profitFactor * 6 + metrics.winrate * 0.18 - metrics.maxDrawdown * 1.2
          : 0;
        const score =
          performanceScore * 0.58 +
          listing.ratingAverage * 8 +
          Math.min(20, listing.subscriberCount * 0.8) +
          Math.min(20, listing.totalRevenueUsd / 100);
        return {
          listingId: listing.listingId,
          strategyId: listing.strategyId,
          title: listing.title,
          creatorUserId: listing.creatorUserId,
          score: Number(score.toFixed(2)),
          ratingAverage: listing.ratingAverage,
          subscriberCount: listing.subscriberCount,
          totalPnl: metrics?.totalPnl ?? 0,
          winrate: metrics?.winrate ?? 0,
          maxDrawdown: metrics?.maxDrawdown ?? 0,
          updatedAt: latest?.recordedAt ?? listing.updatedAt,
        };
      })
      .sort((a, b) => b.score - a.score);
  }
}

const globalPerformance = globalThis as typeof globalThis & { __strategyMarketplacePerformance?: StrategyMarketplacePerformance };
export const strategyMarketplacePerformance = globalPerformance.__strategyMarketplacePerformance ?? new StrategyMarketplacePerformance();
globalPerformance.__strategyMarketplacePerformance = strategyMarketplacePerformance;
