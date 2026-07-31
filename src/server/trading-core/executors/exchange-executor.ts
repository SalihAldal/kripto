import { randomUUID } from "node:crypto";
import { tradingConfig } from "@/src/server/trading-core/config";
import { botBehaviorEngine } from "@/src/server/trading-core/bot-behavior";
import { tradingCoreFlags } from "@/src/server/trading-core/core/feature-flags";
import type { ExecutionIntent, ExecutionResult, SignalDecision } from "@/src/server/trading-core/core/types";
import { TradingCoreEventBus } from "@/src/server/trading-core/core/event-bus";
import { PositionManager } from "@/src/server/trading-core/executors/position-manager";
import { tradingDomainLogger } from "@/src/server/trading-core/observability/domain-logger";
import { RiskEngine } from "@/src/server/trading-core/risk-engine/risk-engine";
import { CircuitBreaker } from "@/src/server/trading-core/utils/circuit-breaker";

export class ExchangeExecutor {
  private readonly breaker = new CircuitBreaker(3, 30_000);

  constructor(
    private readonly risk: RiskEngine,
    private readonly positions: PositionManager,
    private readonly events: TradingCoreEventBus,
  ) {}

  async execute(signal: SignalDecision): Promise<ExecutionResult> {
    const startedAt = Date.now();
    if (!tradingCoreFlags.executorEnabled) {
      return {
        accepted: false,
        status: "SKIPPED",
        reasons: ["Executor disabled by feature flag"],
        createdAt: new Date().toISOString(),
      };
    }
    if (signal.side === "HOLD") {
      return {
        accepted: false,
        status: "SKIPPED",
        reasons: ["Signal is HOLD"],
        createdAt: new Date().toISOString(),
      };
    }

    const currentPrice = signal.strategySignals.at(-1)?.indicators.emaFast ?? 1;
    const volatilityPercent = signal.strategySignals.reduce((max, item) => Math.max(max, item.indicators.volumeSpike?.ratio ?? 0), 0);
    const behavior = botBehaviorEngine.decide({
      symbol: signal.symbol,
      side: signal.side,
      signal,
      botAllocation: signal.botAllocation,
      currentPrice,
      volatilityPercent,
    });
    if (!behavior.allowed) {
      return {
        accepted: false,
        status: "SKIPPED",
        reasons: [`Bot behavior blocked execution: ${behavior.reasons.join(", ")}`],
        createdAt: new Date().toISOString(),
      };
    }

    const intent: ExecutionIntent = {
      symbol: signal.symbol,
      side: signal.side,
      score: signal.score,
      confidence: signal.confidence,
      dryRun: true,
      idempotencyKey: `${signal.symbol}:${signal.side}:${randomUUID()}`,
      metadata: {
        generatedAt: signal.generatedAt,
        entryPrice: currentPrice,
        currentPrice,
        volatilityPercent,
        leverage: tradingConfig.getGlobal("leverage"),
        riskLevel: tradingConfig.getGlobal("riskLevel"),
        quantity: signal.risk?.adjustedNotional ? Math.max(signal.risk.adjustedNotional * behavior.positionSizeMultiplier, 1) : behavior.positionSizeMultiplier,
        takeProfitPrice: behavior.takeProfitPrice,
        stopLossPrice: behavior.stopLossPrice,
        behavior,
        botId: signal.botAllocation?.botId ?? "default",
        botAllocation: signal.botAllocation,
        risk: signal.risk,
      },
    };

    this.risk.setOpenSymbols(this.positions.snapshot().map((position) => position.symbol));
    const verdict = await this.risk.evaluateIntent(intent);
    if (!verdict.allowed) {
      this.events.emit("execution.rejected", { symbol: signal.symbol, reasons: verdict.reasons });
      tradingDomainLogger.tradeExecution({
        symbol: signal.symbol,
        side: signal.side,
        status: "REJECTED",
        latencyMs: Date.now() - startedAt,
        context: { reasons: verdict.reasons },
      });
      return {
        accepted: false,
        status: "REJECTED",
        intent,
        reasons: verdict.reasons,
        createdAt: new Date().toISOString(),
      };
    }

    return this.breaker.execute(async () => {
      const positionCheck = this.positions.open(intent);
      if (!positionCheck.allowed) {
        return {
          accepted: false,
          status: "REJECTED",
          intent,
          reasons: [positionCheck.reason ?? "Position rejected"],
          createdAt: new Date().toISOString(),
        };
      }
      this.events.emit("execution.requested", {
        symbol: intent.symbol,
        side: intent.side,
        idempotencyKey: intent.idempotencyKey,
      });
      tradingDomainLogger.tradeExecution({
        symbol: intent.symbol,
        side: intent.side,
        status: "SIMULATED",
        latencyMs: Date.now() - startedAt,
        context: { idempotencyKey: intent.idempotencyKey },
      });
      return {
        accepted: true,
        status: "SIMULATED",
        intent,
        reasons: ["Dry-run execution accepted"],
        createdAt: new Date().toISOString(),
      };
    });
  }
}
