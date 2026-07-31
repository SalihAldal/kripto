import { tradingCoreFlags, tradingFeatureFlags } from "@/src/server/trading-core/core/feature-flags";
import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";
import { tradingFailsafeState, type FailsafeStateStore } from "@/src/server/trading-core/protection/failsafe-state";
import type { ManagedPosition } from "@/src/server/trading-core/executors/position-types";
import type { ProtectionDecision, ProtectionIntent, ProtectionViolation } from "@/src/server/trading-core/protection/protection-types";
import { CircuitBreaker } from "@/src/server/trading-core/utils/circuit-breaker";
import { TokenBucketRateLimiter } from "@/src/server/trading-core/utils/rate-limiter";

const duplicateTtlMs = 60_000;
const stuckPositionMs = 15 * 60_000;

export class FailsafeGuard {
  private readonly duplicateOrders = new Map<string, number>();
  private readonly lastPrices = new Map<string, { price: number; at: number }>();
  private readonly apiLimiter = new TokenBucketRateLimiter(20, 10);
  private readonly breaker = new CircuitBreaker(3, 60_000);

  constructor(private readonly state: FailsafeStateStore = tradingFailsafeState) {}

  evaluateOrder(intent: ProtectionIntent): ProtectionDecision {
    const violations: ProtectionViolation[] = [];
    const now = Date.now();
    const duplicateUntil = this.duplicateOrders.get(intent.idempotencyKey) ?? 0;

    if (tradingCoreFlags.emergencyStop) {
      violations.push(this.violate("CIRCUIT_BREAKER", "EMERGENCY", "Emergency stop is active", intent.symbol));
    }
    if (tradingCoreFlags.closeOnlyMode && !intent.reduceOnly) {
      violations.push(this.violate("CLOSE_ONLY", "BLOCKED", "Close-only mode blocks new entries", intent.symbol));
    }
    if (duplicateUntil > now) {
      violations.push(this.violate("DUPLICATE_ORDER", "BLOCKED", "Duplicate order protection blocked request", intent.symbol));
    }
    if (!this.apiLimiter.tryRemove()) {
      violations.push(this.violate("API_SPAM", "BLOCKED", "API spam protection blocked request", intent.symbol));
    }
    const liquidationDistance = this.liquidationDistancePercent(intent);
    if (liquidationDistance !== null && liquidationDistance < tradingCoreFlags.minLiquidationDistancePercent) {
      violations.push(
        this.violate(
          "LIQUIDATION_RISK",
          "BLOCKED",
          `Liquidation distance too close: ${liquidationDistance}%`,
          intent.symbol,
          liquidationDistance,
          tradingCoreFlags.minLiquidationDistancePercent,
        ),
      );
    }
    if ((intent.volatilityPercent ?? 0) > tradingCoreFlags.maxVolatilityPercent) {
      violations.push(
        this.violate(
          "ABNORMAL_VOLATILITY",
          "BLOCKED",
          `Abnormal volatility detected: ${intent.volatilityPercent}%`,
          intent.symbol,
          intent.volatilityPercent,
          tradingCoreFlags.maxVolatilityPercent,
        ),
      );
    }

    if (violations.length === 0) this.duplicateOrders.set(intent.idempotencyKey, now + duplicateTtlMs);
    this.cleanupDuplicates();
    return this.decision(violations);
  }

  evaluateAccount(input: { currentEquity: number; dailyStartEquity?: number }) {
    const snapshot = this.state.updateEquity(input.currentEquity, input.dailyStartEquity);
    const violations: ProtectionViolation[] = [];
    if (snapshot.dailyLossPercent >= tradingCoreFlags.maxDailyLossPercent) {
      violations.push(
        this.violate(
          "MAX_DAILY_LOSS",
          "EMERGENCY",
          `Max daily loss reached: ${snapshot.dailyLossPercent}%`,
          undefined,
          snapshot.dailyLossPercent,
          tradingCoreFlags.maxDailyLossPercent,
        ),
      );
    }
    if (snapshot.maxDrawdownPercent >= tradingCoreFlags.maxDrawdownPercent) {
      violations.push(
        this.violate(
          "MAX_DRAWDOWN",
          "EMERGENCY",
          `Max drawdown reached: ${snapshot.maxDrawdownPercent}%`,
          undefined,
          snapshot.maxDrawdownPercent,
          tradingCoreFlags.maxDrawdownPercent,
        ),
      );
    }
    if (violations.some((item) => item.level === "EMERGENCY")) this.activateEmergency("account protection threshold");
    return this.decision(violations);
  }

