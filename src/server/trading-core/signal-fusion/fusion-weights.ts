import type { FusionSourceType } from "@/src/server/trading-core/signal-fusion/signal-fusion-types";

export const defaultFusionWeights: Record<FusionSourceType, number> = {
  TECHNICAL_INDICATORS: 0.22,
  AI_PREDICTIONS: 0.18,
  VOLUME_ANALYSIS: 0.12,
  ORDERBOOK_ANALYSIS: 0.12,
  FUNDING_RATE: 0.08,
  LIQUIDATION_HEATMAP: 0.12,
  MARKET_REGIME: 0.1,
  PROVIDER_CONSENSUS: 0.06,
};
