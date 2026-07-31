import type { MarketRegimeDecision, MarketRegimeType, StrategyMode, StrategyRegimeRule } from "@/src/server/trading-core/market-regime/market-regime.types";

const defaultRules: StrategyRegimeRule[] = [
  {
    strategy: "scalping",
    allowedRegimes: ["SIDEWAYS"],
    preferredMode: "SCALPING",
  },
  {
    strategy: "trend",
    allowedRegimes: ["TRENDING_BULLISH", "TRENDING_BEARISH", "HIGH_VOLATILITY"],
    preferredMode: "TREND",
  },
  {
    strategy: "breakout",
    allowedRegimes: ["HIGH_VOLATILITY", "TRENDING_BULLISH", "TRENDING_BEARISH"],
    preferredMode: "BREAKOUT",
  },
  {
    strategy: "rsi-macd",
    allowedRegimes: ["SIDEWAYS", "TRENDING_BULLISH", "TRENDING_BEARISH"],
    preferredMode: "TREND",
  },
  {
    strategy: "volume-spike",
    allowedRegimes: ["HIGH_VOLATILITY", "TRENDING_BULLISH", "TRENDING_BEARISH"],
    preferredMode: "BREAKOUT",
  },
];

export class StrategyRegimePolicy {
  private readonly rules = new Map<string, StrategyRegimeRule>();

  constructor(rules: StrategyRegimeRule[] = defaultRules) {
    for (const rule of rules) this.register(rule);
  }

  register(rule: StrategyRegimeRule) {
    this.rules.set(rule.strategy, rule);
  }

  isAllowed(strategy: string, regime: MarketRegimeType) {
    const rule = this.rules.get(strategy);
    if (!rule) return regime !== "MANIPULATION_ZONE" && regime !== "LOW_VOLATILITY";
    return rule.allowedRegimes.includes(regime);
  }

  recommendedStrategies(decision: MarketRegimeDecision) {
    return Array.from(this.rules.values())
      .filter((rule) => rule.allowedRegimes.includes(decision.regime))
      .map((rule) => rule.strategy);
  }

  modeForStrategy(strategy: string): StrategyMode | null {
    return this.rules.get(strategy)?.preferredMode ?? null;
  }
}
