import { env } from "@/lib/config";
import { getRuntimeStrategyParams } from "@/src/server/config/strategy-runtime.service";
import type { ResolvedConfigSnapshot } from "@/src/server/forensics/forensic.types";
import { resolveCanonicalVenueConfig } from "@/src/server/exchange/venue-config.service";
import { hashCanonicalConfig } from "@/src/server/forensics/config-hash.service";

export async function resolveRuntimeConfigSnapshot(userId?: string): Promise<ResolvedConfigSnapshot> {
  const runtime = userId ? await getRuntimeStrategyParams(userId).catch(() => null) : null;
  const venue = resolveCanonicalVenueConfig();
  const policy = {
    ai: "ADVISORY",
    tdi: "SHADOW",
    learning: "ADVISORY",
  } as const;
  const configScope = {
    opportunityConfig: runtime?.trade ?? {},
    hotConfig: runtime?.trade ?? {},
    microConfig: runtime?.trade ?? {},
    finalRankConfig: runtime?.trade ?? {},
    riskConfig: runtime?.risk ?? {
      maxDailyLossPercent: env.RISK_MAX_DAILY_LOSS_PERCENT,
      maxOpenPositions: env.EXECUTION_MAX_OPEN_POSITIONS,
    },
    paperExecutionConfig: {
      mode: env.EXECUTION_MODE,
      takerFeeRate: env.BINANCE_TAKER_FEE_RATE,
      makerFeeRate: env.BINANCE_MAKER_FEE_RATE,
      selectionBudgetSec: env.AUTO_ROUND_SELECTION_BUDGET_SEC,
    },
    venueConfig: venue,
    effectivePolicy: policy,
  };
  const configHash = hashCanonicalConfig(configScope);
  return {
    generatedAt: new Date().toISOString(),
    configHash,
    exchange: env.EXCHANGE_PROVIDER ?? "binance-tr",
    mode: env.EXECUTION_MODE,
    exchangeRouting: {
      platform: env.BINANCE_PLATFORM,
      marketDataProvider: env.EXCHANGE_PROVIDER === "okx" ? "OKX_PUBLIC" : "BINANCE_PUBLIC",
      metadataProvider: env.EXCHANGE_PROVIDER === "okx" ? "OKX_EXCHANGE_INFO" : "BINANCE_EXCHANGE_INFO",
      paperExecutionProvider: "PAPER_EXCHANGE_SIMULATOR",
      liveExecutionProvider: env.EXCHANGE_PROVIDER === "okx" ? "OKX_LIVE_ADAPTER" : "BINANCE_LIVE_ADAPTER",
    },
    venueRouting: {
      discoveryVenue: venue.discoveryVenue,
      marketDataVenue: venue.marketDataVenue,
      microstructureVenue: venue.microstructureVenue,
      metadataVenue: venue.metadataVenue,
      paperExecutionVenue: venue.paperExecutionVenue,
      liveExecutionVenue: venue.liveExecutionVenue,
      platform: venue.platform,
      lightSocketRole: venue.lightSocketRole,
      deepSocketRole: venue.deepSocketRole,
      maxControlCommandsPerSec: venue.maxControlCommandsPerSec,
      officialMaxControlCommandsPerSec: venue.officialMaxControlCommandsPerSec,
    },
    aiPolicy: policy.ai,
    tdiPolicy: policy.tdi,
    riskMode: "CANONICAL_PRETRADE_RISK_GATE",
    universe: {
      scannerUniverse: env.SCANNER_UNIVERSE,
      maxSymbols: env.SCANNER_MAX_SYMBOLS,
      maxCycleSec: env.SCANNER_MAX_CYCLE_SEC,
    },
    aiMode: {
      executionMode: env.EXECUTION_MODE,
      minConfidence: env.AI_MIN_CONFIDENCE,
      strictAnalystMode: env.AI_STRICT_ANALYST_MODE,
      remoteRequired: Boolean(env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY || env.GEMINI_API_KEY),
    },
    strategyConfig: runtime?.trade ?? {},
    evConfig: {
      minRiskRewardRatio: env.EXECUTION_MIN_RR_RATIO,
      minTradeQualityScore: env.EXECUTION_MIN_TRADE_QUALITY_SCORE,
    },
    risk: runtime?.risk ?? {
      maxDailyLossPercent: env.RISK_MAX_DAILY_LOSS_PERCENT,
      maxOpenPositions: env.EXECUTION_MAX_OPEN_POSITIONS,
    },
    sizing: runtime?.trade ?? {},
    fees: {
      binanceTakerFeeRate: env.BINANCE_TAKER_FEE_RATE,
      binanceMakerFeeRate: env.BINANCE_MAKER_FEE_RATE,
    },
    simulationWindow: {
      autoRoundSelectionBudgetSec: env.AUTO_ROUND_SELECTION_BUDGET_SEC,
      autoRoundMaxWaitSecDefault: env.AUTO_ROUND_MAX_WAIT_SEC,
    },
    maxPositions: env.EXECUTION_MAX_OPEN_POSITIONS ?? 1,
    timeframes: ["1m", "5m", "15m", "1h", "4h"],
  };
}
