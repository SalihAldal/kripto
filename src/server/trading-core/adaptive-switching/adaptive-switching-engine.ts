import { botPerformanceTracker } from "@/src/server/trading-core/bots/bot-performance-tracker";
import { BotRegistry } from "@/src/server/trading-core/bots/bot-registry";
import { tradingFeatureFlags } from "@/src/server/trading-core/core/feature-flags";
import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";
import type { AdaptiveBotDecision, AdaptiveSwitchingInput, AdaptiveSwitchingPlan } from "@/src/server/trading-core/adaptive-switching/adaptive-switching-types";
import { botAllowedForMarket, confidenceForMarket, resolveAdaptiveMarketType } from "@/src/server/trading-core/adaptive-switching/market-switch-policy";

export class AdaptiveSwitchingEngine {
  private readonly registry = new BotRegistry();
  private readonly strategyCooldownUntil = new Map<string, string>();
  private lastPlan: AdaptiveSwitchingPlan | null = null;

  plan(input: AdaptiveSwitchingInput): AdaptiveSwitchingPlan {
    const marketType = resolveAdaptiveMarketType(input.marketRegime);
    const regimeConfidenceScore = confidenceForMarket(input.marketRegime, marketType);
    const minConfidence = input.minRegimeConfidence ?? 55;
    const cooldownMs = input.cooldownMs ?? 30 * 60_000;
    const decisions = this.registry.all().map((bot): AdaptiveBotDecision => {
      const metrics = botPerformanceTracker.metrics(bot.id);
      const poor = Boolean(input.disablePoorStrategies ?? true) && metrics.poorPerformance && metrics.tradeCount >= 8;
      const onCooldown = this.isStrategyCooling(bot.strategy);
      const marketAllowed = regimeConfidenceScore >= minConfidence && botAllowedForMarket(bot, marketType);
      const action = poor ? "COOLDOWN" : onCooldown || !marketAllowed ? "PAUSE" : marketAllowed ? "ACTIVATE" : "KEEP";
      if (poor) this.strategyCooldownUntil.set(bot.strategy, new Date(Date.now() + cooldownMs).toISOString());
      return {
        botId: bot.id,
        botName: bot.name,
        strategy: bot.strategy,
        action,
        enabled: action === "ACTIVATE",
        reason: poor
          ? `Poor strategy performance: ${metrics.flags.join(", ") || "low score"}`
          : onCooldown
            ? `Strategy cooldown active until ${this.strategyCooldownUntil.get(bot.strategy)}`
            : marketAllowed
              ? `${bot.name} matches ${marketType}`
              : `${bot.name} does not match ${marketType}`,
        metrics,
      };
    });

    if (input.apply) this.apply(decisions);

    const plan: AdaptiveSwitchingPlan = {
      symbol: input.symbol.toUpperCase(),
      marketType,
      regimeConfidenceScore,
      activeBots: decisions.filter((row) => row.enabled).map((row) => row.botId),
      pausedBots: decisions.filter((row) => !row.enabled).map((row) => row.botId),
      cooldownStrategies: Array.from(this.strategyCooldownUntil.entries()).filter(([, until]) => Date.parse(until) > Date.now()).map(([strategy]) => strategy),
      botDecisions: decisions,
      applied: Boolean(input.apply),
      reasons: [
        `marketType=${marketType}`,
        `regimeConfidence=${regimeConfidenceScore}`,
        `activeBots=${decisions.filter((row) => row.enabled).length}`,
      ],
      generatedAt: new Date().toISOString(),
    };
    this.lastPlan = plan;
    tradingLogger.info({
      category: "BOT",
      source: "trading-core.adaptive-switching",
      message: `Adaptive switching plan: ${marketType}`,
      status: "SUCCESS",
      symbol: plan.symbol,
      metricName: "adaptive_switching.regime_confidence",
      metricValue: regimeConfidenceScore,
      context: { activeBots: plan.activeBots, pausedBots: plan.pausedBots, applied: plan.applied },
    });
    return plan;
  }

  status() {
    return {
      lastPlan: this.lastPlan,
      cooldowns: Array.from(this.strategyCooldownUntil.entries()).map(([strategy, cooldownUntil]) => ({ strategy, cooldownUntil })),
      updatedAt: new Date().toISOString(),
    };
  }

  private apply(decisions: AdaptiveBotDecision[]) {
    for (const decision of decisions) {
      tradingFeatureFlags.setModuleEnabled(decision.botId, decision.enabled);
      tradingFeatureFlags.setStrategyEnabled(decision.strategy, decision.action !== "COOLDOWN");
    }
  }

  private isStrategyCooling(strategy: string) {
    const until = this.strategyCooldownUntil.get(strategy);
    if (!until) return false;
    if (Date.parse(until) > Date.now()) return true;
    this.strategyCooldownUntil.delete(strategy);
    return false;
  }
}

const globalSwitching = globalThis as typeof globalThis & { __adaptiveSwitchingEngine?: AdaptiveSwitchingEngine };
export const adaptiveSwitchingEngine = globalSwitching.__adaptiveSwitchingEngine ?? new AdaptiveSwitchingEngine();
globalSwitching.__adaptiveSwitchingEngine = adaptiveSwitchingEngine;
