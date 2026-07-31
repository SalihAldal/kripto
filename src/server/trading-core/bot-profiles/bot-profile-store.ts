import { randomUUID } from "node:crypto";
import { BotRegistry } from "@/src/server/trading-core/bots/bot-registry";
import { botPerformanceTracker } from "@/src/server/trading-core/bots/bot-performance-tracker";
import type { BotPerformanceMetrics, BotTradeSample } from "@/src/server/trading-core/bots/bot-performance-types";
import type { BotProfileRating, BotProfileUpsertInput, TradingBotProfile } from "@/src/server/trading-core/bot-profiles/bot-profile-types";

function now() {
  return new Date().toISOString();
}

function fallbackMetrics(botId: string): BotPerformanceMetrics {
  return botPerformanceTracker.metrics(botId);
}

function monthlyPnl(metrics: BotPerformanceMetrics) {
  return Number(metrics.totalPnl.toFixed(4));
}

function seedCurve(botId: string, basePnl: number) {
  return Array.from({ length: 12 }).map((_, index) => {
    const drift = Math.sin(index + botId.length) * 14 + index * 5;
    return {
      timestamp: new Date(Date.now() - (11 - index) * 86_400_000).toISOString(),
      pnl: Number((basePnl + drift).toFixed(4)),
      drawdown: Number(Math.max(0, 4 + Math.cos(index) * 2).toFixed(2)),
      winrate: Number(Math.min(82, Math.max(38, 52 + index * 1.8)).toFixed(2)),
      aiConfidence: Number(Math.min(95, Math.max(45, 62 + Math.sin(index) * 8)).toFixed(2)),
    };
  });
}

export class BotProfileStore {
  private readonly profiles = new Map<string, TradingBotProfile>();
  private readonly ratings = new Map<string, BotProfileRating>();

  constructor() {
    this.seedDefaults();
  }

  list() {
    return Array.from(this.profiles.values())
      .map((profile) => this.withLiveMetrics(profile))
      .sort((a, b) => b.metrics.botScore + b.ratingAverage * 4 - (a.metrics.botScore + a.ratingAverage * 4));
  }

  featured() {
    return this.list().slice(0, 3);
  }

  get(botId: string) {
    const profile = this.profiles.get(botId);
    return profile ? this.withLiveMetrics(profile) : null;
  }

  upsert(input: BotProfileUpsertInput) {
    const current = this.profiles.get(input.botId);
    const metrics = current?.metrics ?? fallbackMetrics(input.botId);
    const profile: TradingBotProfile = {
      botId: input.botId,
      name: input.name,
      description: input.description,
      riskLevel: input.riskLevel,
      supportedPairs: input.supportedPairs.map((pair) => pair.toUpperCase()),
      strategyType: input.strategyType,
      recommendedLeverage: input.recommendedLeverage,
      tradeFrequency: input.tradeFrequency,
      aiConfidence: input.aiConfidence ?? current?.aiConfidence ?? 65,
      tags: input.tags ?? current?.tags ?? [],
      ratingAverage: current?.ratingAverage ?? 0,
      ratingCount: current?.ratingCount ?? 0,
      metrics,
      monthlyPnl: monthlyPnl(metrics),
      maxDrawdown: metrics.maxDrawdown,
      performanceCurve: current?.performanceCurve ?? seedCurve(input.botId, metrics.totalPnl),
      createdAt: current?.createdAt ?? now(),
      updatedAt: now(),
    };
    this.profiles.set(input.botId, profile);
    return this.withLiveMetrics(profile);
  }

  rate(input: { botId: string; userId: string; stars: number; comment?: string }) {
    const profile = this.requireProfile(input.botId);
    const rating: BotProfileRating = {
      ratingId: randomUUID(),
      botId: input.botId,
      userId: input.userId,
      stars: Math.max(1, Math.min(5, Math.round(input.stars))),
      comment: input.comment,
      createdAt: now(),
    };
    this.ratings.set(rating.ratingId, rating);
    const ratings = this.ratingsFor(input.botId);
    const ratingAverage = ratings.reduce((sum, row) => sum + row.stars, 0) / Math.max(1, ratings.length);
    this.profiles.set(input.botId, {
      ...profile,
      ratingAverage: Number(ratingAverage.toFixed(2)),
      ratingCount: ratings.length,
      updatedAt: now(),
    });
    return rating;
  }

  recordPerformance(sample: BotTradeSample & { aiConfidence?: number }) {
    const metrics = botPerformanceTracker.record(sample);
    const profile = this.requireProfile(sample.botId);
    const latest = {
      timestamp: sample.closedAt ?? now(),
      pnl: Number(metrics.totalPnl.toFixed(4)),
      drawdown: metrics.maxDrawdown,
      winrate: metrics.winrate,
      aiConfidence: sample.aiConfidence ?? profile.aiConfidence,
    };
    this.profiles.set(sample.botId, {
      ...profile,
      aiConfidence: latest.aiConfidence,
      metrics,
      monthlyPnl: monthlyPnl(metrics),
      maxDrawdown: metrics.maxDrawdown,
      performanceCurve: [latest, ...profile.performanceCurve].slice(0, 60),
      updatedAt: now(),
    });
    return this.get(sample.botId);
  }

  ratingsFor(botId: string) {
    return Array.from(this.ratings.values()).filter((rating) => rating.botId === botId);
  }

  snapshot() {
    return {
      profiles: this.list(),
      featured: this.featured(),
      ratings: Array.from(this.ratings.values()),
      updatedAt: now(),
    };
  }

  private withLiveMetrics(profile: TradingBotProfile): TradingBotProfile {
    const metrics = botPerformanceTracker.metrics(profile.botId);
    const liveMetrics = metrics.tradeCount > 0 ? metrics : profile.metrics;
    return {
      ...profile,
      metrics: liveMetrics,
      monthlyPnl: monthlyPnl(liveMetrics),
      maxDrawdown: liveMetrics.maxDrawdown,
    };
  }

  private requireProfile(botId: string) {
    const profile = this.get(botId);
    if (!profile) throw new Error("Bot profile not found");
    return profile;
  }

  private seedDefaults() {
    const registry = new BotRegistry();
    for (const bot of registry.all()) {
      const strategyType = bot.preferredModes.includes("SCALPING") ? "SCALPING" : bot.preferredModes.includes("BREAKOUT") ? "BREAKOUT" : "TREND";
      this.upsert({
        botId: bot.id,
        name: bot.name,
        description: `${bot.name} ${bot.strategy} stratejisiyle calisan, risk engine ve portfolio guard uyumlu profesyonel bot profili.`,
        riskLevel: bot.priority >= 84 ? "HIGH" : bot.priority >= 75 ? "MEDIUM" : "LOW",
        supportedPairs: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"],
        strategyType,
        recommendedLeverage: bot.priority >= 84 ? 5 : 3,
        tradeFrequency: strategyType === "SCALPING" ? "HIGH" : strategyType === "BREAKOUT" ? "MEDIUM" : "LOW",
        aiConfidence: bot.priority >= 84 ? 76 : 68,
        tags: [bot.strategy, strategyType.toLowerCase(), "risk-engine-ready"],
      });
    }
  }
}

const globalProfiles = globalThis as typeof globalThis & { __botProfileStore?: BotProfileStore };
export const botProfileStore = globalProfiles.__botProfileStore ?? new BotProfileStore();
globalProfiles.__botProfileStore = botProfileStore;
