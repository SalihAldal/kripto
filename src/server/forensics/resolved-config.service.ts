import { env } from "@/lib/config";
import { getRuntimeStrategyParams } from "@/src/server/config/strategy-runtime.service";
import type { ResolvedConfigSnapshot } from "@/src/server/forensics/forensic.types";

export async function resolveRuntimeConfigSnapshot(userId?: string): Promise<ResolvedConfigSnapshot> {
  const runtime = userId ? await getRuntimeStrategyParams(userId).catch(() => null) : null;
  return {
    generatedAt: new Date().toISOString(),
    exchange: env.EXCHANGE_PROVIDER ?? "binance-tr",
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
