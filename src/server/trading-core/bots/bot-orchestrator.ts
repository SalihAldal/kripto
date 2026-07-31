import type { BotAllocation, BotPerformanceUpdate } from "@/src/server/trading-core/bots/bot-types";
import { BotPerformanceScorer } from "@/src/server/trading-core/bots/bot-performance-scorer";
import { botPerformanceTracker } from "@/src/server/trading-core/bots/bot-performance-tracker";
import { isSuccessfulNetExit } from "@/src/server/execution/profit-thresholds";
import { BotRegistry } from "@/src/server/trading-core/bots/bot-registry";
import { BotStateStore } from "@/src/server/trading-core/bots/bot-state-store";
import { StrategyAllocator } from "@/src/server/trading-core/bots/strategy-allocator";
import type { SignalDecision, ModuleHealth, TradingModule } from "@/src/server/trading-core/core/types";
import type { ManagedPosition } from "@/src/server/trading-core/executors/position-types";
import { tradingDomainLogger } from "@/src/server/trading-core/observability/domain-logger";

export class BotOrchestrator implements TradingModule {
  readonly name = "bot-orchestrator";
  readonly enabled = true;
  private readonly registry = new BotRegistry();
  private readonly states = new BotStateStore();
  private readonly scorer = new BotPerformanceScorer();
  private readonly allocator = new StrategyAllocator();
  private lastAllocation: BotAllocation | null = null;

  constructor() {
    for (const bot of this.registry.all()) this.states.ensure(bot);
  }

  orchestrate(signal: SignalDecision, positions: ManagedPosition[]): SignalDecision {
    this.syncOpenPositions(positions);
    if (signal.side === "HOLD") return signal;

    const regime = signal.marketRegime?.regime;
    const mode = signal.marketRegime?.strategyMode;
    const candidates = this.registry.enabled().flatMap((config) => {
      const state = this.states.ensure(config);
      const now = Date.now();
      const cooldownUntil = state.cooldownUntil ? Date.parse(state.cooldownUntil) : 0;
      const strategySignal = signal.strategySignals.find((item) => item.strategy === config.strategy);
      if (!strategySignal) return [];
      if (state.status !== "ACTIVE") return [];
      if (cooldownUntil > now) return [];
      if (strategySignal.score < config.minScore) return [];
      if (state.openSymbols.length >= config.maxOpenPositions) return [];
      if (regime && !config.allowedRegimes.includes(regime as never)) return [];
      if (mode && config.preferredModes.length > 0 && !config.preferredModes.includes(mode as never)) return [];
      return [{ config, state, strategySignal }];
    });

    const allocation = this.allocator.allocate({ signal, candidates });
    if (!allocation) {
      return {
        ...signal,
        side: "HOLD",
        botAllocation: null,
        reasons: [...signal.reasons, "No eligible bot allocation found"],
      };
    }

    this.lastAllocation = allocation;
    this.states.update(allocation.botId, { lastSignalAt: new Date().toISOString() });
    tradingDomainLogger.botActivation({
      botId: allocation.botId,
      status: "ALLOCATED",
      score: allocation.score,
      reason: allocation.reason,
    });
    return {
      ...signal,
      botAllocation: allocation,
      confidence: Math.min(100, Number((signal.confidence * allocation.weight).toFixed(2))),
      reasons: [...signal.reasons, `bot-orchestrator: ${allocation.reason}`],
    };
  }

  updatePerformance(update: BotPerformanceUpdate) {
    const state = this.states.get(update.botId);
    const config = this.registry.get(update.botId);
    if (!state || !config) return null;
    const won = update.closed && isSuccessfulNetExit(update.returnPercent);
    const lost = update.closed && !won;
    const metrics = update.closed
      ? botPerformanceTracker.record({
          botId: update.botId,
          symbol: update.symbol,
          strategy: update.strategy ?? config.strategy,
          realizedPnl: update.realizedPnl,
          returnPercent: update.returnPercent,
          openedAt: update.openedAt,
          closedAt: update.closedAt,
          durationMs: update.durationMs,
        })
      : botPerformanceTracker.metrics(update.botId);
    const next = this.states.update(update.botId, {
      trades: update.closed ? state.trades + 1 : state.trades,
      wins: won ? state.wins + 1 : state.wins,
      losses: lost ? state.losses + 1 : state.losses,
      consecutiveLosses: lost ? state.consecutiveLosses + 1 : won ? 0 : state.consecutiveLosses,
      realizedPnl: Number((state.realizedPnl + update.realizedPnl).toFixed(8)),
      unrealizedPnl: update.unrealizedPnl ?? state.unrealizedPnl,
      cooldownUntil: lost ? new Date(Date.now() + config.cooldownMsAfterLoss).toISOString() : state.cooldownUntil,
    });
    if (!next) return null;
    const score = this.scorer.score(next, metrics);
    const weight = this.scorer.weight({ ...next, score }, metrics);
    const disabledReason = this.scorer.shouldDisable({ ...next, score, weight }, metrics);
    if (disabledReason) {
      tradingDomainLogger.botActivation({
        botId: update.botId,
        status: "DISABLED",
        score,
        reason: disabledReason,
      });
    }
    return this.states.update(update.botId, {
      score,
      weight,
      status: disabledReason ? "DISABLED" : next.status,
      disabledReason: disabledReason ?? next.disabledReason,
    });
  }

  snapshot() {
    return this.states.all();
  }

  performanceSnapshot() {
    return this.registry.all().map((bot) => ({
      bot,
      state: this.states.get(bot.id),
      metrics: botPerformanceTracker.metrics(bot.id),
    }));
  }

  async health(): Promise<ModuleHealth> {
    return {
      name: this.name,
      enabled: this.enabled,
      status: "healthy",
      details: {
        bots: this.snapshot(),
        performance: this.performanceSnapshot(),
        lastAllocation: this.lastAllocation,
      },
      checkedAt: new Date().toISOString(),
    };
  }

  private syncOpenPositions(positions: ManagedPosition[]) {
    for (const bot of this.registry.all()) {
      const state = this.states.ensure(bot);
      const ownPositions = positions.filter((position) => position.botId === bot.id);
      const unrealizedPnl = ownPositions.reduce((sum, position) => sum + position.unrealizedPnl, 0);
      const metrics = botPerformanceTracker.metrics(bot.id);
      const score = this.scorer.score({ ...state, unrealizedPnl }, metrics);
      const weight = this.scorer.weight({ ...state, score, unrealizedPnl }, metrics);
      this.states.update(bot.id, {
        openSymbols: ownPositions.map((position) => position.symbol),
        unrealizedPnl: Number(unrealizedPnl.toFixed(8)),
        score,
        weight,
      });
    }
  }
}
