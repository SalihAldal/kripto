import { botProfileStore, type TradingBotProfile } from "@/src/server/trading-core/bot-profiles";
import { getCapitalAllocationConfig } from "@/src/server/trading-core/capital-allocation/capital-allocation-config";
import type {
  BotCapitalAllocation,
  CapitalAllocationConfig,
  CapitalAllocationExposureCheck,
  CapitalAllocationPlan,
  CapitalAllocationRequest,
} from "@/src/server/trading-core/capital-allocation/capital-allocation-types";
import { clamp } from "@/src/server/trading-core/indicators/math";
import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";

function round(value: number, decimals = 2) {
  return Number(value.toFixed(decimals));
}

function riskMultiplier(riskLevel: string) {
  if (riskLevel === "HIGH") return 0.55;
  if (riskLevel === "MEDIUM") return 0.82;
  return 1.08;
}

function isHedgeBot(profile: TradingBotProfile) {
  return profile.botId.toLowerCase().includes("hedge") || profile.tags.some((tag) => tag.toLowerCase().includes("hedge"));
}

export class CapitalAllocationEngine {
  allocate(request: CapitalAllocationRequest): CapitalAllocationPlan {
    const config = { ...getCapitalAllocationConfig(request.riskProfile), mode: request.mode ?? "RISK_PARITY" } satisfies CapitalAllocationConfig;
    const totalCapitalUsd = request.totalCapitalUsd;
    const profiles = botProfileStore
      .list()
      .filter((profile) => request.includeInactiveBots || profile.metrics.poorPerformance === false || profile.metrics.tradeCount === 0);
    const normalBots = profiles.filter((profile) => !isHedgeBot(profile));
    const hedgeProfile = profiles.find(isHedgeBot) ?? this.syntheticHedgeProfile();
    const hedgeAllocation = this.buildHedgeAllocation(hedgeProfile, totalCapitalUsd, config);
    const allocatablePercent = Math.max(0, 100 - hedgeAllocation.allocationPercent);
    const allocations = this.allocateBots(normalBots, request, config, allocatablePercent, totalCapitalUsd);
    const exposureChecks = this.exposureChecks(allocations, request.positions ?? [], totalCapitalUsd, config);
    const warnings = [
      exposureChecks.some((check) => check.status === "BLOCK") ? "Some bot exposure is above max limit" : null,
      allocations.length === 0 ? "No eligible bot found for capital allocation" : null,
      hedgeAllocation.allocationPercent <= 0 ? "Hedge allocation is disabled" : null,
    ].filter((item): item is string => Boolean(item));

    const plan: CapitalAllocationPlan = {
      userId: request.userId,
      totalCapitalUsd,
      riskProfile: config.riskProfile,
      mode: config.mode,
      allocations,
      hedgeAllocation,
      exposureChecks,
      summary: {
        allocatedPercent: round(allocations.reduce((sum, item) => sum + item.allocationPercent, 0) + hedgeAllocation.allocationPercent),
        allocatedUsd: round(allocations.reduce((sum, item) => sum + item.allocationUsd, 0) + hedgeAllocation.allocationUsd),
        hedgePercent: hedgeAllocation.allocationPercent,
        botCount: allocations.length,
        maxExposurePercent: config.maxTotalExposurePercent,
      },
      warnings,
      generatedAt: new Date().toISOString(),
    };

    tradingLogger.info({
      category: "BOT",
      source: "trading-core.capital-allocation",
      message: `Capital allocation generated for ${config.riskProfile}`,
      status: "SUCCESS",
      userId: request.userId,
      metricName: "capital_allocation.allocated_percent",
      metricValue: plan.summary.allocatedPercent,
      context: { mode: config.mode, botCount: plan.summary.botCount, warnings },
    });
    return plan;
  }

  private allocateBots(profiles: TradingBotProfile[], request: CapitalAllocationRequest, config: CapitalAllocationConfig, allocatablePercent: number, totalCapitalUsd: number) {
    const manual = request.manualTargets && request.mode === "MANUAL_TARGET" ? this.manualAllocations(profiles, request.manualTargets, config, allocatablePercent, totalCapitalUsd) : null;
    if (manual) return manual;

    const weighted = profiles.map((profile) => {
      const performance = profile.metrics.botScore / 100;
      const consistency = profile.metrics.strategyConsistency / 100;
      const sharpe = clamp(0.5 + profile.metrics.sharpeRatio * 0.1, 0.2, 1.8);
      const drawdownPenalty = clamp(1 - profile.metrics.maxDrawdown / 35, 0.25, 1);
      const weight =
        request.mode === "PERFORMANCE_WEIGHTED"
          ? performance * 0.45 + consistency * 0.22 + sharpe * 0.2 + drawdownPenalty * 0.13
          : riskMultiplier(profile.riskLevel) * drawdownPenalty * (0.55 + consistency * 0.45);
      return { profile, weight: Math.max(0.05, weight) };
    });
    const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
    return weighted.map(({ profile, weight }) => {
      const rawPercent = totalWeight > 0 ? weight / totalWeight * allocatablePercent : 0;
      return this.toAllocation(profile, this.capPercent(profile, rawPercent, config), weight, totalCapitalUsd, false, [
        `mode=${config.mode}`,
        `risk=${profile.riskLevel}`,
        `botScore=${profile.metrics.botScore}`,
      ]);
    });
  }

