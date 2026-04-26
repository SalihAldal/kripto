import { env } from "@/lib/config";
import { getActiveStrategyConfig } from "@/src/server/config/strategy-config.service";

export type RuntimeStrategyParams = {
  aiScoreThreshold: number;
  technicalMinScore: number;
  sentimentMinScore: number;
  riskVetoLevel: number;
  consensusMinScore: number;
  noTradeThreshold: number;
  minVolume24h: number;
  maxSpreadPercent: number;
  maxVolatilityPercent: number;
};

const FALLBACK_RUNTIME_PARAMS: RuntimeStrategyParams = {
  aiScoreThreshold: env.AI_MIN_CONFIDENCE,
  technicalMinScore: env.AI_HYBRID_MIN_TECH_SCORE,
  sentimentMinScore: env.AI_HYBRID_MIN_SENTIMENT_SCORE,
  riskVetoLevel: env.AI_MAX_RISK_SCORE,
  consensusMinScore: env.EXECUTION_MIN_TRADE_QUALITY_SCORE,
  noTradeThreshold: 45,
  minVolume24h: env.SCANNER_MIN_VOLUME_24H,
  maxSpreadPercent: env.SCANNER_MAX_SPREAD_PERCENT,
  maxVolatilityPercent: env.AI_HYBRID_MAX_VOLATILITY_PERCENT,
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export async function getRuntimeStrategyParams(): Promise<RuntimeStrategyParams> {
  try {
    const active = await getActiveStrategyConfig();
    const cfg = active.config;
    return {
      aiScoreThreshold: clamp(Number(cfg.ai.aiScoreThreshold ?? FALLBACK_RUNTIME_PARAMS.aiScoreThreshold), 0, 100),
      technicalMinScore: clamp(Number(cfg.ai.technicalMinScore ?? FALLBACK_RUNTIME_PARAMS.technicalMinScore), 0, 100),
      sentimentMinScore: clamp(Number(cfg.ai.newsMinScore ?? FALLBACK_RUNTIME_PARAMS.sentimentMinScore), 0, 100),
      riskVetoLevel: clamp(Number(cfg.ai.riskVetoLevel ?? FALLBACK_RUNTIME_PARAMS.riskVetoLevel), 0, 100),
      consensusMinScore: clamp(Number(cfg.ai.consensusMinScore ?? FALLBACK_RUNTIME_PARAMS.consensusMinScore), 0, 100),
      noTradeThreshold: clamp(Number(cfg.ai.noTradeThreshold ?? FALLBACK_RUNTIME_PARAMS.noTradeThreshold), 0, 100),
      minVolume24h: Math.max(0, Number(cfg.coinFilter.minVolume24h ?? FALLBACK_RUNTIME_PARAMS.minVolume24h)),
      maxSpreadPercent: Math.max(0.01, Number(cfg.coinFilter.maxSpreadPercent ?? FALLBACK_RUNTIME_PARAMS.maxSpreadPercent)),
      maxVolatilityPercent: Math.max(
        0.1,
        Number(cfg.coinFilter.maxVolatilityPercent ?? FALLBACK_RUNTIME_PARAMS.maxVolatilityPercent),
      ),
    };
  } catch {
    return FALLBACK_RUNTIME_PARAMS;
  }
}
