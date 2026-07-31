import type { MarketIntelRegime, SnapshotInterval } from "@prisma/client";
import type { KlineItem, OrderBookSnapshot, RecentTrade } from "@/src/types/exchange";
import type { MarketContext } from "@/src/types/scanner";

export const INTEL_INTERVALS: SnapshotInterval[] = ["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1"];

export const RETENTION_DAYS: Partial<Record<SnapshotInterval, number | null>> = {
  M1: 30,
  M3: 30,
  M5: 90,
  M15: 180,
  M30: 180,
  H1: 365,
  H4: null,
  D1: null,
};

export type MarketCaptureInput = {
  symbol: string;
  interval: SnapshotInterval;
  snapshotAt?: Date;
  context: MarketContext;
  klines: KlineItem[];
  orderBook: OrderBookSnapshot;
  recentTrades: RecentTrade[];
  ticker?: { price: number; volume24h: number; change24h?: number };
  btcKlines?: KlineItem[];
  ethKlines?: KlineItem[];
  futuresMeta?: Record<string, unknown>;
};

export type SnapshotMetrics = {
  open: number;
  high: number;
  low: number;
  close: number;
  volumeBase: number;
  volumeQuote: number;
  tradeCount: number;
  vwap: number;
  atr: number;
  trueRange: number;
  spread: number;
  bid: number;
  ask: number;
  bidAskRatio: number;
  orderBookImbalance: number;
  liquidityScore: number;
  effectiveLiquidity: number;
  fundingRate: number | null;
  openInterest: number | null;
  longShortRatio: number | null;
  liquidationVolume: number | null;
  whaleActivity: number;
  whaleBuyVolume: number;
  whaleSellVolume: number;
  aggressiveBuyPct: number;
  aggressiveSellPct: number;
  netFlow: number;
  volumeDelta: number;
  cvd: number;
  relativeVolume: number;
  marketCap: number | null;
  fdv: number | null;
  dominance: number | null;
  volatility: number;
  realizedVolatility: number;
  impliedVolatility: number | null;
  correlationBtc: number | null;
  correlationEth: number | null;
  relativeStrength: number | null;
  regime: MarketIntelRegime;
  healthScore: number;
  dataQualityScore: number;
};

export type TrendIntel = {
  primaryTrend: string;
  secondaryTrend: string;
  microTrend: string;
  trendStrength: number;
  trendAge: number;
  trendConfidence: number;
  trendExhaustion: number;
  trendAcceleration: number;
};

export type MomentumIntel = {
  momentumScore: number;
  acceleration: number;
  velocity: number;
  volumeAcceleration: number;
  priceAcceleration: number;
  breakoutProbability: number;
  continuationProbability: number;
  exhaustionProbability: number;
};

export type HealthIntel = {
  healthScore: number;
  liquidityScore: number;
  spreadScore: number;
  volatilityScore: number;
  dataQualityScore: number;
  executionQuality: number;
  orderbookStability: number;
  marketStability: number;
  newsImpact: number;
  fundingStability: number;
  exchangeHealth: number;
};

export type LiquidityIntel = {
  liquidityScore: number;
  depthScore: number;
  spreadScore: number;
  absorption: number;
  sweepDetected: boolean;
  liquidityWall: number;
  spoofDetected: boolean;
  icebergDetected: boolean;
};

export type VolumeIntel = {
  volumeProfile: Record<string, number>;
  volumeDelta: number;
  relativeVolume: number;
  abnormalVolume: boolean;
  smartMoneyVolume: number;
  retailVolume: number;
  whaleVolume: number;
  buyingPressure: number;
  sellingPressure: number;
};

export type CompleteMarketState = {
  snapshot: SnapshotMetrics;
  trend: TrendIntel;
  momentum: MomentumIntel;
  health: HealthIntel;
  liquidity: LiquidityIntel;
  volume: VolumeIntel;
};

export type MarketIntelJobPayload =
  | { type: "CAPTURE_SYMBOL"; symbol: string; interval?: SnapshotInterval; captureInput?: Partial<MarketCaptureInput> }
  | { type: "CAPTURE_BATCH"; symbols?: string[]; limit?: number }
  | { type: "VALIDATE_SNAPSHOTS"; limit?: number }
  | { type: "CLEANUP_RETENTION" }
  | { type: "COMPRESS_SNAPSHOTS"; limit?: number }
  | { type: "AGGREGATE_HISTORICAL"; interval?: SnapshotInterval };

export { MarketIntelRegime, SnapshotInterval };
