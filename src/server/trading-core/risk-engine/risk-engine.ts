import { tradingCoreFlags } from "@/src/server/trading-core/core/feature-flags";
import { tradingConfig } from "@/src/server/trading-core/config";
import type { ExecutionIntent, RiskVerdict, SignalDecision } from "@/src/server/trading-core/core/types";
import { TradingCoreEventBus } from "@/src/server/trading-core/core/event-bus";
import { TokenBucketRateLimiter } from "@/src/server/trading-core/utils/rate-limiter";
import { CircuitBreaker } from "@/src/server/trading-core/utils/circuit-breaker";
import { tradingDomainLogger } from "@/src/server/trading-core/observability/domain-logger";
import { tradingFailsafeGuard } from "@/src/server/trading-core/protection/failsafe-guard";
import { CooldownManager } from "@/src/server/trading-core/risk-engine/cooldown-manager";
import { CorrelationGuard } from "@/src/server/trading-core/risk-engine/correlation-guard";
import { getRiskEngineConfig, type RiskEngineConfig } from "@/src/server/trading-core/risk-engine/risk-config";
import { PositionSizer } from "@/src/server/trading-core/risk-engine/position-sizing";
import { RiskScorer } from "@/src/server/trading-core/risk-engine/risk-scorer";
import type { RiskDecision, RiskLevel, RiskTradeInput } from "@/src/server/trading-core/risk-engine/risk-types";

export class RiskEngine {
  private readonly seenOrders = new Map<string, number>();
  private readonly limiter = new TokenBucketRateLimiter(10, 5);
  private readonly scorer = new RiskScorer();
  private readonly cooldowns = new CooldownManager();
  private readonly correlation = new CorrelationGuard();
  private readonly breaker = new CircuitBreaker(3, 60_000);
  private dailyLossPercent = 0;
  private openSymbols: string[] = [];

  constructor(
    private readonly events: TradingCoreEventBus,
    private readonly config?: RiskEngineConfig,
  ) {}

  evaluateSignal(signal: SignalDecision): RiskVerdict {
    if (!tradingCoreFlags.riskEngineEnabled) {
      return { allowed: true, level: "LOW", reasons: ["Risk engine disabled by feature flag"] };
    }
    if (signal.side === "HOLD") {
      return { allowed: false, level: "BLOCKED", reasons: ["Signal decision is HOLD"], score: 100 };
    }

    const decision = this.evaluateTrade(this.buildInputFromSignal(signal));
    const verdict = this.toVerdict(decision);
    if (!verdict.allowed) {
      tradingDomainLogger.riskReject({
        symbol: signal.symbol,
        level: verdict.level,
        score: verdict.score,
        reasons: verdict.reasons,
      });
    }
    this.events.emit("risk.evaluated", { symbol: signal.symbol, allowed: verdict.allowed, level: verdict.level });
    return verdict;
  }

  evaluateTrade(input: RiskTradeInput): RiskDecision {
    const cooldownKey = `${input.symbol}:${input.side}`;
    const config = this.currentConfig();
    const denyReasons: string[] = [];
    const activeCooldown = this.cooldowns.getActive(cooldownKey);
    const correlatedSymbols = this.correlation.correlatedSymbols(input.symbol, this.openSymbols);
    const scoredInput = { ...input, correlatedSymbols };
    const { score, breakdown } = this.scorer.calculate(scoredInput);
    const level = this.resolveLevel(score, denyReasons);

    if (activeCooldown) denyReasons.push(`Cooldown active until ${new Date(activeCooldown).toISOString()}`);
    if (tradingCoreFlags.emergencyStop) denyReasons.push("Emergency stop is active");
    if (this.dailyLossPercent >= config.maxDailyLossPercent) {
      denyReasons.push(`Max daily loss reached: ${this.dailyLossPercent}%`);
    }
    if (input.openPositions >= config.maxOpenPositions) denyReasons.push("Max open position limit reached");
    if (input.consecutiveLosses >= config.maxConsecutiveLosses) denyReasons.push("Consecutive loss limit reached");
    if (input.winratePercent < config.minWinratePercent) denyReasons.push("Winrate below minimum threshold");
    if (input.liquidationDistancePercent < config.minLiquidationDistancePercent) denyReasons.push("Liquidation distance is too close");
    if (correlatedSymbols.length > config.maxCorrelationGroupPositions) {
      denyReasons.push(`Correlated trade limit exceeded: ${correlatedSymbols.join(", ")}`);
    }

    const allowed = denyReasons.length === 0 && level !== "BLOCKED";
    const finalLevel: RiskLevel = allowed ? level : "BLOCKED";
    if (!allowed) this.cooldowns.set(cooldownKey, config.cooldownMsAfterDeny);

    return {
      allowed,
      level: finalLevel,
      score,
      adjustedNotional: new PositionSizer(config).calculate(scoredInput, finalLevel),
      denyReasons: allowed ? ["Risk checks passed"] : denyReasons,
      cooldownUntil: this.cooldowns.getActive(cooldownKey)
        ? new Date(this.cooldowns.getActive(cooldownKey) as number).toISOString()
        : undefined,
      breakdown,
    };
  }

