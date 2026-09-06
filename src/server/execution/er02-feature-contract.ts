import type { AIConsensusResult } from "@/src/types/ai";
import type { MarketContext } from "@/src/types/scanner";
import type { StrategyInput } from "@/src/server/forensics/p4-regime-strategy-shadow";

export type FeatureQuality = "VALID" | "MISSING" | "STALE" | "INVALID";
export type StrategySourceType = StrategyInput["sourceType"];

type NumericFeatureSpec = {
  key: string;
  value: number | null;
  unit: string;
  source: string;
  marketEventAt: string | null;
  observedAt: string;
  quality: FeatureQuality;
  reasonCode: string | null;
  transformVersion: string;
};

type BooleanFeatureSpec = {
  key: string;
  value: boolean | null;
  unit: "boolean";
  source: string;
  marketEventAt: string | null;
  observedAt: string;
  quality: FeatureQuality;
  reasonCode: string | null;
  transformVersion: string;
};

export type FeatureContractSnapshot = {
  schemaVersion: "er02-feature-contract-v1";
  sourceType: StrategySourceType;
  snapshotId: string;
  candidateId: string | null;
  symbol: string;
  venue: string | null;
  marketEventAt: string | null;
  observedAt: string;
  freshnessMs: number | null;
  staleAfterMs: number;
  clockSkewMs: number;
  missingFeatures: string[];
  staleFeatures: string[];
  invalidFeatures: string[];
  features: Record<string, NumericFeatureSpec | BooleanFeatureSpec>;
  expectedMove: {
    value: number | null;
    horizonMinutes: number | null;
    source: string;
    quality: FeatureQuality;
    reasonCode: string | null;
  };
  costs: {
    entryFee: number | null;
    exitFee: number | null;
    entrySlippage: number | null;
    exitSlippage: number | null;
    source: "MEASURED" | "ASSUMED" | "UNKNOWN";
  };
};

function finiteOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function boolOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function toIsoFromUnknown(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return new Date(value).toISOString();
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function inferSourceType(context: MarketContext): StrategySourceType {
  const meta = context.metadata ?? {};
  if (Boolean(meta.syntheticMarketData)) return "SYNTHETIC_FIXTURE";
  if (Boolean(meta.replayMode) || Boolean(meta.replayRunId)) return "RECORDED_REPLAY";
  const explicit = String(meta.sourceType ?? "").trim().toUpperCase();
  if (explicit === "LIVE_MARKET" || explicit === "RECORDED_REPLAY" || explicit === "SYNTHETIC_FIXTURE" || explicit === "UNKNOWN") {
    return explicit as StrategySourceType;
  }
  if (Boolean(meta.liveDataHealthy) || String(meta.discoverySource ?? "").toUpperCase() === "MICROSTRUCTURE") {
    return "LIVE_MARKET";
  }
  return "UNKNOWN";
}

function normalizeLiquidity(raw: number | null): { value: number | null; quality: FeatureQuality; reasonCode: string | null } {
  if (raw == null) return { value: null, quality: "MISSING", reasonCode: "LIQUIDITY_MISSING" };
  if (raw < 0) return { value: null, quality: "INVALID", reasonCode: "LIQUIDITY_NEGATIVE" };
  if (raw <= 1) return { value: raw, quality: "VALID", reasonCode: null };
  if (raw <= 100) return { value: Number((raw / 100).toFixed(6)), quality: "VALID", reasonCode: "LIQUIDITY_SCALE_0_100_TO_0_1" };
  return { value: null, quality: "INVALID", reasonCode: "LIQUIDITY_OUT_OF_RANGE" };
}

function normalizeSpreadBps(spreadPercent: number | null) {
  if (spreadPercent == null) return { value: null, quality: "MISSING" as const, reasonCode: "SPREAD_PERCENT_MISSING" };
  if (spreadPercent < 0) return { value: null, quality: "INVALID" as const, reasonCode: "SPREAD_PERCENT_NEGATIVE" };
  return { value: Number((spreadPercent * 100).toFixed(6)), quality: "VALID" as const, reasonCode: null };
}

export function buildFeatureContractSnapshot(input: {
  context: MarketContext;
  ai: AIConsensusResult | undefined;
  now?: number;
  staleAfterMs?: number;
  clockSkewMs?: number;
}): {
  snapshot: FeatureContractSnapshot;
  strategyInput: StrategyInput;
  regimeInput: {
    marketEventAt: string;
    detectedAt: string;
    trend: number;
    volatility: number;
    momentum: number;
    transitionProbability: number;
    chaosProbability: number;
    pumpScore: number;
  };
} {
  const now = input.now ?? Date.now();
  const staleAfterMs = Math.max(5_000, input.staleAfterMs ?? 120_000);
  const clockSkewMs = Math.max(1_000, input.clockSkewMs ?? 5_000);
  const meta = input.context.metadata ?? {};
  const observedAt = new Date(now).toISOString();
  const candidateId = typeof meta.opportunityCandidateId === "string" ? meta.opportunityCandidateId : null;
  const venue = typeof meta.marketDataVenue === "string" ? meta.marketDataVenue : null;
  const sourceType = inferSourceType(input.context);
  const marketEventAt = toIsoFromUnknown(meta.marketDataTimestamp ?? meta.lastAggTradeAt ?? meta.scannedAt ?? null);
  const marketEventMs = marketEventAt ? Date.parse(marketEventAt) : Number.NaN;
  const freshnessMs = Number.isFinite(marketEventMs) ? Math.max(0, now - marketEventMs) : null;
  const futureSkewMs = Number.isFinite(marketEventMs) ? marketEventMs - now : 0;
  const staleByTime = freshnessMs != null && freshnessMs > staleAfterMs;
  const invalidByFutureSkew = futureSkewMs > clockSkewMs;

  const spreadPercent = finiteOrNull(input.context.spreadPercent);
  const spreadBps = normalizeSpreadBps(spreadPercent);
  const liquidityNorm = normalizeLiquidity(finiteOrNull(meta.liquidityScore));
  const expectedSlippageBps = finiteOrNull(meta.expectedSlippageBps);
  const expectedSlippagePercent =
    expectedSlippageBps == null
      ? null
      : expectedSlippageBps < 0
        ? null
        : Number((expectedSlippageBps / 100).toFixed(6));
  const takerFeePercent = finiteOrNull(meta.takerFeePercent);
  const expectedMoveFromMeta = finiteOrNull(meta.expectedMovePercent);
  const expectedMoveFromScorecard = finiteOrNull(input.ai?.analysisScorecard?.expectedMovePercent);
  const expectedMovePercent = expectedMoveFromMeta ?? expectedMoveFromScorecard;
  const expectedMoveHorizonMinutes = finiteOrNull(input.ai?.analysisScorecard?.timeHorizonMinutes);
  const strategyHorizonMinutes = finiteOrNull(
    meta.strategyHorizonMinutes ?? (meta.maxWaitSec != null ? Number(meta.maxWaitSec) / 60 : null),
  );
  const horizonMismatch =
    expectedMoveHorizonMinutes != null &&
    strategyHorizonMinutes != null &&
    Math.abs(expectedMoveHorizonMinutes - strategyHorizonMinutes) > Math.max(10, strategyHorizonMinutes * 0.75);
  const expectedMoveSource =
    expectedMoveFromMeta != null
      ? "metadata.expectedMovePercent"
      : expectedMoveFromScorecard != null
        ? "ai.analysisScorecard.expectedMovePercent"
        : "UNKNOWN";
  const expectedMoveQuality: FeatureQuality =
    expectedMovePercent == null
      ? "MISSING"
      : horizonMismatch
        ? "INVALID"
        : Number.isFinite(expectedMovePercent)
          ? "VALID"
          : "INVALID";

  const baseTimestampQuality: FeatureQuality = marketEventAt == null ? "MISSING" : invalidByFutureSkew ? "INVALID" : staleByTime ? "STALE" : "VALID";
  const timeReason =
    baseTimestampQuality === "MISSING"
      ? "MARKET_EVENT_TIMESTAMP_MISSING"
      : baseTimestampQuality === "INVALID"
        ? "MARKET_EVENT_TIMESTAMP_FUTURE_SKEW"
        : baseTimestampQuality === "STALE"
          ? "MARKET_EVENT_TIMESTAMP_STALE"
          : null;

  const numeric = (
    key: string,
    raw: unknown,
    unit: string,
    source: string,
    custom?: { min?: number; max?: number },
  ): NumericFeatureSpec => {
    if (raw == null || raw === "") {
      return { key, value: null, unit, source, marketEventAt, observedAt, quality: "MISSING", reasonCode: `${key}_MISSING`, transformVersion: "er02-v1" };
    }
    if (typeof raw === "number" && !Number.isFinite(raw)) {
      return { key, value: null, unit, source, marketEventAt, observedAt, quality: "INVALID", reasonCode: `${key}_NOT_FINITE`, transformVersion: "er02-v1" };
    }
    if (typeof raw === "string" && raw.trim() && !Number.isFinite(Number(raw))) {
      return { key, value: null, unit, source, marketEventAt, observedAt, quality: "INVALID", reasonCode: `${key}_NOT_NUMERIC`, transformVersion: "er02-v1" };
    }
    const value = finiteOrNull(raw);
    if (value == null) {
      return { key, value: null, unit, source, marketEventAt, observedAt, quality: "MISSING", reasonCode: `${key}_MISSING`, transformVersion: "er02-v1" };
    }
    if ((custom?.min != null && value < custom.min) || (custom?.max != null && value > custom.max)) {
      return { key, value: null, unit, source, marketEventAt, observedAt, quality: "INVALID", reasonCode: `${key}_OUT_OF_RANGE`, transformVersion: "er02-v1" };
    }
    if (baseTimestampQuality === "INVALID" || baseTimestampQuality === "STALE") {
      return { key, value, unit, source, marketEventAt, observedAt, quality: baseTimestampQuality, reasonCode: timeReason, transformVersion: "er02-v1" };
    }
    return { key, value, unit, source, marketEventAt, observedAt, quality: "VALID", reasonCode: null, transformVersion: "er02-v1" };
  };

  const boolean = (key: string, raw: unknown, source: string): BooleanFeatureSpec => {
    const value = boolOrNull(raw);
    if (value == null) {
      return { key, value: null, unit: "boolean", source, marketEventAt, observedAt, quality: "MISSING", reasonCode: `${key}_MISSING`, transformVersion: "er02-v1" };
    }
    if (baseTimestampQuality === "INVALID" || baseTimestampQuality === "STALE") {
      return { key, value, unit: "boolean", source, marketEventAt, observedAt, quality: baseTimestampQuality, reasonCode: timeReason, transformVersion: "er02-v1" };
    }
    return { key, value, unit: "boolean", source, marketEventAt, observedAt, quality: "VALID", reasonCode: null, transformVersion: "er02-v1" };
  };

  const features: FeatureContractSnapshot["features"] = {
    velocity: numeric("velocity", meta.tradeVelocity, "trades_per_sec", "metadata.tradeVelocity"),
    acceleration: numeric("acceleration", meta.priceAcceleration, "normalized", "metadata.priceAcceleration"),
    volumeAcceleration: numeric("volumeAcceleration", meta.volumeAcceleration, "ratio", "metadata.volumeAcceleration"),
    relativeStrength: numeric("relativeStrength", meta.relativeStrength, "ratio", "metadata.relativeStrength"),
    spreadBps: {
      key: "spreadBps",
      value: spreadBps.value,
      unit: "basis_points",
      source: "context.spreadPercent",
      marketEventAt,
      observedAt,
      quality: spreadBps.quality,
      reasonCode: spreadBps.reasonCode,
      transformVersion: "er02-v1",
    },
    liquidityScore: {
      key: "liquidityScore",
      value: liquidityNorm.value,
      unit: "score_0_1",
      source: "metadata.liquidityScore",
      marketEventAt,
      observedAt,
      quality: liquidityNorm.quality,
      reasonCode: liquidityNorm.reasonCode,
      transformVersion: "er02-v1",
    },
    exhaustion: numeric("exhaustion", meta.exhaustion, "score_0_1", "metadata.exhaustion", { min: 0, max: 1 }),
    momentum: numeric("momentum", meta.shortMomentumPercent, "percent", "metadata.shortMomentumPercent"),
    retracement: numeric("retracement", meta.retracement, "ratio", "metadata.retracement"),
    breakoutHeld: boolean("breakoutHeld", meta.breakoutHeld, "metadata.breakoutHeld"),
    rangeScore: numeric("rangeScore", meta.rangeScore, "score_0_1", "metadata.rangeScore", { min: 0, max: 1 }),
    distanceFromMean: numeric("distanceFromMean", meta.distanceFromMean, "ratio", "metadata.distanceFromMean"),
    flowRecovery: numeric("flowRecovery", meta.flowRecovery, "score_0_1", "metadata.flowRecovery", { min: 0, max: 1 }),
    trendStrength: numeric("trendStrength", meta.trendStrength, "ratio", "metadata.trendStrength"),
    volatilityRatio: numeric("volatilityRatio", meta.volatilityRatio, "ratio", "metadata.volatilityRatio", { min: 0 }),
    transitionProbability: numeric("transitionProbability", meta.regimeTransitionProbability, "probability_0_1", "metadata.regimeTransitionProbability", { min: 0, max: 1 }),
    chaosProbability: numeric("chaosProbability", meta.regimeChaosProbability, "probability_0_1", "metadata.regimeChaosProbability", { min: 0, max: 1 }),
    pumpStrength: numeric("pumpStrength", meta.pumpScore, "score_0_1", "metadata.pumpScore", { min: 0, max: 1 }),
    entrySpread: numeric("entrySpread", spreadPercent, "percent", "context.spreadPercent", { min: 0 }),
    entrySlippage: numeric("entrySlippage", expectedSlippagePercent, "percent", "metadata.expectedSlippageBps", { min: 0 }),
    entryFee: numeric("entryFee", takerFeePercent, "percent", "metadata.takerFeePercent", { min: 0 }),
    exitSpread: numeric("exitSpread", spreadPercent, "percent", "context.spreadPercent", { min: 0 }),
    exitSlippage: numeric("exitSlippage", expectedSlippagePercent, "percent", "metadata.expectedSlippageBps", { min: 0 }),
    exitFee: numeric("exitFee", takerFeePercent, "percent", "metadata.takerFeePercent", { min: 0 }),
    strategyProfitBuffer: numeric("strategyProfitBuffer", meta.strategyProfitBuffer, "percent", "metadata.strategyProfitBuffer", { min: 0 }),
    expectedMovePercent: {
      key: "expectedMovePercent",
      value: expectedMovePercent,
      unit: "percent",
      source: expectedMoveSource,
      marketEventAt,
      observedAt,
      quality:
        expectedMovePercent == null
          ? "MISSING"
          : horizonMismatch
            ? "INVALID"
            : baseTimestampQuality === "INVALID" || baseTimestampQuality === "STALE"
              ? baseTimestampQuality
              : "VALID",
      reasonCode:
        expectedMovePercent == null
          ? "expectedMovePercent_MISSING"
          : horizonMismatch
            ? "EXPECTED_MOVE_HORIZON_MISMATCH"
            : baseTimestampQuality === "INVALID" || baseTimestampQuality === "STALE"
              ? timeReason
              : null,
      transformVersion: "er02-v1",
    },
  };

  const missingFeatures = Object.values(features)
    .filter((x) => x.quality === "MISSING")
    .map((x) => x.key);
  const staleFeatures = Object.values(features)
    .filter((x) => x.quality === "STALE")
    .map((x) => x.key);
  const invalidFeatures = Object.values(features)
    .filter((x) => x.quality === "INVALID")
    .map((x) => x.key);
  if (!marketEventAt) staleFeatures.push("marketEventAt");

  const snapshot: FeatureContractSnapshot = {
    schemaVersion: "er02-feature-contract-v1",
    sourceType,
    snapshotId: `${input.context.symbol}:${candidateId ?? "none"}:${now}`,
    candidateId,
    symbol: input.context.symbol,
    venue,
    marketEventAt,
    observedAt,
    freshnessMs,
    staleAfterMs,
    clockSkewMs,
    missingFeatures,
    staleFeatures,
    invalidFeatures,
    features,
    expectedMove: {
      value: expectedMovePercent,
      horizonMinutes: expectedMoveHorizonMinutes,
      source: expectedMoveSource,
      quality: expectedMoveQuality,
      reasonCode:
        expectedMoveQuality === "MISSING"
          ? "EXPECTED_MOVE_UNAVAILABLE"
          : expectedMoveQuality === "INVALID" && horizonMismatch
            ? "EXPECTED_MOVE_HORIZON_MISMATCH"
            : null,
    },
    costs: {
      entryFee: takerFeePercent,
      exitFee: takerFeePercent,
      entrySlippage: expectedSlippagePercent,
      exitSlippage: expectedSlippagePercent,
      source: takerFeePercent != null || expectedSlippagePercent != null ? "MEASURED" : "UNKNOWN",
    },
  };

  const getNumber = (key: string) => {
    const row = snapshot.features[key];
    return row && typeof row.value === "number" ? row.value : null;
  };
  const getBoolean = (key: string) => {
    const row = snapshot.features[key];
    return row && typeof row.value === "boolean" ? row.value : null;
  };

  const strategyInput: StrategyInput = {
    candidateId: candidateId ?? `${input.context.symbol}:${now}`,
    sourceType,
    marketEventAt: marketEventAt ?? new Date(0).toISOString(),
    evaluatedAt: observedAt,
    velocity: getNumber("velocity") ?? 0,
    acceleration: getNumber("acceleration") ?? 0,
    volumeAcceleration: getNumber("volumeAcceleration") ?? 0,
    relativeStrength: getNumber("relativeStrength") ?? 0,
    spreadBps: getNumber("spreadBps") ?? 0,
    liquidityScore: getNumber("liquidityScore") ?? 0,
    exhaustion: getNumber("exhaustion") ?? 0,
    momentum: getNumber("momentum") ?? 0,
    retracement: getNumber("retracement") ?? 0,
    breakoutHeld: getBoolean("breakoutHeld") ?? false,
    rangeScore: getNumber("rangeScore") ?? 0,
    distanceFromMean: getNumber("distanceFromMean") ?? 0,
    flowRecovery: getNumber("flowRecovery") ?? 0,
    staleFeatures,
    missingFeatures,
    invalidFeatures,
    entrySpread: getNumber("entrySpread") ?? 0,
    entrySlippage: getNumber("entrySlippage") ?? 0,
    entryFee: getNumber("entryFee") ?? 0,
    exitSpread: getNumber("exitSpread") ?? 0,
    exitSlippage: getNumber("exitSlippage") ?? 0,
    exitFee: getNumber("exitFee") ?? 0,
    strategyProfitBuffer: getNumber("strategyProfitBuffer") ?? 0,
    expectedMovePercent: getNumber("expectedMovePercent") ?? 0,
  };

  const regimeInput = {
    marketEventAt: marketEventAt ?? new Date(0).toISOString(),
    detectedAt: observedAt,
    trend: getNumber("trendStrength") ?? 0,
    volatility: getNumber("volatilityRatio") ?? 0,
    momentum: getNumber("momentum") ?? 0,
    transitionProbability: getNumber("transitionProbability") ?? 0,
    chaosProbability: getNumber("chaosProbability") ?? 0,
    pumpScore: getNumber("pumpStrength") ?? 0,
  };

  return { snapshot, strategyInput, regimeInput };
}
