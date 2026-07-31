import type { SignalProviderConfig, SignalProviderType } from "@/src/server/trading-core/signal-providers/signal-provider-types";

function now() {
  return new Date().toISOString();
}

const defaultProviders: Array<Omit<SignalProviderConfig, "createdAt" | "updatedAt">> = [
  {
    providerId: "internal-ai",
    name: "Internal AI Signals",
    type: "INTERNAL_AI",
    status: "ACTIVE",
    priority: 85,
    baseScore: 72,
    riskRating: "MEDIUM",
    minConfidence: 62,
    supportedPairs: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"],
    tags: ["ai", "internal", "filtered"],
  },
  {
    providerId: "tradingview-webhook",
    name: "TradingView Webhook",
    type: "TRADINGVIEW_WEBHOOK",
    status: "ACTIVE",
    priority: 75,
    baseScore: 64,
    riskRating: "MEDIUM",
    minConfidence: 58,
    supportedPairs: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
    tags: ["webhook", "indicator", "alert"],
  },
  {
    providerId: "manual-trader",
    name: "Manual Trader Desk",
    type: "MANUAL_TRADER",
    status: "ACTIVE",
    priority: 70,
    baseScore: 60,
    riskRating: "HIGH",
    minConfidence: 65,
    supportedPairs: ["BTCUSDT", "ETHUSDT"],
    tags: ["manual", "human", "desk"],
  },
  {
    providerId: "external-api",
    name: "External Signal API",
    type: "EXTERNAL_API",
    status: "PAUSED",
    priority: 55,
    baseScore: 52,
    riskRating: "HIGH",
    minConfidence: 70,
    supportedPairs: ["BTCUSDT", "ETHUSDT", "BNBUSDT"],
    tags: ["external", "api"],
  },
  {
    providerId: "ml-prediction-engine",
    name: "ML Prediction Engine",
    type: "ML_PREDICTION_ENGINE",
    status: "ACTIVE",
    priority: 88,
    baseScore: 76,
    riskRating: "LOW",
    minConfidence: 60,
    supportedPairs: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"],
    tags: ["ml", "prediction", "walk-forward"],
  },
];

export class SignalProviderRegistry {
  private readonly providers = new Map<string, SignalProviderConfig>();

  constructor() {
    for (const provider of defaultProviders) this.upsert(provider);
  }

  upsert(input: Omit<SignalProviderConfig, "createdAt" | "updatedAt">) {
    const current = this.providers.get(input.providerId);
    const provider: SignalProviderConfig = {
      ...input,
      supportedPairs: input.supportedPairs.map((pair) => pair.toUpperCase()),
      priority: Math.max(0, Math.min(100, input.priority)),
      baseScore: Math.max(0, Math.min(100, input.baseScore)),
      minConfidence: Math.max(0, Math.min(100, input.minConfidence)),
      createdAt: current?.createdAt ?? now(),
      updatedAt: now(),
    };
    this.providers.set(provider.providerId, provider);
    return provider;
  }

  setStatus(providerId: string, status: SignalProviderConfig["status"]) {
    const provider = this.require(providerId);
    return this.upsert({ ...provider, status });
  }

  get(providerId: string) {
    return this.providers.get(providerId) ?? null;
  }

  enabled(type?: SignalProviderType) {
    return this.all().filter((provider) => provider.status === "ACTIVE" && (!type || provider.type === type));
  }

  all() {
    return Array.from(this.providers.values()).sort((a, b) => b.priority - a.priority);
  }

  private require(providerId: string) {
    const provider = this.get(providerId);
    if (!provider) throw new Error("Signal provider not found");
    return provider;
  }
}

const globalRegistry = globalThis as typeof globalThis & { __signalProviderRegistry?: SignalProviderRegistry };
export const signalProviderRegistry = globalRegistry.__signalProviderRegistry ?? new SignalProviderRegistry();
globalRegistry.__signalProviderRegistry = signalProviderRegistry;
