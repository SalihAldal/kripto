import type { AIProviderAdapter } from "@/src/server/ai/provider.interface";
import { analyzeWithRemoteModel } from "@/src/server/ai/providers/remote-llm";
import type { AIAnalysisInput, AIModelOutput, AIProviderConfig } from "@/src/types/ai";
import { clampScore } from "@/src/server/ai/utils";
import { buildStandardizedOutput } from "@/src/server/ai/providers/standardized-output";

function createContextSpecialistOutput(input: AIAnalysisInput, provider: string): AIModelOutput {
  const change24h = Number(input.marketSignals?.change24h ?? 0);
  const shortMomentum = Number(input.marketSignals?.shortMomentumPercent ?? 0);
  const shortFlow = Number(input.marketSignals?.shortFlowImbalance ?? 0);
  const tradeVelocity = Number(input.marketSignals?.tradeVelocity ?? 0);
  const btcDominanceBias = Number(input.marketSignals?.btcDominanceBias ?? 0);
  const social = Number(input.marketSignals?.socialSentimentScore ?? 50);
  const newsBias = input.marketSignals?.newsSentiment ?? "NEUTRAL";
  const buySellRatio = Number(input.recentTradesSummary.buySellRatio ?? 1);
  const orderbookSkew =
    (input.orderBookSummary.bidDepth - input.orderBookSummary.askDepth) /
    Math.max(input.orderBookSummary.bidDepth + input.orderBookSummary.askDepth, 1);

  const momentumRaw =
    shortMomentum * 60 +
    shortFlow * 45 +
    (buySellRatio - 1) * 30 +
    orderbookSkew * 22 +
    tradeVelocity * 4 +
    change24h * 1.1;
  const momentumStrength = clampScore(50 + momentumRaw);
  const suddenSpike = Math.abs(change24h) > 8 || Math.abs(shortMomentum) > 0.95;
  const lowLiquidity = input.volume24h < 800_000;
  const hypeRisk = clampScore(
    Math.max(0, (social - 70) * 1.6) +
    Math.max(0, Math.abs(change24h) - 6) * 3 +
    (lowLiquidity ? 18 : 0) +
    (tradeVelocity > 2.6 ? 12 : 0),
  );
  const sustainabilityScore = clampScore(
    momentumStrength * 0.6 +
    (lowLiquidity ? -18 : 6) +
    (input.spread > 0.18 ? -14 : 4) +
    (newsBias === "POSITIVE" ? 8 : newsBias === "NEGATIVE" ? -10 : 0) +
    (hypeRisk > 72 ? -16 : 0),
  );
  const marketContext = btcDominanceBias > 0.35
    ? "BTC dominance yuksek, altcoin riskli"
    : btcDominanceBias < -0.2
      ? "Altcoin market appetite guclu"
      : "Piyasa dengeli/range";
  const coinSentiment = newsBias === "POSITIVE"
    ? "Pozitif momentum bias"
    : newsBias === "NEGATIVE"
      ? "Negatif haber/momentum baskisi"
      : momentumStrength >= 62
        ? "Haber notr, momentum destekli"
        : "Nötr-zayif baglam";
  const marketAlignment = clampScore(
    50 + shortFlow * 30 + orderbookSkew * 20 - Math.max(0, btcDominanceBias) * 18,
  );
  const redFlags: string[] = [];
  if (lowLiquidity) redFlags.push("Dusuk hacim / zayif derinlik");
  if (input.volatility > 3.2) redFlags.push("Asiri volatilite");
  if (hypeRisk >= 70) redFlags.push("Asiri hype / FOMO riski");
  if (suddenSpike && newsBias === "NEUTRAL") redFlags.push("Haber desteksiz ani spike");
  if (newsBias === "NEGATIVE") redFlags.push("Negatif haber bias");
  if (Math.abs(shortFlow) < 0.03 && tradeVelocity > 2) redFlags.push("Hacimsiz gürültü hareketi");

  const tradeSupportive =
    redFlags.length < 2 &&
    momentumStrength >= 58 &&
    sustainabilityScore >= 55 &&
    marketAlignment >= 50;
  const decision =
    !tradeSupportive ? "NO_TRADE" : momentumStrength >= 72 ? "BUY" : momentumStrength <= 35 ? "SELL" : "HOLD";
  const confidence = clampScore((momentumStrength * 0.42) + (sustainabilityScore * 0.38) + (marketAlignment * 0.2));
  const summary =
    tradeSupportive
      ? "Momentum ve duyarlilik destekli; hype kontrolu kabul edilebilir."
      : `No-support: ${redFlags.join(" | ") || "baglam belirsiz"}`;
  const timeframeAlignment = input.multiTimeframe
    ? {
        higherTimeframeTrend: input.multiTimeframe.higher.trend,
        midTimeframeStructure: input.multiTimeframe.mid.structure,
        lowerTimeframeEntryQuality: input.multiTimeframe.lower.entryQuality,
        timeframeAlignmentScore: input.multiTimeframe.alignmentScore,
        conflictingSignals: input.multiTimeframe.conflictingSignals,
        finalAlignmentSummary: input.multiTimeframe.finalAlignmentSummary,
      }
    : null;

  return {
    decision,
    confidence,
    targetPrice: null,
    stopPrice: null,
    estimatedDurationSec: 180,
    reasoningShort: `${provider}: haber-momentum-duyarlilik baglam analizi tamamlandi.`,
    riskScore: clampScore(100 - sustainabilityScore + hypeRisk * 0.2),
    standardizedOutput: buildStandardizedOutput({
      analysisInput: input,
      decision,
      confidenceScore: confidence,
      coreThesis: "Market context, momentum quality and sentiment sustainability were evaluated together.",
      bullishFactors: [
        momentumStrength >= 62 ? "Momentum strength supportive" : "",
        sustainabilityScore >= 60 ? "Sustainability healthy" : "",
        marketAlignment >= 55 ? "Market alignment positive" : "",
      ].filter(Boolean),
      bearishFactors: [
        newsBias === "NEGATIVE" ? "Negative news pressure" : "",
        hypeRisk >= 70 ? "Hype risk elevated" : "",
        lowLiquidity ? "Liquidity weak" : "",
      ].filter(Boolean),
      riskFlags: redFlags,
      noTradeTriggers: tradeSupportive
        ? []
        : [
            "momentum_context_not_supportive",
            ...redFlags.map((x) => x.toLowerCase().replace(/\s+/g, "_")),
          ].slice(0, 8),
      explanationSummary: summary,
    }),
    metadata: {
      remote: false,
      contextSpecialist: true,
      symbol: input.symbol,
      marketContext,
      coinSentiment,
      momentumStrengthScore: momentumStrength,
      newsBias: newsBias.toLowerCase(),
      hypeRisk,
      sustainabilityScore,
      marketAlignment,
      redFlags,
      tradeSupportive,
      summary,
      timeframeAlignment,
      policy: {
        noTechnicalEntrySelection: true,
        noStandaloneOrder: true,
        noRiskApproval: true,
        honestNoNewsMode: newsBias === "NEUTRAL",
      },
    },
  };
}