  async evaluateIntent(intent: ExecutionIntent): Promise<RiskVerdict> {
    const reasons: string[] = [];
    const failsafe = tradingFailsafeGuard.evaluateOrder({
      symbol: intent.symbol,
      side: intent.side,
      idempotencyKey: intent.idempotencyKey,
      reduceOnly: Boolean(intent.metadata?.reduceOnly),
      currentPrice: Number(intent.metadata?.currentPrice ?? intent.metadata?.entryPrice ?? 0) || undefined,
      entryPrice: Number(intent.metadata?.entryPrice ?? 0) || undefined,
      liquidationPrice: Number(intent.metadata?.liquidationPrice ?? 0) || undefined,
      volatilityPercent: Number(intent.metadata?.volatilityPercent ?? 0) || undefined,
    });
    if (!failsafe.allowed) reasons.push(...failsafe.reasons);
    const duplicateUntil = this.seenOrders.get(intent.idempotencyKey) ?? 0;
    if (duplicateUntil > Date.now()) reasons.push("Duplicate order protection blocked request");
    if (!this.limiter.tryRemove()) reasons.push("Rate limit protection blocked request");
    if (tradingCoreFlags.emergencyStop) reasons.push("Emergency stop is active");

    const allowed = reasons.length === 0;
    if (allowed) this.seenOrders.set(intent.idempotencyKey, Date.now() + 60_000);
    this.cleanupSeenOrders();

    return this.breaker.execute(async (): Promise<RiskVerdict> => ({
      allowed,
      level: allowed ? "LOW" : "BLOCKED",
      reasons: allowed ? ["Execution risk checks passed"] : reasons,
    })).catch((error) => ({
      allowed: false,
      level: "BLOCKED",
      reasons: [`Circuit breaker blocked execution: ${(error as Error).message}`],
    }));
  }

  setDailyLossPercent(value: number) {
    this.dailyLossPercent = Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  setOpenSymbols(symbols: string[]) {
    this.openSymbols = symbols.map((symbol) => symbol.toUpperCase());
  }

  private buildInputFromSignal(signal: SignalDecision): RiskTradeInput {
    const volumeSpike = signal.strategySignals
      .map((item) => item.indicators.volumeSpike?.ratio ?? 0)
      .reduce((max, value) => Math.max(max, value), 0);
    const macdRisk = signal.strategySignals.some((item) => {
      const histogram = item.indicators.macd?.histogram ?? 0;
      return (signal.side === "BUY" && histogram < 0) || (signal.side === "SELL" && histogram > 0);
    });

    return {
      symbol: signal.symbol,
      side: signal.side === "SELL" ? "SELL" : "BUY",
      volatilityPercent: Number(signal.strategySignals[0]?.indicators.volumeSpike?.ratio ?? volumeSpike),
      leverage: tradingConfig.getGlobal("leverage"),
      spreadPercent: Number(signal.strategySignals[0]?.indicators.volumeSpike?.isSpike ? 0.12 : 0.25),
      drawdownPercent: this.dailyLossPercent,
      openPositions: this.openSymbols.length,
      winratePercent: Number(signal.confidence > 0 ? Math.max(35, Math.min(75, signal.confidence)) : 50),
      consecutiveLosses: macdRisk ? 1 : 0,
      fundingRatePercent: 0,
      liquidationDistancePercent: 100,
      accountEquity: 10_000,
      requestedNotional: Math.max(10, signal.score * 2),
    };
  }

  private resolveLevel(score: number, denyReasons: string[]): RiskLevel {
    const config = this.currentConfig();
    if (score >= config.maxRiskScore) {
      denyReasons.push(`Risk score too high: ${score}`);
      return "BLOCKED";
    }
    if (score >= config.highRiskScore) return "HIGH";
    if (score >= config.midRiskScore) return "MID";
    return "LOW";
  }

  private toVerdict(decision: RiskDecision): RiskVerdict {
    return {
      allowed: decision.allowed,
      level: decision.level,
      reasons: decision.denyReasons,
      score: decision.score,
      adjustedNotional: decision.adjustedNotional,
      maxNotional: decision.adjustedNotional,
      cooldownUntil: decision.cooldownUntil,
      breakdown: decision.breakdown,
    };
  }

  private currentConfig() {
    return this.config ?? getRiskEngineConfig();
  }

  private cleanupSeenOrders() {
    const now = Date.now();
    for (const [key, expiresAt] of this.seenOrders.entries()) {
      if (expiresAt <= now) this.seenOrders.delete(key);
    }
  }
}