  private manualAllocations(profiles: TradingBotProfile[], targets: NonNullable<CapitalAllocationRequest["manualTargets"]>, config: CapitalAllocationConfig, allocatablePercent: number, totalCapitalUsd: number) {
    const byId = new Map(profiles.map((profile) => [profile.botId, profile]));
    return targets
      .map((target) => {
        const profile = byId.get(target.botId);
        if (!profile) return null;
        const percent = Math.min(target.targetPercent, allocatablePercent, this.capPercent(profile, target.targetPercent, config));
        return this.toAllocation(profile, percent, percent, totalCapitalUsd, false, ["manual target allocation"]);
      })
      .filter((item): item is BotCapitalAllocation => Boolean(item));
  }

  private buildHedgeAllocation(profile: TradingBotProfile, totalCapitalUsd: number, config: CapitalAllocationConfig): BotCapitalAllocation {
    return this.toAllocation(profile, config.hedgeAllocationPercent, 1, totalCapitalUsd, true, ["hedge allocation protects against single bot risk"]);
  }

  private toAllocation(profile: TradingBotProfile, percent: number, weight: number, totalCapitalUsd: number, hedge: boolean, reasons: string[]): BotCapitalAllocation {
    return {
      botId: profile.botId,
      botName: profile.name,
      strategyType: profile.strategyType,
      riskLevel: profile.riskLevel,
      allocationPercent: round(percent),
      allocationUsd: round(totalCapitalUsd * percent / 100),
      weight: round(weight, 4),
      maxExposureUsd: round(totalCapitalUsd * percent / 100),
      hedge,
      reasons,
    };
  }

  private capPercent(profile: TradingBotProfile, percent: number, config: CapitalAllocationConfig) {
    const cap = profile.riskLevel === "HIGH" ? config.maxRiskyBotAllocationPercent : config.maxBotAllocationPercent;
    return Math.max(config.minBotAllocationPercent, Math.min(percent, cap));
  }

  private exposureChecks(allocations: BotCapitalAllocation[], positions: NonNullable<CapitalAllocationRequest["positions"]>, totalCapitalUsd: number, config: CapitalAllocationConfig): CapitalAllocationExposureCheck[] {
    return allocations.map((allocation) => {
      const currentExposureUsd = positions
        .filter((position) => position.botId === allocation.botId)
        .reduce((sum, position) => sum + Math.abs(position.quantity * position.currentPrice), 0);
      const exposurePercentOfCapital = totalCapitalUsd > 0 ? currentExposureUsd / totalCapitalUsd * 100 : 0;
      const status = exposurePercentOfCapital > config.maxTotalExposurePercent ? "BLOCK" : currentExposureUsd > allocation.maxExposureUsd * (1 + config.rebalanceThresholdPercent / 100) ? "REDUCE" : "OK";
      return {
        botId: allocation.botId,
        currentExposureUsd: round(currentExposureUsd),
        targetExposureUsd: allocation.maxExposureUsd,
        exposurePercentOfCapital: round(exposurePercentOfCapital),
        status,
        reason: status === "OK" ? "Exposure within allocation" : status === "REDUCE" ? "Exposure above target allocation" : "Exposure above max total limit",
      };
    });
  }

  private syntheticHedgeProfile(): TradingBotProfile {
    return {
      botId: "hedge-bot",
      name: "Hedge Bot",
      description: "Portfolio hedge allocation bucket",
      riskLevel: "LOW",
      supportedPairs: ["BTCUSDT", "ETHUSDT"],
      strategyType: "AI_ASSISTED",
      recommendedLeverage: 1,
      tradeFrequency: "LOW",
      aiConfidence: 70,
      tags: ["hedge", "portfolio"],
      ratingAverage: 0,
      ratingCount: 0,
      metrics: {
        botId: "hedge-bot",
        tradeCount: 0,
        wins: 0,
        losses: 0,
        winrate: 0,
        averagePnl: 0,
        totalPnl: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
        expectancy: 0,
        profitFactor: 0,
        avgTradeDurationMs: 0,
        strategyConsistency: 50,
        botScore: 55,
        adaptiveWeight: 1,
        poorPerformance: false,
        flags: [],
        updatedAt: new Date().toISOString(),
      },
      monthlyPnl: 0,
      maxDrawdown: 0,
      performanceCurve: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}

const globalAllocator = globalThis as typeof globalThis & { __capitalAllocationEngine?: CapitalAllocationEngine };
export const capitalAllocationEngine = globalAllocator.__capitalAllocationEngine ?? new CapitalAllocationEngine();
globalAllocator.__capitalAllocationEngine = capitalAllocationEngine;
