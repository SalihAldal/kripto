import type { ExitPolicyId } from "@/src/server/profitability/pr04-types";
import type { OiImpulseAlphaId } from "@/src/server/alpha-engine-v2/oi-impulse-alpha-v2.service";

export type TradeVenue = "BINANCE_TR_TRY_SPOT";
export type SignalVenue = "BINANCE_USDT_PERPETUAL";

export type TryBar = {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  takerBuyQuote: number;
};

export type MarketSnapshot = {
  nowMs: number;
  baseAsset: string;
  externalSymbol: string;
  executionSymbol: string;
  externalBarIdx: number;
  externalClose: number;
  tryBarIdx: number;
  tryPrice: number;
  tryVolume: number;
  btcExternalReturn4hPct: number | null;
};

export type EntryCandidateId =
  | "baseline_oi_v1"
  | "baseline_oi_v2"
  | "baseline_oi_v2_funding"
  | "entry_regime_filter"
  | "entry_liquidity_filter";

export type ExitModeId = "fixed_8h" | "pr04_trail" | "pr04_time_decay";

export type StrategyVariantId =
  | "baseline_fixed_8h_v2"
  | "baseline_fixed_8h_v1"
  | "entry_regime_filter_fixed_8h"
  | "baseline_v2_pr04_trail"
  | "combined_regime_trail";

export type StrategyVariantConfig = {
  id: StrategyVariantId;
  entryCandidate: EntryCandidateId;
  exitMode: ExitModeId;
  alphaId: OiImpulseAlphaId;
  oiFundingRequired: boolean;
  label: string;
  targetsLossMechanism?: string;
};

export type EntrySignalIntent = {
  signalId: string;
  strategyVersion: string;
  variantId: StrategyVariantId;
  alphaId: OiImpulseAlphaId;
  side: "LONG" | "SHORT";
  signalAtMs: number;
  availableAtMs: number;
  invalidationPrice: number | null;
  reasonCodes: string[];
  metadata: Record<string, unknown>;
};

export type TrySpotTradeRecord = {
  symbol: string;
  baseAsset: string;
  executionSymbol: string;
  variantId: StrategyVariantId;
  side: "LONG";
  signalAtMs: number;
  entryAtMs: number;
  exitAtMs: number;
  entryPrice: number;
  exitPrice: number;
  signalTryPrice: number;
  grossReturnPct: number;
  netReturnPct: number;
  costPct: number;
  exitReason: string;
  mfePct: number;
  maePct: number;
  split: "TRAIN" | "VAL" | "TEST" | "FRESH_PARTIAL";
  lossAttribution: Record<string, number>;
};

export type ReplayCapitalState = {
  cashTry: number;
  reservedTry: number;
  openPositions: number;
};

export type UnifiedReplayConfig = {
  variant: StrategyVariantConfig;
  periodStart: number;
  periodEnd: number;
  freshPartialStart: number;
  notionalTry: number;
  costPct: number;
  slippageBpsPerSide: number;
  maxConcurrentPerSymbol: number;
  exitPolicyId: ExitPolicyId;
};
