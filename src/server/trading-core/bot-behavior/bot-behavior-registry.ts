import type { BotBehaviorProfile } from "@/src/server/trading-core/bot-behavior/bot-behavior-types";

const defaultProfiles: BotBehaviorProfile[] = [
  {
    botId: "scalping-bot",
    name: "Scalper Behavior",
    behaviorType: "SCALPER",
    riskAppetite: "MEDIUM",
    tradePace: "FAST",
    preferredRegimes: ["SIDEWAYS", "LOW_VOLATILITY"],
    preferredVolatilityPercent: { min: 0.15, max: 2.4 },
    takeProfitPercent: 0.45,
    stopLossPercent: 0.32,
    trailingEnabled: true,
    partialTakeProfitPercent: 0.28,
    maxHoldMinutes: 18,
    entryAggression: 85,
    positionSizeMultiplier: 0.75,
    minSignalScore: 58,
    minConfidence: 55,
    notes: ["Hizli giris", "Dusuk TP", "Sik islem", "Sideways market tercih eder"],
  },
  {
    botId: "trend-bot",
    name: "Swing Trend Behavior",
    behaviorType: "SWING",
    riskAppetite: "LOW",
    tradePace: "SLOW",
    preferredRegimes: ["TRENDING_BULLISH", "TRENDING_BEARISH"],
    preferredVolatilityPercent: { min: 0.6, max: 5.5 },
    takeProfitPercent: 2.8,
    stopLossPercent: 1.15,
    trailingEnabled: true,
    partialTakeProfitPercent: 1.4,
    maxHoldMinutes: 1440,
    entryAggression: 45,
    positionSizeMultiplier: 0.55,
    minSignalScore: 68,
    minConfidence: 65,
    notes: ["Az islem", "Buyuk TP", "Trend odakli", "Daha secici giris"],
  },
  {
    botId: "breakout-volume-bot",
    name: "Breakout Momentum Behavior",
    behaviorType: "BREAKOUT",
    riskAppetite: "HIGH",
    tradePace: "NORMAL",
    preferredRegimes: ["HIGH_VOLATILITY", "TRENDING_BULLISH", "TRENDING_BEARISH"],
    preferredVolatilityPercent: { min: 1.2, max: 8 },
    takeProfitPercent: 1.65,
    stopLossPercent: 0.9,
    trailingEnabled: true,
    partialTakeProfitPercent: 0.9,
    maxHoldMinutes: 240,
    entryAggression: 78,
    positionSizeMultiplier: 0.85,
    minSignalScore: 64,
    minConfidence: 62,
    notes: ["Volume spike odakli", "Breakout markette agresif", "Volatilite filtreli"],
  },
  {
    botId: "dca-bot",
    name: "DCA Averaging Behavior",
    behaviorType: "DCA",
    riskAppetite: "MEDIUM",
    tradePace: "SLOW",
    preferredRegimes: ["SIDEWAYS", "HIGH_VOLATILITY"],
    preferredVolatilityPercent: { min: 1, max: 7 },
    takeProfitPercent: 1.1,
    stopLossPercent: 2.8,
    trailingEnabled: false,
    partialTakeProfitPercent: 0.65,
    maxHoldMinutes: 2880,
    entryAggression: 35,
    positionSizeMultiplier: 0.35,
    minSignalScore: 55,
    minConfidence: 52,
    dca: {
      enabled: true,
      maxAdds: 4,
      stepPercent: 0.75,
      sizeMultiplier: 1.25,
      volatilityMultiplier: 0.4,
    },
    notes: ["Kademeli ekleme", "Volatility bazli averaging", "Kucuk ilk giris"],
  },
];

export class BotBehaviorRegistry {
  private readonly profiles = new Map<string, BotBehaviorProfile>();

  constructor(profiles: BotBehaviorProfile[] = defaultProfiles) {
    for (const profile of profiles) this.upsert(profile);
  }

  upsert(profile: BotBehaviorProfile) {
    this.profiles.set(profile.botId, profile);
    return profile;
  }

  get(botId: string) {
    return this.profiles.get(botId) ?? this.profiles.get("scalping-bot") ?? null;
  }

  all() {
    return Array.from(this.profiles.values());
  }
}

const globalRegistry = globalThis as typeof globalThis & { __botBehaviorRegistry?: BotBehaviorRegistry };
export const botBehaviorRegistry = globalRegistry.__botBehaviorRegistry ?? new BotBehaviorRegistry();
globalRegistry.__botBehaviorRegistry = botBehaviorRegistry;
