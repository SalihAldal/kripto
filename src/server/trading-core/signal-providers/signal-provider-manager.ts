import { randomUUID } from "node:crypto";
import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";
import { ProviderPerformanceStore, providerPerformanceStore } from "@/src/server/trading-core/signal-providers/provider-performance-store";
import { ProviderPriorityEngine } from "@/src/server/trading-core/signal-providers/provider-priority-engine";
import { SignalProviderRegistry, signalProviderRegistry } from "@/src/server/trading-core/signal-providers/signal-provider-registry";
import { SignalVerifier } from "@/src/server/trading-core/signal-providers/signal-verifier";
import type {
  ProviderConsensus,
  ProviderPerformanceSample,
  ProviderSignal,
  ProviderSignalInput,
  SignalProviderConfig,
  SignalProviderSnapshot,
} from "@/src/server/trading-core/signal-providers/signal-provider-types";

export class SignalProviderManager {
  private readonly verifier = new SignalVerifier();
  private readonly priority = new ProviderPriorityEngine();
  private readonly recentSignals: ProviderSignal[] = [];
  private readonly maxRecentSignals = 250;

  constructor(
    private readonly registry: SignalProviderRegistry = signalProviderRegistry,
    private readonly performance: ProviderPerformanceStore = providerPerformanceStore,
  ) {}

  submit(input: ProviderSignalInput): ProviderSignal {
    const provider = this.registry.get(input.providerId);
    if (!provider) throw new Error("Signal provider not found");
    const metrics = this.performance.metrics(provider);
    const verification = this.verifier.verify(input, provider, metrics, this.recentSignals);
    this.performance.recordVerification(provider.providerId, verification.status);
    const riskRating = verification.status === "REJECTED" ? "BLOCKED" : metrics.riskRating;
    const signal: ProviderSignal = {
      ...input,
      symbol: input.symbol.toUpperCase(),
      signalId: randomUUID(),
      providerType: provider.type,
      providerName: provider.name,
      providerScore: metrics.providerScore,
      priorityScore: 0,
      riskRating,
      verification,
      receivedAt: new Date().toISOString(),
    };
    signal.priorityScore = this.priority.priorityScore(signal);
    this.recentSignals.unshift(signal);
    if (this.recentSignals.length > this.maxRecentSignals) this.recentSignals.length = this.maxRecentSignals;
    tradingLogger.info({
      category: "SIGNAL",
      source: "trading-core.signal-providers",
      message: `Provider signal ${verification.status}: ${provider.name} ${signal.symbol} ${signal.side}`,
      status: verification.verified ? "SUCCESS" : verification.status === "SUSPICIOUS" ? "SKIPPED" : "FAILED",
      symbol: signal.symbol,
      metricName: "signal_provider.priority_score",
      metricValue: signal.priorityScore,
      context: { providerId: provider.providerId, verification },
    });
    return signal;
  }

  consensus(symbol: string): ProviderConsensus {
    return this.priority.consensus(symbol, this.recentSignals);
  }

  upsertProvider(input: Omit<SignalProviderConfig, "createdAt" | "updatedAt">) {
    return this.registry.upsert(input);
  }

  recordPerformance(sample: ProviderPerformanceSample) {
    const provider = this.registry.get(sample.providerId);
    if (!provider) throw new Error("Signal provider not found");
    this.performance.record(sample);
    return this.performance.metrics(provider);
  }

  snapshot(): SignalProviderSnapshot {
    const providers = this.registry.all();
    return {
      providers,
      performance: this.performance.snapshot(providers),
      recentSignals: this.recentSignals.slice(0, 50),
      updatedAt: new Date().toISOString(),
    };
  }
}

const globalManager = globalThis as typeof globalThis & { __signalProviderManager?: SignalProviderManager };
export const signalProviderManager = globalManager.__signalProviderManager ?? new SignalProviderManager();
globalManager.__signalProviderManager = signalProviderManager;