  inspectPositions(positions: ManagedPosition[]) {
    const now = Date.now();
    const violations = positions.flatMap((position) => {
      const updatedAt = Date.parse(position.updatedAt || position.openedAt);
      if (Number.isFinite(updatedAt) && now - updatedAt > stuckPositionMs) {
        return [
          this.violate(
            "STUCK_POSITION",
            "WARN",
            `Position has not updated for ${Math.round((now - updatedAt) / 1000)} seconds`,
            position.symbol,
          ),
        ];
      }
      return [];
    });
    return this.decision(violations);
  }

  recordMarketTick(symbol: string, price: number) {
    const normalized = symbol.toUpperCase();
    const previous = this.lastPrices.get(normalized);
    this.lastPrices.set(normalized, { price, at: Date.now() });
    if (!previous || previous.price <= 0 || !Number.isFinite(price) || price <= 0) return this.decision([]);
    const volatilityPercent = Number((Math.abs(price - previous.price) / previous.price * 100).toFixed(4));
    if (volatilityPercent <= tradingCoreFlags.maxVolatilityPercent) return this.decision([]);
    return this.decision([
      this.violate(
        "ABNORMAL_VOLATILITY",
        "BLOCKED",
        `Abnormal tick volatility detected: ${volatilityPercent}%`,
        normalized,
        volatilityPercent,
        tradingCoreFlags.maxVolatilityPercent,
      ),
    ]);
  }

  recordWebSocketDisconnect(source: string, symbols?: string[]) {
    return this.violate("WEBSOCKET_DISCONNECT", "WARN", `${source} disconnected`, symbols?.[0]);
  }

  async withCircuit<T>(operation: () => Promise<T>) {
    return this.breaker.execute(operation).catch((error) => {
      this.violate("CIRCUIT_BREAKER", "EMERGENCY", (error as Error).message);
      this.activateEmergency("circuit breaker opened");
      throw error;
    });
  }

  activateEmergency(reason: string) {
    this.state.setEmergencyStop(true);
    this.state.setCloseOnly(true);
    tradingFeatureFlags.emergencyDisable();
    tradingLogger.critical({
      category: "SYSTEM",
      source: "trading-core.failsafe",
      message: "Failsafe emergency stop activated",
      status: "FAILED",
      errorCode: "FAILSAFE_EMERGENCY",
      errorDetail: reason,
      context: { state: this.state.snapshot() },
    });
  }

  setCloseOnly(enabled: boolean) {
    this.state.setCloseOnly(enabled);
    tradingFeatureFlags.setCoreValue("closeOnlyMode", enabled);
  }

  status() {
    return {
      state: this.state.snapshot(),
      circuitBreaker: this.breaker.snapshot,
    };
  }

  private violate(
    type: ProtectionViolation["type"],
    level: ProtectionViolation["level"],
    message: string,
    symbol?: string,
    value?: number,
    threshold?: number,
  ) {
    const violation = this.state.addViolation({ type, level, message, symbol, value, threshold });
    tradingLogger.log({
      level: level === "EMERGENCY" ? "CRITICAL" : level === "BLOCKED" ? "ERROR" : "WARN",
      category: "RISK",
      source: "trading-core.failsafe",
      message,
      status: level === "OK" ? "SUCCESS" : "FAILED",
      symbol,
      errorCode: type,
      context: { value, threshold },
    });
    return violation;
  }

  private decision(violations: ProtectionViolation[]): ProtectionDecision {
    const level = violations.some((item) => item.level === "EMERGENCY")
      ? "EMERGENCY"
      : violations.some((item) => item.level === "BLOCKED")
        ? "BLOCKED"
        : violations.some((item) => item.level === "WARN")
          ? "WARN"
          : "OK";
    return {
      allowed: level === "OK" || level === "WARN",
      level,
      closeOnlyMode: tradingCoreFlags.closeOnlyMode,
      reasons: violations.length ? violations.map((item) => item.message) : ["Failsafe checks passed"],
      violations,
    };
  }

  private liquidationDistancePercent(intent: ProtectionIntent) {
    if (!intent.currentPrice || !intent.liquidationPrice || intent.currentPrice <= 0) return null;
    return Number((Math.abs(intent.currentPrice - intent.liquidationPrice) / intent.currentPrice * 100).toFixed(4));
  }

  private cleanupDuplicates() {
    const now = Date.now();
    for (const [key, expiresAt] of this.duplicateOrders.entries()) {
      if (expiresAt <= now) this.duplicateOrders.delete(key);
    }
  }
}

const globalGuard = globalThis as typeof globalThis & { __tradingFailsafeGuard?: FailsafeGuard };
export const tradingFailsafeGuard = globalGuard.__tradingFailsafeGuard ?? new FailsafeGuard();
globalGuard.__tradingFailsafeGuard = tradingFailsafeGuard;
