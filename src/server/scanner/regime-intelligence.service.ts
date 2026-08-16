import type { MarketRegime, StrategyType } from "@/src/server/scanner/market-regime.service";
import { detectMarketRegime } from "@/src/server/scanner/market-regime.service";

/** Institutional regime taxonomy — normalized view across scanner/simulation/live. */
export type InstitutionalRegimeClass =
  | "STRONG_BULL"
  | "WEAK_BULL"
  | "STRONG_BEAR"
  | "WEAK_BEAR"
  | "SIDEWAYS"
  | "HIGH_VOLATILITY"
  | "LOW_VOLATILITY"
  | "HIGH_LIQUIDITY"
  | "LOW_LIQUIDITY"
  | "TRENDING"
  | "MEAN_REVERTING"
  | "BREAKOUT"
  | "CAPITULATION"
  | "ACCUMULATION"
  | "RECOVERY"
  | "UNKNOWN";

const CANONICAL_REGIMES: MarketRegime[] = [
  "STRONG_BULLISH_TREND",
  "WEAK_BULLISH_TREND",
  "STRONG_BEARISH_TREND",
  "WEAK_BEARISH_TREND",
  "RANGE_SIDEWAYS",
  "ROCKET_PUMP",
  "HIGH_VOLATILITY_CHAOS",
  "LOW_VOLATILITY_CALM",
  "LOW_VOLUME_DEAD_MARKET",
  "NEWS_DRIVEN_UNSTABLE",
];

const SIMULATION_REGIME_MAP: Record<string, MarketRegime> = {
  trending: "WEAK_BULLISH_TREND",
  ranging: "RANGE_SIDEWAYS",
  volatile: "HIGH_VOLATILITY_CHAOS",
  low_liquidity: "LOW_VOLUME_DEAD_MARKET",
};

const SCANNER_STRATEGY_TO_TYPE: Record<string, StrategyType> = {
  momentum_scalp: "TREND_PULLBACK",
  mean_reversion: "RANGE_MEAN_REVERSION",
  trend_pullback: "TREND_PULLBACK",
  breakout_follow: "BREAKOUT_CONTINUATION",
  breakout_retest: "BREAKOUT_RETEST",
  bounce_only: "BOUNCE_ONLY",
  volatility_defensive: "VOLATILITY_DEFENSIVE",
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals = 4) {
  return Number(value.toFixed(decimals));
}

export function normalizeMarketRegimeLabel(raw: string): MarketRegime {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "RANGE_SIDEWAYS";
  const upper = trimmed.toUpperCase().replace(/[\s-]+/g, "_");
  if ((CANONICAL_REGIMES as string[]).includes(upper)) return upper as MarketRegime;
  const sim = SIMULATION_REGIME_MAP[trimmed.toLowerCase()];
  if (sim) return sim;
  if (upper.includes("STRONG_BULL")) return "STRONG_BULLISH_TREND";
  if (upper.includes("WEAK_BULL")) return "WEAK_BULLISH_TREND";
  if (upper.includes("STRONG_BEAR")) return "STRONG_BEARISH_TREND";
  if (upper.includes("WEAK_BEAR")) return "WEAK_BEARISH_TREND";
  if (upper.includes("ROCKET") || upper.includes("PUMP")) return "ROCKET_PUMP";
  if (upper.includes("HIGH_VOL") || upper.includes("CHAOS") || upper.includes("VOLATILE")) return "HIGH_VOLATILITY_CHAOS";
  if (upper.includes("LOW_VOL") || upper.includes("CALM")) return "LOW_VOLATILITY_CALM";
  if (upper.includes("LOW_LIQ") || upper.includes("DEAD_MARKET")) return "LOW_VOLUME_DEAD_MARKET";
  if (upper.includes("NEWS")) return "NEWS_DRIVEN_UNSTABLE";
  if (upper.includes("RANGE") || upper.includes("SIDEWAYS")) return "RANGE_SIDEWAYS";
  if (upper.includes("ACCUMULATION")) return "RANGE_SIDEWAYS";
  if (upper.includes("CAPITULATION") || upper.includes("DUMP")) return "STRONG_BEARISH_TREND";
  if (upper.includes("RECOVERY")) return "WEAK_BULLISH_TREND";
  if (upper.includes("BREAKOUT")) return "ROCKET_PUMP";
  if (upper.includes("TREND")) return "WEAK_BULLISH_TREND";
  return "RANGE_SIDEWAYS";
}

