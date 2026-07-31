import { tradingCoreFlags } from "@/src/server/trading-core/core/feature-flags";
import { tradingConfig } from "@/src/server/trading-core/config";
import type { ExecutionResult, MarketSnapshot, ModuleHealth, SignalDecision, TradingModule } from "@/src/server/trading-core/core/types";
import { HealthRegistry } from "@/src/server/trading-core/core/health-registry";
import { ModuleManager } from "@/src/server/trading-core/core/module-manager";
import { SignalStore } from "@/src/server/trading-core/database/signal-store";
import { OptionalAiEngine } from "@/src/server/trading-core/ai-engine/ai-module";
import { BotOrchestrator } from "@/src/server/trading-core/bots/bot-orchestrator";
import { ExchangeExecutor } from "@/src/server/trading-core/executors/exchange-executor";
import { PositionManager } from "@/src/server/trading-core/executors/position-manager";
import { MarketRegimeService } from "@/src/server/trading-core/market-regime/market-regime-service";
import { RiskEngine } from "@/src/server/trading-core/risk-engine/risk-engine";
import { SignalEngine } from "@/src/server/trading-core/signals/signal-engine";

export class TradingCoreService implements TradingModule {
  readonly name = "trading-core-service";
  get enabled() {
    return tradingCoreFlags.enabled;
  }

  constructor(
    private readonly signalEngine: SignalEngine,
    private readonly riskEngine: RiskEngine,
    private readonly aiEngine: OptionalAiEngine,
    private readonly executor: ExchangeExecutor,
    private readonly store: SignalStore,
    private readonly healthRegistry: HealthRegistry,
    private readonly moduleManager: ModuleManager,
    private readonly positions?: PositionManager,
    private readonly marketRegime?: MarketRegimeService,
    private readonly bots?: BotOrchestrator,
  ) {}

  async start() {
    if (!this.enabled) return;
    await this.moduleManager.startAll();
  }

  async stop() {
    await this.moduleManager.stopAll();
  }

  async analyze(snapshot: MarketSnapshot): Promise<{ signal: SignalDecision; execution: ExecutionResult | null }> {
    if (!tradingConfig.getGlobal("coinWhitelist").includes(snapshot.symbol.toUpperCase())) {
      const signal: SignalDecision = {
        symbol: snapshot.symbol,
        side: "HOLD",
        score: 0,
        confidence: 0,
        strategySignals: [],
        reasons: ["Symbol is not in trading coin whitelist"],
        generatedAt: new Date().toISOString(),
        output: "json",
      };
      return { signal, execution: null };
    }
    if (!tradingCoreFlags.signalEngineEnabled) {
      const signal: SignalDecision = {
        symbol: snapshot.symbol,
        side: "HOLD",
        score: 0,
        confidence: 0,
        strategySignals: [],
        reasons: ["Signal engine disabled by feature flag"],
        generatedAt: new Date().toISOString(),
        output: "json",
      };
      return { signal, execution: null };
    }

    const rawSignal = await this.aiEngine.enrich(await this.signalEngine.analyze(snapshot));
    const regimeSignal = this.marketRegime?.filterSignal(snapshot, rawSignal) ?? rawSignal;
    const signal = this.bots?.orchestrate(regimeSignal, this.positions?.snapshot() ?? []) ?? regimeSignal;
    this.riskEngine.setOpenSymbols(this.positions?.snapshot().map((position) => position.symbol) ?? []);
    const verdict = this.riskEngine.evaluateSignal(signal);
    const safeSignal = verdict.allowed
      ? { ...signal, risk: verdict }
      : { ...signal, side: "HOLD" as const, risk: verdict, reasons: [...signal.reasons, ...verdict.reasons] };
    this.store.save(safeSignal);
    const execution = safeSignal.side === "HOLD" ? null : await this.executor.execute(safeSignal);
    return { signal: safeSignal, execution };
  }

  async health(): Promise<ModuleHealth> {
    const modules = await this.healthRegistry.snapshot();
    const failed = modules.filter((module) => module.status === "failed").length;
    const degraded = modules.filter((module) => module.status === "degraded").length;
    return {
      name: this.name,
      enabled: this.enabled,
      status: !this.enabled ? "disabled" : failed > 0 ? "failed" : degraded > 0 ? "degraded" : "healthy",
      details: { modules },
      checkedAt: new Date().toISOString(),
    };
  }
}
