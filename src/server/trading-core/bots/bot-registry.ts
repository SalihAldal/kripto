import { tradingFeatureFlags } from "@/src/server/trading-core/core/feature-flags";
import { tradingConfig } from "@/src/server/trading-core/config";
import type { BotConfig } from "@/src/server/trading-core/bots/bot-types";

const defaultBots: BotConfig[] = [
  {
    id: "scalping-bot",
    name: "Scalping Bot",
    strategy: "rsi-macd",
    priority: 70,
    enabled: true,
    minScore: 58,
    maxOpenPositions: 2,
    allowedRegimes: ["SIDEWAYS"],
    preferredModes: ["SCALPING"],
    cooldownMsAfterLoss: 180_000,
  },
  {
    id: "trend-bot",
    name: "Trend Bot",
    strategy: "rsi-macd",
    priority: 80,
    enabled: true,
    minScore: 66,
    maxOpenPositions: 2,
    allowedRegimes: ["TRENDING_BULLISH", "TRENDING_BEARISH", "HIGH_VOLATILITY"],
    preferredModes: ["TREND", "BREAKOUT"],
    cooldownMsAfterLoss: 300_000,
  },
  {
    id: "breakout-volume-bot",
    name: "Breakout Volume Bot",
    strategy: "volume-spike",
    priority: 85,
    enabled: true,
    minScore: 64,
    maxOpenPositions: 1,
    allowedRegimes: ["HIGH_VOLATILITY", "TRENDING_BULLISH", "TRENDING_BEARISH"],
    preferredModes: ["BREAKOUT"],
    cooldownMsAfterLoss: 420_000,
  },
];

export class BotRegistry {
  private readonly bots = new Map<string, BotConfig>();

  constructor(configs: BotConfig[] = defaultBots) {
    for (const config of configs) this.register(config);
  }

  register(config: BotConfig) {
    this.bots.set(config.id, config);
  }

  get(id: string) {
    return this.bots.get(id) ?? null;
  }

  all() {
    return Array.from(this.bots.values()).map((bot) => {
      const runtime = tradingConfig.getBot(bot.id);
      return runtime
        ? {
            ...bot,
            enabled: runtime.enabled,
            minScore: runtime.minScore,
            maxOpenPositions: runtime.maxOpenPositions,
            cooldownMsAfterLoss: runtime.cooldownMsAfterLoss,
          }
        : bot;
    });
  }

  enabled() {
    return this.all().filter((bot) => bot.enabled && tradingFeatureFlags.isModuleEnabled(bot.id, true));
  }
}