export function classifyInstitutionalRegime(input: {
  marketRegime: string;
  volatilityPercent?: number;
  liquidity24h?: number;
  minLiquidityThreshold?: number;
}): InstitutionalRegimeClass[] {
  const canonical = normalizeMarketRegimeLabel(input.marketRegime);
  const classes = new Set<InstitutionalRegimeClass>();
  switch (canonical) {
    case "STRONG_BULLISH_TREND":
      classes.add("STRONG_BULL");
      classes.add("TRENDING");
      classes.add("BREAKOUT");
      break;
    case "WEAK_BULLISH_TREND":
      classes.add("WEAK_BULL");
      classes.add("TRENDING");
      classes.add("RECOVERY");
      break;
    case "STRONG_BEARISH_TREND":
      classes.add("STRONG_BEAR");
      classes.add("CAPITULATION");
      classes.add("TRENDING");
      break;
    case "WEAK_BEARISH_TREND":
      classes.add("WEAK_BEAR");
      classes.add("TRENDING");
      break;
    case "RANGE_SIDEWAYS":
      classes.add("SIDEWAYS");
      classes.add("MEAN_REVERTING");
      classes.add("ACCUMULATION");
      break;
    case "ROCKET_PUMP":
      classes.add("BREAKOUT");
      classes.add("TRENDING");
      classes.add("STRONG_BULL");
      break;
    case "HIGH_VOLATILITY_CHAOS":
    case "NEWS_DRIVEN_UNSTABLE":
      classes.add("HIGH_VOLATILITY");
      break;
    case "LOW_VOLATILITY_CALM":
      classes.add("LOW_VOLATILITY");
      classes.add("MEAN_REVERTING");
      classes.add("SIDEWAYS");
      break;
    case "LOW_VOLUME_DEAD_MARKET":
      classes.add("LOW_LIQUIDITY");
      classes.add("LOW_VOLATILITY");
      break;
    default:
      classes.add("UNKNOWN");
      break;
  }
  const vol = Number(input.volatilityPercent ?? 0);
  const liq = Number(input.liquidity24h ?? 0);
  const minLiq = Number(input.minLiquidityThreshold ?? 5_000_000);
  if (vol >= 2.5) classes.add("HIGH_VOLATILITY");
  if (vol > 0 && vol <= 0.8) classes.add("LOW_VOLATILITY");
  if (liq >= minLiq * 1.5) classes.add("HIGH_LIQUIDITY");
  if (liq > 0 && liq < minLiq) classes.add("LOW_LIQUIDITY");
  return [...classes];
}

export type RegimePipelinePolicy = {
  canonicalRegime: MarketRegime;
  institutionalClasses: InstitutionalRegimeClass[];
  rankingThreshold: number;
  confidenceFloorAdjust: number;
  expectedValueFloorMultiplier: number;
  sizingRegimeFactor: number;
  volatilityBreakerMultiplier: number;
  strategyAlignmentRequired: boolean;
  allowedStrategyTypes: StrategyType[];
  selectedStrategy: StrategyType;
  openTradeAllowed: boolean;
  riskMultiplier: number;
};

function inferRegimeSnapshot(input: {
  marketRegime: MarketRegime;
  volatilityPercent: number;
  liquidity24h: number;
  minLiquidityThreshold: number;
}) {
  return detectMarketRegime({
    trendStrength: input.marketRegime.includes("STRONG") ? 0.75 : 0.3,
    momentumPercent: input.marketRegime.includes("BEAR") ? -0.45 : input.marketRegime.includes("BULL") ? 0.42 : 0.04,
    shortMomentumPercent: input.marketRegime.includes("BEAR") ? -0.12 : 0.06,
    volatilityPercent: input.marketRegime === "HIGH_VOLATILITY_CHAOS" ? 3.2 : input.volatilityPercent,
    spreadPercent: input.liquidity24h < input.minLiquidityThreshold ? 0.25 : 0.08,
    fakeSpikeScore: input.volatilityPercent >= 2.8 ? 2.5 : 0.5,
    volume24h: input.marketRegime === "LOW_VOLUME_DEAD_MARKET" ? input.minLiquidityThreshold * 0.4 : input.liquidity24h,
    minVolumeThreshold: input.minLiquidityThreshold,
    shortFlowImbalance: 0.02,
    pumpIntensity: input.marketRegime === "ROCKET_PUMP" ? 75 : 20,
    pumpRisk: 25,
    volumeSpikePercent: input.marketRegime === "ROCKET_PUMP" ? 130 : 40,
  });
}

