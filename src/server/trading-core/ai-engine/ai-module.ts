import type { ModuleHealth, TradingModule, SignalDecision } from "@/src/server/trading-core/core/types";
import { tradingCoreFlags } from "@/src/server/trading-core/core/feature-flags";
import { tradingConfig } from "@/src/server/trading-core/config";
import { MarketAnalysisClient } from "@/src/server/trading-core/ai-engine/market-analysis-client";

export class OptionalAiEngine implements TradingModule {
  readonly name = "optional-ai-engine";
  get enabled() {
    return tradingCoreFlags.enabled && tradingCoreFlags.aiEngineEnabled;
  }
  private readonly marketAnalysis = new MarketAnalysisClient();

  async enrich(decision: SignalDecision): Promise<SignalDecision> {
    if (!this.enabled) return decision;
    return this.marketAnalysis.filterSignal(decision);
  }

  async health(): Promise<ModuleHealth> {
    return {
      name: this.name,
      enabled: this.enabled,
      status: this.enabled ? "healthy" : "disabled",
      details: {
        mode: "market-analysis-microservice",
        serviceUrl: tradingConfig.getGlobal("aiServiceUrl"),
        confidenceThreshold: tradingConfig.getGlobal("aiConfidenceThreshold"),
      },
      checkedAt: new Date().toISOString(),
    };
  }
}
