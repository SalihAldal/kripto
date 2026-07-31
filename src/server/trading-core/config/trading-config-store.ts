import { tradingRuntimeConfigSchema } from "@/src/server/trading-core/config/trading-config.schema";
import type {
  BotRuntimeConfig,
  StrategyRuntimeConfig,
  TradingConfigRecord,
  TradingRuntimeConfig,
  UserTradingConfig,
} from "@/src/server/trading-core/config/trading-config.types";

function readNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function readString(name: string, fallback: string) {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

function readList(name: string, fallback: string[]) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  return value
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

const defaultConfig: TradingRuntimeConfig = tradingRuntimeConfigSchema.parse({
  leverage: readNumber("TRADING_CONFIG_LEVERAGE", 1),
  riskLevel: readString("TRADING_CONFIG_RISK_LEVEL", "MID"),
  maxDailyLossPercent: readNumber("TRADING_CONFIG_MAX_DAILY_LOSS_PERCENT", 5),
  maxDrawdownPercent: readNumber("TRADING_CONFIG_MAX_DRAWDOWN_PERCENT", 12),
  maxOpenPositions: readNumber("TRADING_CONFIG_MAX_OPEN_POSITIONS", 3),
  minLiquidationDistancePercent: readNumber("TRADING_CONFIG_MIN_LIQUIDATION_DISTANCE_PERCENT", 4),
  takeProfitPercent: readNumber("TRADING_CONFIG_TAKE_PROFIT_PERCENT", 1.2),
  stopLossPercent: readNumber("TRADING_CONFIG_STOP_LOSS_PERCENT", 0.8),
  trailingActivationPercent: readNumber("TRADING_CONFIG_TRAILING_ACTIVATION_PERCENT", 1.2),
  trailingDistancePercent: readNumber("TRADING_CONFIG_TRAILING_DISTANCE_PERCENT", 0.45),
  autoBreakevenActivationPercent: readNumber("TRADING_CONFIG_BREAKEVEN_ACTIVATION_PERCENT", 0.8),
  partialTakeProfitPercent: readNumber("TRADING_CONFIG_PARTIAL_TAKE_PROFIT_PERCENT", 0.8),
  partialTakeProfitQuantityPercent: readNumber("TRADING_CONFIG_PARTIAL_TAKE_PROFIT_QUANTITY_PERCENT", 35),
  aiConfidenceThreshold: readNumber("TRADING_CONFIG_AI_CONFIDENCE_THRESHOLD", 65),
  aiTimeoutMs: readNumber("MARKET_ANALYSIS_TIMEOUT_MS", 1200),
  aiServiceUrl: readString("MARKET_ANALYSIS_SERVICE_URL", "http://127.0.0.1:8010"),
  coinWhitelist: readList("TRADING_CONFIG_COIN_WHITELIST", readList("TRADING_CORE_SYMBOLS", ["BTCUSDT", "ETHUSDT"])),
  cooldownMsAfterDeny: readNumber("TRADING_CONFIG_COOLDOWN_MS_AFTER_DENY", 300_000),
  strategy: {
    "rsi-macd": { enabled: true, minScore: readNumber("TRADING_CONFIG_STRATEGY_RSI_MACD_MIN_SCORE", 58), params: {} },
    "volume-spike": { enabled: true, minScore: readNumber("TRADING_CONFIG_STRATEGY_VOLUME_SPIKE_MIN_SCORE", 60), params: {} },
    "example-scalping-sdk": { enabled: false, minScore: readNumber("TRADING_CONFIG_STRATEGY_EXAMPLE_SCALPING_MIN_SCORE", 62), params: {} },
  },
  bots: {
    "scalping-bot": { enabled: true, minScore: 58, maxOpenPositions: 2, cooldownMsAfterLoss: 180_000 },
    "trend-bot": { enabled: true, minScore: 66, maxOpenPositions: 2, cooldownMsAfterLoss: 300_000 },
    "breakout-volume-bot": { enabled: true, minScore: 64, maxOpenPositions: 1, cooldownMsAfterLoss: 420_000 },
  },
  users: {},
});

export class TradingConfigStore {
  private config: TradingRuntimeConfig = structuredClone(defaultConfig);
  private readonly updatedAt = new Map<string, string>();

  snapshot() {
    return structuredClone(this.config);
  }

  records(): TradingConfigRecord[] {
    return [
      ...Object.entries(this.config)
        .filter(([key]) => !["strategy", "bots", "users"].includes(key))
        .map(([key, value]) => this.record("global", key, value)),
      ...Object.entries(this.config.strategy).map(([key, value]) => this.record("strategy", key, value)),
      ...Object.entries(this.config.bots).map(([key, value]) => this.record("bot", key, value)),
      ...Object.entries(this.config.users).map(([key, value]) => this.record("user", key, value)),
    ];
  }

  getGlobal<K extends keyof TradingRuntimeConfig>(key: K): TradingRuntimeConfig[K] {
    return this.config[key];
  }

  getStrategy(name: string): StrategyRuntimeConfig {
    return this.config.strategy[this.normalize(name)] ?? { enabled: true, minScore: 60, params: {} };
  }

  getBot(id: string): BotRuntimeConfig | null {
    return this.config.bots[this.normalize(id)] ?? null;
  }

  getUser(userId?: string | null): UserTradingConfig {
    if (!userId) return {};
    return this.config.users[userId] ?? {};
  }

  effectiveForUser(userId?: string | null) {
    const user = this.getUser(userId);
    return {
      ...this.snapshot(),
      leverage: user.leverage ?? this.config.leverage,
      riskLevel: user.riskLevel ?? this.config.riskLevel,
      maxDailyLossPercent: user.maxDailyLossPercent ?? this.config.maxDailyLossPercent,
      maxOpenPositions: user.maxOpenPositions ?? this.config.maxOpenPositions,
      coinWhitelist: user.coinWhitelist ?? this.config.coinWhitelist,
    };
  }

  updateGlobal(key: string, value: unknown) {
    if (!(key in this.config) || ["strategy", "bots", "users"].includes(key)) {
      throw new Error(`Unknown global trading config key: ${key}`);
    }
    const next = { ...this.config, [key]: value };
    this.replace(next);
    this.touch(`global:${key}`);
    return this.record("global", key, this.config[key as keyof TradingRuntimeConfig]);
  }

  updateStrategy(name: string, patch: Partial<StrategyRuntimeConfig>) {
    const key = this.normalize(name);
    const current = this.getStrategy(key);
    const next = { ...this.config, strategy: { ...this.config.strategy, [key]: { ...current, ...patch } } };
    this.replace(next);
    this.touch(`strategy:${key}`);
    return this.record("strategy", key, this.config.strategy[key]);
  }

  updateBot(id: string, patch: Partial<BotRuntimeConfig>) {
    const key = this.normalize(id);
    const current = this.getBot(key) ?? { enabled: true, minScore: 60, maxOpenPositions: 1, cooldownMsAfterLoss: 300_000 };
    const next = { ...this.config, bots: { ...this.config.bots, [key]: { ...current, ...patch } } };
    this.replace(next);
    this.touch(`bot:${key}`);
    return this.record("bot", key, this.config.bots[key]);
  }

  updateUser(userId: string, patch: UserTradingConfig) {
    const current = this.getUser(userId);
    const next = { ...this.config, users: { ...this.config.users, [userId]: { ...current, ...patch } } };
    this.replace(next);
    this.touch(`user:${userId}`);
    return this.record("user", userId, this.config.users[userId]);
  }

  private replace(next: TradingRuntimeConfig) {
    this.config = tradingRuntimeConfigSchema.parse(next);
  }

  private normalize(name: string) {
    return name.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  }

  private touch(key: string) {
    this.updatedAt.set(key, new Date().toISOString());
  }

  private record(scope: TradingConfigRecord["scope"], key: string, value: unknown): TradingConfigRecord {
    return {
      scope,
      key,
      value,
      source: this.updatedAt.has(`${scope}:${key}`) ? "runtime" : "env",
      updatedAt: this.updatedAt.get(`${scope}:${key}`) ?? new Date().toISOString(),
    };
  }
}

const globalStore = globalThis as typeof globalThis & { __tradingConfigStore?: TradingConfigStore };
export const tradingConfig = globalStore.__tradingConfigStore ?? new TradingConfigStore();
globalStore.__tradingConfigStore = tradingConfig;
