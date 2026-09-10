import type { MarketContext } from "@/src/types/scanner";
import type { ExecutionMarketSnapshot } from "./execution-market-snapshot.service";
import { resolveBinanceTakerFeeRate } from "./fee-profile";
import { env } from "@/lib/config";

// Dimensionless discovery evidence remains SIGNAL data, never an execution price or target.
const SIGNAL_FIELDS = ["priceAcceleration", "volumeAcceleration", "relativeStrength", "exhaustion",
  "retracement", "breakoutHeld", "rangeScore", "distanceFromMean", "flowRecovery", "trendStrength",
  "volatilityRatio", "regimeTransitionProbability", "regimeChaosProbability", "pumpScore"] as const;

export function depthSlippageBps(levels: Array<{ price: number; quantity: number }>, quoteBudget: number): number | null {
  if (!(quoteBudget > 0) || !Number.isFinite(quoteBudget) || !levels.length) return null;
  let remaining = quoteBudget, quantity = 0;
  for (const row of levels) {
    if (!(row.price > 0) || !(row.quantity > 0)) continue;
    const quote = Math.min(remaining, row.price * row.quantity);
    quantity += quote / row.price; remaining -= quote;
    if (remaining <= 1e-8) break;
  }
  if (remaining > 1e-8 || !quantity) return null;
  return Math.abs(quoteBudget / quantity / levels[0].price - 1) * 10000;
}

export function executionSignalMetadata(source: MarketContext, snapshot: ExecutionMarketSnapshot, quoteBudget?: number, executionContext?: MarketContext) {
  const sourceAt = Date.parse(String(source.metadata.marketDataTimestamp ?? ""));
  const executionAt = Date.parse(snapshot.bundle.ticker.updatedAt);
  const signalFeatures = Object.fromEntries(SIGNAL_FIELDS.map(key => [key, source.metadata[key] ?? null]));
  // Builder stability outputs are 0..100; the strategy contract consumes probabilities 0..1.
  for (const key of ["regimeTransitionProbability", "regimeChaosProbability"] as const) {
    const measured = executionContext?.metadata[key];
    if (signalFeatures[key] == null && typeof measured === "number" && Number.isFinite(measured) && measured >= 0 && measured <= 100) {
      signalFeatures[key] = measured / 100;
    }
  }
  const book = snapshot.bundle.orderBook;
  const buyImpact = book ? depthSlippageBps(book.asks, quoteBudget ?? NaN) : null;
  const sellImpact = book ? depthSlippageBps(book.bids, quoteBudget ?? NaN) : null;
  return {
    ...signalFeatures,
    opportunityLifecycleId: source.metadata.opportunityLifecycleId,
    strategyStatus: source.metadata.strategyStatus,
    signalFeatureSymbol: source.symbol,
    signalFeatureVenue: source.metadata.marketDataVenue ?? source.metadata.venue ?? "UNKNOWN",
    signalFeatureTimestamp: source.metadata.marketDataTimestamp ?? null,
    executionMarketTimestamp: snapshot.bundle.ticker.updatedAt,
    // Never rejuvenate old discovery evidence when obtaining fresh execution prices.
    marketDataTimestamp: Number.isFinite(sourceAt) ? new Date(Math.min(sourceAt, executionAt)).toISOString() : null,
    marketDataVenue: snapshot.venue,
    sourceType: source.metadata.sourceType ?? "LIVE_MARKET",
    liquidityScore: source.metadata.liquidityScore ?? null,
    takerFeePercent: resolveBinanceTakerFeeRate() * 100,
    expectedSlippageBps: buyImpact != null && sellImpact != null ? Math.max(buyImpact, sellImpact) : null,
    strategyProfitBuffer: source.metadata.strategyProfitBuffer ?? env.EXECUTION_TARGET_MIN_PROFIT_PERCENT,
    executionCostSource: "CONFIGURED_FEE_AND_CURRENT_DEPTH_ESTIMATE",
    executionCostQuoteBudget: quoteBudget ?? null,
  };
}