export function resolveRegimePipelinePolicy(input: {
  marketRegime: string;
  entryThresholdScore?: number;
  riskMultiplier?: number;
  openTradeAllowed?: boolean;
  selectedStrategy?: string;
  allowedStrategyTypes?: string[];
  volatilityPercent?: number;
  liquidity24h?: number;
  minLiquidityThreshold?: number;
}): RegimePipelinePolicy {
  const canonical = normalizeMarketRegimeLabel(input.marketRegime);
  const snapshot =
    input.entryThresholdScore !== undefined && input.riskMultiplier !== undefined
      ? null
      : inferRegimeSnapshot({
          marketRegime: canonical,
          volatilityPercent: input.volatilityPercent ?? 1.5,
          liquidity24h: input.liquidity24h ?? 8_000_000,
          minLiquidityThreshold: input.minLiquidityThreshold ?? 5_000_000,
        });
  const entryThresholdScore = input.entryThresholdScore ?? snapshot?.entryThresholdScore ?? 68;
  const riskMultiplier = input.riskMultiplier ?? snapshot?.riskMultiplier ?? 0.72;
  const openTradeAllowed = input.openTradeAllowed ?? snapshot?.openTradeAllowed ?? true;
  const allowedStrategyTypes =
    (input.allowedStrategyTypes as StrategyType[] | undefined) ??
    snapshot?.allowedStrategyTypes ??
    ["RANGE_MEAN_REVERSION", "TREND_PULLBACK"];
  const selectedStrategy =
    (input.selectedStrategy as StrategyType | undefined) ?? snapshot?.selectedStrategy ?? "RANGE_MEAN_REVERSION";
  const institutionalClasses = classifyInstitutionalRegime({
    marketRegime: canonical,
    volatilityPercent: input.volatilityPercent,
    liquidity24h: input.liquidity24h,
    minLiquidityThreshold: input.minLiquidityThreshold,
  });

  let confidenceFloorAdjust = 0;
  let expectedValueFloorMultiplier = 1;
  let sizingRegimeFactor = riskMultiplier;
  let volatilityBreakerMultiplier = 1;
  if (institutionalClasses.includes("HIGH_VOLATILITY") || canonical === "NEWS_DRIVEN_UNSTABLE") {
    confidenceFloorAdjust = 4;
    expectedValueFloorMultiplier = 1.15;
    volatilityBreakerMultiplier = 0.88;
    sizingRegimeFactor = Math.min(sizingRegimeFactor, 0.72);
  } else if (institutionalClasses.includes("STRONG_BULL") || canonical === "ROCKET_PUMP") {
    confidenceFloorAdjust = -3;
    expectedValueFloorMultiplier = 0.92;
    sizingRegimeFactor = Math.max(sizingRegimeFactor, 1.05);
  } else if (institutionalClasses.includes("LOW_LIQUIDITY")) {
    confidenceFloorAdjust = 6;
    expectedValueFloorMultiplier = 1.2;
    sizingRegimeFactor = Math.min(sizingRegimeFactor, 0.55);
  } else if (institutionalClasses.includes("MEAN_REVERTING") || canonical === "LOW_VOLATILITY_CALM") {
    expectedValueFloorMultiplier = 0.95;
    sizingRegimeFactor = Math.max(sizingRegimeFactor, 0.85);
  }

  return {
    canonicalRegime: canonical,
    institutionalClasses,
    rankingThreshold: round(clamp(entryThresholdScore, 48, 88)),
    confidenceFloorAdjust,
    expectedValueFloorMultiplier: round(expectedValueFloorMultiplier, 4),
    sizingRegimeFactor: round(clamp(sizingRegimeFactor, 0.15, 1.15), 4),
    volatilityBreakerMultiplier: round(volatilityBreakerMultiplier, 4),
    strategyAlignmentRequired: canonical !== "RANGE_SIDEWAYS",
    allowedStrategyTypes,
    selectedStrategy,
    openTradeAllowed,
    riskMultiplier: round(riskMultiplier, 4),
  };
}

