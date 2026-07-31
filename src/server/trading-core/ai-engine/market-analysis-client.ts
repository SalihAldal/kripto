import { logger } from "@/lib/logger";
import { tradingConfig } from "@/src/server/trading-core/config";
import type { SignalDecision } from "@/src/server/trading-core/core/types";
import { tradingDomainLogger } from "@/src/server/trading-core/observability/domain-logger";

export type MarketAnalysisClientInput = {
  symbol: string;
  rsi: number;
  macd: number;
  macdSignal: number;
  emaFast: number;
  emaSlow: number;
  volume: number;
  volumeAvg: number;
  fundingRate?: number;
  openInterest?: number;
  openInterestChangePercent?: number;
  liquidationHeatmapScore?: number;
  btcDominance?: number;
  volatility?: number;
  signalSide: "BUY" | "SELL" | "HOLD";
  confidenceThreshold?: number;
};

export type MarketAnalysisClientOutput = {
  symbol: string;
  trade_confidence_score: number;
  passed: boolean;
  market_regime: string;
  trend_direction: string;
  risk_level: string;
  model_name: string;
  reasons: string[];
  engineered_features: Record<string, number>;
};

export class MarketAnalysisClient {
  constructor(
    private readonly baseUrl?: string,
    private readonly timeoutMs?: number,
  ) {}

  async analyze(input: MarketAnalysisClientInput): Promise<MarketAnalysisClientOutput | null> {
    const controller = new AbortController();
    const timeoutMs = this.timeoutMs ?? tradingConfig.getGlobal("aiTimeoutMs");
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    try {
      const baseUrl = this.baseUrl ?? tradingConfig.getGlobal("aiServiceUrl");
      const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/analyze`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          features: {
            symbol: input.symbol,
            rsi: input.rsi,
            macd: input.macd,
            macd_signal: input.macdSignal,
            ema_fast: input.emaFast,
            ema_slow: input.emaSlow,
            volume: input.volume,
            volume_avg: input.volumeAvg,
            funding_rate: input.fundingRate ?? 0,
            open_interest: input.openInterest ?? 0,
            open_interest_change_percent: input.openInterestChangePercent ?? 0,
            liquidation_heatmap_score: input.liquidationHeatmapScore ?? 0,
            btc_dominance: input.btcDominance ?? 50,
            volatility: input.volatility ?? 0,
            signal_side: input.signalSide,
          },
          confidence_threshold: input.confidenceThreshold ?? tradingConfig.getGlobal("aiConfidenceThreshold"),
        }),
      });
      if (!response.ok) throw new Error(`Market analysis HTTP ${response.status}`);
      const analysis = (await response.json()) as MarketAnalysisClientOutput;
      tradingDomainLogger.aiPrediction({
        symbol: input.symbol,
        provider: analysis.model_name,
        confidence: analysis.trade_confidence_score,
        decision: analysis.passed ? "PASSED" : "FILTERED",
        latencyMs: Date.now() - startedAt,
        context: { marketRegime: analysis.market_regime, riskLevel: analysis.risk_level },
      });
      return analysis;
    } catch (error) {
      logger.warn({ error: (error as Error).message }, "Market analysis service unavailable");
      tradingDomainLogger.aiPrediction({
        symbol: input.symbol,
        provider: "market-analysis-service",
        confidence: 0,
        decision: "UNAVAILABLE",
        latencyMs: Date.now() - startedAt,
        context: { error: (error as Error).message },
      });
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async filterSignal(signal: SignalDecision): Promise<SignalDecision> {
    const first = signal.strategySignals[0]?.indicators;
    if (!first) return signal;
    const analysis = await this.analyze({
      symbol: signal.symbol,
      rsi: first.rsi ?? 50,
      macd: first.macd?.macd ?? 0,
      macdSignal: first.macd?.signal ?? 0,
      emaFast: first.emaFast ?? 1,
      emaSlow: first.emaSlow ?? 1,
      volume: first.volumeSpike?.currentVolume ?? 0,
      volumeAvg: first.volumeSpike?.averageVolume ?? 0,
      volatility: first.volumeSpike?.ratio ?? 0,
      signalSide: signal.side,
    });
    if (!analysis) return signal;
    if (!analysis.passed) {
      return {
        ...signal,
        side: "HOLD",
        reasons: [...signal.reasons, ...analysis.reasons],
      };
    }
    return {
      ...signal,
      confidence: Math.min(100, Math.max(signal.confidence, analysis.trade_confidence_score)),
      reasons: [...signal.reasons, `ML filter passed: ${analysis.model_name}`],
    };
  }
}
