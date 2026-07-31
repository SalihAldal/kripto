import type { BotPerformanceMetrics } from "@/src/server/trading-core/bots/bot-performance-types";

export type BotLeaderboardPeriod = "DAILY" | "WEEKLY" | "MONTHLY";
export type BotLeaderboardVerificationStatus = "VERIFIED" | "NEEDS_MORE_DATA" | "SUSPICIOUS" | "REJECTED";

export type BotLeaderboardVerifiedStats = {
  status: BotLeaderboardVerificationStatus;
  verified: boolean;
  sampleSize: number;
  minSampleSize: number;
  fakePnlScore: number;
  reasons: string[];
};

export type BotLeaderboardRow = {
  rank: number;
  botId: string;
  name: string;
  strategyType: string;
  riskLevel: string;
  period: BotLeaderboardPeriod;
  roi: number;
  consistency: number;
  drawdown: number;
  sharpeRatio: number;
  riskAdjustedReturn: number;
  winrate: number;
  totalPnl: number;
  score: number;
  verifiedStats: BotLeaderboardVerifiedStats;
  metrics: BotPerformanceMetrics;
  updatedAt: string;
};

export type BotLeaderboardSnapshot = {
  period: BotLeaderboardPeriod;
  leaderboard: BotLeaderboardRow[];
  featured: BotLeaderboardRow[];
  liveUpdating: boolean;
  updatedAt: string;
};