export function mapScannerStrategyToType(strategy: string): StrategyType {
  const key = strategy.toLowerCase().replace(/[\s-]+/g, "_");
  return SCANNER_STRATEGY_TO_TYPE[key] ?? "TREND_PULLBACK";
}

export function evaluateStrategyRegimeAlignment(input: {
  strategy: string;
  allowedStrategyTypes: StrategyType[];
}): { aligned: boolean; mappedStrategy: StrategyType; reason?: string } {
  const mappedStrategy = mapScannerStrategyToType(input.strategy);
  const aligned = input.allowedStrategyTypes.includes(mappedStrategy);
  return {
    aligned,
    mappedStrategy,
    reason: aligned
      ? undefined
      : `Strategy ${input.strategy} (${mappedStrategy}) misaligned with regime allowed set`,
  };
}

export function resolveRegimeAwareEntryQualityThreshold(input: {
  marketRegime: string;
  baseMaxAiRiskScore?: number;
  baseMinConfidence?: number;
}): { maxAiRiskScore: number; minConfidence: number } {
  const policy = resolveRegimePipelinePolicy({ marketRegime: input.marketRegime });
  const maxAiRiskScore = input.baseMaxAiRiskScore ?? 75;
  const minConfidence = (input.baseMinConfidence ?? 82) + policy.confidenceFloorAdjust;
  if (policy.institutionalClasses.includes("STRONG_BULL") || policy.canonicalRegime === "ROCKET_PUMP") {
    return { maxAiRiskScore: maxAiRiskScore + 2, minConfidence: Math.max(80, minConfidence - 2) };
  }
  if (policy.institutionalClasses.includes("HIGH_VOLATILITY") || policy.institutionalClasses.includes("LOW_LIQUIDITY")) {
    return { maxAiRiskScore: maxAiRiskScore - 3, minConfidence: minConfidence + 2 };
  }
  return { maxAiRiskScore, minConfidence: round(minConfidence, 2) };
}

export type RegimePerformanceMetrics = {
  regime: string;
  tradeCount: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  expectancy: number;
  totalPnl: number;
};

export function computeRegimePerformanceByGroup(
  trades: Array<{ pnlUsdt: number | string; marketRegime: string | number }>,
  initialEquity = 10_000,
): RegimePerformanceMetrics[] {
  const groups = new Map<string, number[]>();
  for (const trade of trades) {
    const regime = normalizeMarketRegimeLabel(String(trade.marketRegime));
    const bucket = groups.get(regime) ?? [];
    bucket.push(Number(trade.pnlUsdt));
    groups.set(regime, bucket);
  }
  return [...groups.entries()].map(([regime, pnls]) => {
    const wins = pnls.filter((p) => p > 0).length;
    const grossProfit = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(pnls.filter((p) => p < 0).reduce((a, b) => a + b, 0));
    const returns = pnls.map((p) => p / initialEquity);
    const mean = returns.reduce((a, b) => a + b, 0) / Math.max(returns.length, 1);
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(returns.length, 1);
    const std = Math.sqrt(variance);
    const downside = returns.filter((r) => r < 0);
    const downsideStd = Math.sqrt(downside.reduce((s, r) => s + r ** 2, 0) / Math.max(downside.length, 1));
    let peak = initialEquity;
    let eq = initialEquity;
    let maxDrawdown = 0;
    for (const p of pnls) {
      eq += p;
      peak = Math.max(peak, eq);
      maxDrawdown = Math.max(maxDrawdown, peak - eq);
    }
    return {
      regime,
      tradeCount: pnls.length,
      winRate: round((wins / Math.max(pnls.length, 1)) * 100, 2),
      profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 4) : grossProfit > 0 ? 999 : 0,
      sharpeRatio: std > 0 ? round(mean / std, 4) : 0,
      sortinoRatio: downsideStd > 0 ? round(mean / downsideStd, 4) : std > 0 ? round(mean / std, 4) : 0,
      maxDrawdown: round(maxDrawdown, 4),
      expectancy: round(pnls.reduce((a, b) => a + b, 0) / Math.max(pnls.length, 1), 4),
      totalPnl: round(pnls.reduce((a, b) => a + b, 0), 4),
    };
  });
}
