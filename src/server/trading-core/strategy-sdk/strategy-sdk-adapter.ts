import { randomUUID } from "node:crypto";
import { tradingConfig } from "@/src/server/trading-core/config";
import type { ExecutionIntent, MarketSnapshot, StrategySignal, TradeSide } from "@/src/server/trading-core/core/types";
import { buildIndicatorSnapshot } from "@/src/server/trading-core/indicators";
import { clamp } from "@/src/server/trading-core/indicators/math";
import type { SignalStrategy } from "@/src/server/trading-core/strategies/strategy";
import type { StrategySdkContext, StrategyTradeResult, TradingStrategySdk } from "@/src/server/trading-core/strategy-sdk/strategy-sdk.types";

function normalizeSide(side: TradeSide, score: number, minScore: number): TradeSide {
  if (side === "HOLD") return "HOLD";
  return score >= minScore ? side : "HOLD";
}

export class StrategySdkAdapter implements SignalStrategy {
  readonly name: string;

  constructor(private readonly strategy: TradingStrategySdk) {
    this.name = strategy.meta.name;
  }

  get enabled() {
    return (this.strategy.meta.enabled ?? true) && tradingConfig.getStrategy(this.name).enabled;
  }

  async evaluate(snapshot: MarketSnapshot): Promise<StrategySignal> {
    const context = this.createContext(snapshot);
    const raw = await this.strategy.generateSignal(context);
    const score = clamp(raw.score, 0, 100);
    const signal: StrategySignal = {
      strategy: this.name,
      symbol: snapshot.symbol,
      side: normalizeSide(raw.side, score, context.config.minScore),
      score,
      confidence: clamp(raw.confidence, 0, 100),
      reasons: raw.reasons.length > 0 ? raw.reasons : [`${this.name}: no reason provided`],
      indicators: raw.indicators ?? context.indicators,
      generatedAt: new Date().toISOString(),
    };

    if (!this.strategy.validateRisk || signal.side === "HOLD") return signal;
    const risk = await this.strategy.validateRisk({ signal, context });
    if (risk.allowed) return signal;
    return {
      ...signal,
      side: "HOLD",
      reasons: [...signal.reasons, ...risk.reasons.map((reason) => `strategy-risk: ${reason}`)],
    };
  }

  async executeTrade(signal: StrategySignal, snapshot: MarketSnapshot): Promise<StrategyTradeResult> {
    const context = this.createContext(snapshot);
    if (this.strategy.executeTrade) return this.strategy.executeTrade({ signal, context });
    if (signal.side === "HOLD") return { reasons: ["Signal is HOLD"] };
    return {
      intent: this.createDefaultIntent(signal),
      reasons: ["Default SDK dry-run intent created"],
    };
  }

  private createContext(snapshot: MarketSnapshot): StrategySdkContext {
    return {
      snapshot,
      indicators: buildIndicatorSnapshot(snapshot.candles),
      now: new Date(),
      config: {
        minScore: tradingConfig.getStrategy(this.name).minScore ?? this.strategy.meta.minScore ?? 60,
      },
    };
  }

  private createDefaultIntent(signal: StrategySignal): ExecutionIntent | undefined {
    if (signal.side === "HOLD") return undefined;
    const traceId = randomUUID();
    return {
      candidateId: `${signal.symbol}:${traceId}`,
      executionIntentId: traceId,
      symbol: signal.symbol,
      side: signal.side,
      score: signal.score,
      confidence: signal.confidence,
      dryRun: true,
      idempotencyKey: `${this.name}:${signal.symbol}:${signal.side}:${randomUUID()}`,
      metadata: {
        strategy: this.name,
        sdkVersion: this.strategy.meta.version,
        riskProfile: this.strategy.meta.riskProfile ?? "MID",
      },
    };
  }
}