export class Provider2Adapter implements AIProviderAdapter {
  readonly config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
  }

  async analyzeTechnicalSignal(input: AIAnalysisInput): Promise<AIModelOutput> {
    const specialist = createContextSpecialistOutput(input, this.config.name);
    const remote = await analyzeWithRemoteModel(this.config, input, "technical");
    if (!remote) return specialist;
    return {
      ...specialist,
      confidence: clampScore(specialist.confidence * 0.75 + remote.confidence * 0.25),
      riskScore: clampScore(specialist.riskScore * 0.8 + remote.riskScore * 0.2),
      metadata: {
        ...specialist.metadata,
        remote: true,
        remoteEnrichmentUsed: true,
        remoteDecision: remote.decision,
        remoteConfidence: remote.confidence,
      },
    };
  }

  async analyzeMomentumSignal(input: AIAnalysisInput): Promise<AIModelOutput> {
    const remote = await analyzeWithRemoteModel(this.config, input, "momentum");
    const specialist = createContextSpecialistOutput(input, this.config.name);
    if (!remote) return specialist;
    return {
      ...specialist,
      confidence: clampScore(specialist.confidence * 0.7 + remote.confidence * 0.3),
      riskScore: clampScore(specialist.riskScore * 0.8 + remote.riskScore * 0.2),
      metadata: {
        ...specialist.metadata,
        remote: true,
        remoteEnrichmentUsed: true,
        remoteDecision: remote.decision,
        remoteConfidence: remote.confidence,
      },
    };
  }

  async analyzeRiskAssessment(input: AIAnalysisInput): Promise<AIModelOutput> {
    const remote = await analyzeWithRemoteModel(this.config, input, "risk");
    const specialist = createContextSpecialistOutput(input, this.config.name);
    if (!remote) return specialist;
    return {
      ...specialist,
      confidence: clampScore(specialist.confidence * 0.75 + remote.confidence * 0.25),
      riskScore: clampScore(specialist.riskScore * 0.75 + remote.riskScore * 0.25),
      metadata: {
        ...specialist.metadata,
        remote: true,
        remoteEnrichmentUsed: true,
        remoteDecision: remote.decision,
        remoteConfidence: remote.confidence,
      },
    };
  }
}
