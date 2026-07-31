import type { BotPerformanceMetrics } from "@/src/server/trading-core/bots/bot-performance-types";
import type { StrategySdkMetadata } from "@/src/server/trading-core/strategy-sdk";

export type MarketplaceStatus = "DRAFT" | "PENDING_VERIFICATION" | "VERIFIED" | "REJECTED" | "SUSPENDED";
export type MarketplacePricingType = "FREE" | "ONE_TIME" | "SUBSCRIPTION" | "BOT_RENTAL";
export type MarketplaceSubscriptionStatus = "ACTIVE" | "CANCELED" | "EXPIRED";

export type StrategyMarketplaceListing = {
  listingId: string;
  strategyId: string;
  creatorUserId: string;
  title: string;
  description: string;
  metadata: StrategySdkMetadata;
  status: MarketplaceStatus;
  pricingType: MarketplacePricingType;
  priceUsd: number;
  monthlyPriceUsd?: number;
  botRentalMonthlyUsd?: number;
  revenueSharePercent: number;
  tags: string[];
  ratingAverage: number;
  ratingCount: number;
  subscriberCount: number;
  totalRevenueUsd: number;
  verification?: StrategyVerificationResult;
  createdAt: string;
  updatedAt: string;
};

export type StrategyVerificationResult = {
  verified: boolean;
  score: number;
  checks: Array<{ name: string; passed: boolean; message: string }>;
  verifiedAt: string;
};

export type StrategyRating = {
  ratingId: string;
  listingId: string;
  userId: string;
  stars: number;
  comment?: string;
  createdAt: string;
};

export type StrategySubscription = {
  subscriptionId: string;
  listingId: string;
  userId: string;
  status: MarketplaceSubscriptionStatus;
  pricingType: MarketplacePricingType;
  amountUsd: number;
  startedAt: string;
  expiresAt?: string;
};

export type StrategyRevenueShare = {
  listingId: string;
  creatorUserId: string;
  grossRevenueUsd: number;
  creatorRevenueUsd: number;
  platformRevenueUsd: number;
  revenueSharePercent: number;
  updatedAt: string;
};

export type StrategyPerformanceHistory = {
  listingId: string;
  botId: string;
  metrics: BotPerformanceMetrics;
  recordedAt: string;
};

export type StrategyLeaderboardRow = {
  listingId: string;
  strategyId: string;
  title: string;
  creatorUserId: string;
  score: number;
  ratingAverage: number;
  subscriberCount: number;
  totalPnl: number;
  winrate: number;
  maxDrawdown: number;
  updatedAt: string;
};
