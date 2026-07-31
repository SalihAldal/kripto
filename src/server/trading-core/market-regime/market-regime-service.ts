import type { MarketSnapshot, ModuleHealth, SignalDecision, TradingModule } from "@/src/server/trading-core/core/types";
import { tradingCoreFlags } from "@/src/server/trading-core/core/feature-flags";
import { MarketRegimeDetector } from "@/src/server/trading-core/market-regime/market-regime-detector";
import type { MarketRegimeDecision } from "@/src/server/trading-core/market-regime/market-regime.types";
import { StrategyRegimePolicy } from "@/src/server/trading-core/market-regime/strategy-regime-policy";
import { TtlCache } from "@/src/server/trading-core/utils/cache";

export class MarketRegimeService implements TradingModule {
  readonly name = "market-regime-service";
  get enabled() {
    return tradingCoreFlags.enabled;
  }
  private readonly detector = new MarketRegimeDetector();
  private readonly policy = new StrategyRegimePolicy();
  private readonly cache = new TtlCache<MarketRegimeDecision>(500);
  private lastDecision: MarketRegimeDecision | null = null;

  analyze(snapshot: MarketSnapshot) {
    const cached = this.cache.get(snapshot.symbol);
    if (cached) return cached;
    const decision = this.detector.detect(snapshot);
    this.cache.set(snapshot.symbol, decision, 5_000);
    this.lastDecision = decision;
    return decision;
  }

  filterSignal(snapshot: MarketSnapshot, signal: SignalDecision): SignalDecision {
    const regime = this.analyze(snapshot);
    const allowedSignals = signal.strategySignals.filter((strategySignal) =>
      this.policy.isAllowed(strategySignal.strategy, regime.regime),
    );
    const recommended = this.policy.recommendedStrategies(regime);
    const reasons = [
      ...signal.reasons,
      ...regime.reasons.map((reason) => `market-regime: ${reason}`),
      `market-regime: recommendedStrategies=${recommended.join(",") || "none"}`,
    ];

    if (!regime.tradeAllowed) {
      return {
        ...signal,
        side: "HOLD",
        marketRegime: regime,
        reasons: [...reasons, `Trade blocked by market regime: ${regime.regime}`],
      };
    }

    if (signal.side !== "HOLD" && allowedSignals.length === 0) {
      return {
        ...signal,
        side: "HOLD",
        marketRegime: regime,
        reasons: [...reasons, `Strategy not allowed in current market regime: ${regime.regime}`],
      };
    }

    return {
      ...signal,
      strategySignals: allowedSignals.length > 0 ? allowedSignals : signal.strategySignals,
      marketRegime: regime,
      reasons,
    };
  }

  async health(): Promise<ModuleHealth> {
    return {
      name: this.name,
      enabled: this.enabled,
      status: this.enabled ? "healthy" : "disabled",
      details: {
        lastDecision: this.lastDecision,
        cache: this.cache.stats(),
      },
      checkedAt: new Date().toISOString(),
    };
  }
}
