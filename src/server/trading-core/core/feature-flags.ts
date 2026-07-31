const truthy = new Set(["1", "true", "yes", "on"]);
const falsy = new Set(["0", "false", "no", "off"]);

function readEnv(names: string | string[]) {
  for (const name of Array.isArray(names) ? names : [names]) {
    const raw = process.env[name];
    if (raw !== undefined && raw !== "") return raw;
  }
  return undefined;
}

function readBool(name: string | string[], defaultValue: boolean) {
  const raw = readEnv(name);
  if (raw === undefined || raw === "") return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (truthy.has(normalized)) return true;
  if (falsy.has(normalized)) return false;
  return defaultValue;
}

function readNumber(name: string | string[], defaultValue: number) {
  const value = Number(readEnv(name));
  return Number.isFinite(value) ? value : defaultValue;
}

function readList(name: string | string[], defaultValue: string[]) {
  const raw = readEnv(name);
  if (!raw) return defaultValue;
  return raw
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

const defaultTradingCoreFlags = {
  enabled: readBool(["TRADING_CORE_ENABLED", "ENABLE_TRADING_CORE"], false),
  signalEngineEnabled: readBool(["TRADING_CORE_SIGNAL_ENGINE_ENABLED", "ENABLE_SIGNAL_ENGINE"], false),
  riskEngineEnabled: readBool(["TRADING_CORE_RISK_ENGINE_ENABLED", "ENABLE_RISK_ENGINE"], true),
  executorEnabled: readBool(["TRADING_CORE_EXECUTOR_ENABLED", "ENABLE_EXECUTOR"], false),
  aiEngineEnabled: readBool(["TRADING_CORE_AI_ENGINE_ENABLED", "ENABLE_AI_ENGINE"], false),
  websocketEnabled: readBool(["TRADING_CORE_WEBSOCKET_ENABLED", "ENABLE_WEBSOCKET"], false),
  useRedisQueue: readBool(["TRADING_CORE_REDIS_QUEUE_ENABLED", "ENABLE_REDIS_QUEUE"], true),
  emergencyStop: readBool(["TRADING_CORE_EMERGENCY_STOP", "ENABLE_EMERGENCY_STOP"], false),
  closeOnlyMode: readBool(["TRADING_CORE_CLOSE_ONLY_MODE", "ENABLE_CLOSE_ONLY_MODE"], false),
  symbols: readList("TRADING_CORE_SYMBOLS", ["BTCUSDT", "ETHUSDT"]),
  minBuyScore: readNumber("TRADING_CORE_MIN_BUY_SCORE", 70),
  minSellScore: readNumber("TRADING_CORE_MIN_SELL_SCORE", 70),
  maxOpenPositions: readNumber("TRADING_CORE_MAX_OPEN_POSITIONS", 3),
  maxDailyLossPercent: readNumber("TRADING_CORE_MAX_DAILY_LOSS_PERCENT", 5),
  maxDrawdownPercent: readNumber("TRADING_CORE_MAX_DRAWDOWN_PERCENT", 12),
  maxVolatilityPercent: readNumber("TRADING_CORE_MAX_VOLATILITY_PERCENT", 8),
  minLiquidationDistancePercent: readNumber("TRADING_CORE_MIN_LIQUIDATION_DISTANCE_PERCENT", 4),
  queueConcurrency: readNumber("TRADING_CORE_QUEUE_CONCURRENCY", 4),
  cacheTtlMs: readNumber("TRADING_CORE_CACHE_TTL_MS", 60_000),
  websocketReconnectMinMs: readNumber("TRADING_CORE_WS_RECONNECT_MIN_MS", 1_000),
  websocketReconnectMaxMs: readNumber("TRADING_CORE_WS_RECONNECT_MAX_MS", 30_000),
};

export type TradingCoreFlags = typeof defaultTradingCoreFlags;
export type TradingCoreFlagKey = keyof TradingCoreFlags;
export type RuntimeFlagValue = boolean | number | string[];
export type FeatureFlagScope = "core" | "module" | "strategy" | "bot";

type RuntimeFlagRecord = {
  key: string;
  scope: FeatureFlagScope;
  value: RuntimeFlagValue;
  defaultValue: RuntimeFlagValue;
  source: "env" | "runtime";
  updatedAt: string;
};

const moduleKeyMap: Record<string, TradingCoreFlagKey> = {
  "trading-core": "enabled",
  "signal-engine": "signalEngineEnabled",
  "risk-engine": "riskEngineEnabled",
  executor: "executorEnabled",
  "ai-engine": "aiEngineEnabled",
  websocket: "websocketEnabled",
  "redis-queue": "useRedisQueue",
  "emergency-stop": "emergencyStop",
  "close-only": "closeOnlyMode",
};

function normalizeName(name: string) {
  return name.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

function envToggleKey(name: string) {
  return `ENABLE_${normalizeName(name).replace(/-/g, "_").toUpperCase()}`;
}

export class TradingFeatureFlagStore {
  private readonly core = new Map<TradingCoreFlagKey, TradingCoreFlags[TradingCoreFlagKey]>();
  private readonly modules = new Map<string, boolean>();
  private readonly strategies = new Map<string, boolean>();
  private readonly updatedAt = new Map<string, string>();

  constructor() {
    this.reset();
  }

  reset() {
    this.core.clear();
    this.modules.clear();
    this.strategies.clear();
    this.updatedAt.clear();
    for (const [key, value] of Object.entries(defaultTradingCoreFlags) as [TradingCoreFlagKey, TradingCoreFlags[TradingCoreFlagKey]][]) {
      this.core.set(key, value);
      this.updatedAt.set(`core:${key}`, new Date().toISOString());
    }
  }

  get<K extends TradingCoreFlagKey>(key: K): TradingCoreFlags[K] {
    return this.core.get(key) as TradingCoreFlags[K];
  }

  set<K extends TradingCoreFlagKey>(key: K, value: TradingCoreFlags[K]) {
    this.core.set(key, value);
    this.updatedAt.set(`core:${key}`, new Date().toISOString());
    return this.record("core", key, value, defaultTradingCoreFlags[key]);
  }

  setCoreValue(key: string, value: RuntimeFlagValue) {
    if (!(key in defaultTradingCoreFlags)) throw new Error(`Unknown trading core flag: ${key}`);
    const flagKey = key as TradingCoreFlagKey;
    const defaultValue = defaultTradingCoreFlags[flagKey];
    if (Array.isArray(defaultValue)) {
      if (!Array.isArray(value)) throw new Error(`Flag ${key} expects a string array`);
      return this.set(flagKey, value.map((item) => String(item).toUpperCase()) as TradingCoreFlags[typeof flagKey]);
    }
    if (typeof defaultValue === "boolean") {
      if (typeof value !== "boolean") throw new Error(`Flag ${key} expects a boolean`);
      return this.set(flagKey, value as TradingCoreFlags[typeof flagKey]);
    }
    if (typeof defaultValue === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Flag ${key} expects a number`);
      return this.set(flagKey, value as TradingCoreFlags[typeof flagKey]);
    }
    throw new Error(`Unsupported flag type: ${key}`);
  }

  setModuleEnabled(name: string, enabled: boolean) {
    const normalized = normalizeName(name);
    const coreKey = moduleKeyMap[normalized];
    if (coreKey && typeof defaultTradingCoreFlags[coreKey] === "boolean") {
      return this.set(coreKey, enabled as TradingCoreFlags[typeof coreKey]);
    }
    this.modules.set(normalized, enabled);
    this.updatedAt.set(`module:${normalized}`, new Date().toISOString());
    return this.record("module", normalized, enabled, this.readEnvToggle(normalized, true));
  }

  setStrategyEnabled(name: string, enabled: boolean) {
    const normalized = normalizeName(name);
    this.strategies.set(normalized, enabled);
    this.updatedAt.set(`strategy:${normalized}`, new Date().toISOString());
    return this.record("strategy", normalized, enabled, this.readStrategyEnv(normalized, true));
  }

  isModuleEnabled(name: string, defaultValue = true) {
    const normalized = normalizeName(name);
    const coreKey = moduleKeyMap[normalized];
    if (coreKey && typeof defaultTradingCoreFlags[coreKey] === "boolean") return Boolean(this.get(coreKey));
    return this.modules.get(normalized) ?? this.readEnvToggle(normalized, defaultValue);
  }

  isStrategyEnabled(name: string, defaultValue = true) {
    const normalized = normalizeName(name);
    return this.strategies.get(normalized) ?? this.readStrategyEnv(normalized, defaultValue);
  }

  emergencyDisable(modules = ["executor", "ai-engine", "websocket", "signal-engine"]) {
    const changed = modules.map((name) => this.setModuleEnabled(name, false));
    changed.push(this.set("emergencyStop", true));
    changed.push(this.set("closeOnlyMode", true));
    return changed;
  }

  snapshot() {
    const core = (Object.keys(defaultTradingCoreFlags) as TradingCoreFlagKey[]).map((key) =>
      this.record("core", key, this.get(key), defaultTradingCoreFlags[key]),
    );
    const modules = Array.from(this.modules.entries()).map(([key, value]) => this.record("module", key, value, this.readEnvToggle(key, true)));
    const strategies = Array.from(this.strategies.entries()).map(([key, value]) =>
      this.record("strategy", key, value, this.readStrategyEnv(key, true)),
    );
    return [...core, ...modules, ...strategies];
  }

  private readEnvToggle(name: string, defaultValue: boolean) {
    return readBool(envToggleKey(name), defaultValue);
  }

  private readStrategyEnv(name: string, defaultValue: boolean) {
    return readBool([`TRADING_CORE_STRATEGY_${name.replace(/-/g, "_").toUpperCase()}_ENABLED`, envToggleKey(name)], defaultValue);
  }

  private record(scope: FeatureFlagScope, key: string, value: RuntimeFlagValue, defaultValue: RuntimeFlagValue): RuntimeFlagRecord {
    const source = JSON.stringify(value) === JSON.stringify(defaultValue) ? "env" : "runtime";
    return {
      key,
      scope,
      value,
      defaultValue,
      source,
      updatedAt: this.updatedAt.get(`${scope}:${key}`) ?? new Date().toISOString(),
    };
  }
}

const globalFlags = globalThis as typeof globalThis & { __tradingFeatureFlags?: TradingFeatureFlagStore };
export const tradingFeatureFlags = globalFlags.__tradingFeatureFlags ?? new TradingFeatureFlagStore();
globalFlags.__tradingFeatureFlags = tradingFeatureFlags;

export const tradingCoreFlags = new Proxy(defaultTradingCoreFlags, {
  get(target, prop: string) {
    if (prop in target) return tradingFeatureFlags.get(prop as TradingCoreFlagKey);
    return undefined;
  },
}) as TradingCoreFlags;

