import { logger } from "@/lib/logger";
import type { MarketSnapshot, SignalDecision, StrategySignal, TradeSide } from "@/src/server/trading-core/core/types";
import { TradingCoreEventBus } from "@/src/server/trading-core/core/event-bus";
import { tradingCoreFlags } from "@/src/server/trading-core/core/feature-flags";
import { clamp } from "@/src/server/trading-core/indicators/math";
import { tradingDomainLogger } from "@/src/server/trading-core/observability/domain-logger";
import { StrategyRegistry } from "@/src/server/trading-core/strategies/strategy-registry";
import { isolate } from "@/src/server/trading-core/utils/error-boundary";

export class SignalEngine {
  constructor(
    private readonly strategies: StrategyRegistry,
    private readonly events: TradingCoreEventBus,
  ) {}

  async analyze(snapshot: MarketSnapshot): Promise<SignalDecision> {
    const signals = (
      await Promise.all(
        this.strategies.enabled().map((strategy) =>
          isolate<StrategySignal | null>(
            strategy.name,
            () => strategy.evaluate(snapshot),
            null,
          ),
        ),
      )
    ).filter((signal): signal is StrategySignal => Boolean(signal));

    const decision = this.score(snapshot.symbol, signals);
    this.events.emit("signal.generated", {
      symbol: decision.symbol,
      side: decision.side,
      score: decision.score,
    });
    logger.debug({ symbol: decision.symbol, side: decision.side, score: decision.score }, "Trading core signal generated");
    tradingDomainLogger.signalCreated({
      symbol: decision.symbol,
      side: decision.side,
      score: decision.score,
      confidence: decision.confidence,
      context: { strategies: signals.map((signal) => signal.strategy) },
    });
    return decision;
  }

  private score(symbol: string, signals: StrategySignal[]): SignalDecision {
    if (signals.length === 0) {
      return {
        symbol,
        side: "HOLD",
        score: 0,
        confidence: 0,
        strategySignals: [],
        reasons: ["No enabled strategy produced a signal"],
        generatedAt: new Date().toISOString(),
        output: "json",
      };
    }

    const totals = signals.reduce(
      (acc, signal) => {
        acc[signal.side] += signal.score;
        return acc;
      },
      { BUY: 0, SELL: 0, HOLD: 0 } satisfies Record<TradeSide, number>,
    );
    const side = (Object.entries(totals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "HOLD") as TradeSide;
    const rawScore = totals[side] / Math.max(1, signals.filter((signal) => signal.side === side).length);
    const score = clamp(rawScore, 0, 100);
    const threshold = side === "BUY" ? tradingCoreFlags.minBuyScore : side === "SELL" ? tradingCoreFlags.minSellScore : 100;
    const finalSide = score >= threshold ? side : "HOLD";

    return {
      symbol,
      side: finalSide,
      score,
      confidence: clamp(signals.reduce((sum, signal) => sum + signal.confidence, 0) / signals.length, 0, 100),
      strategySignals: signals,
      reasons: signals.flatMap((signal) => signal.reasons.map((reason) => `${signal.strategy}: ${reason}`)),
      generatedAt: new Date().toISOString(),
      output: "json",
    };
  }
}
