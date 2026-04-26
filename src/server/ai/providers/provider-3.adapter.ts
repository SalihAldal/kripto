import type { AIProviderAdapter } from "@/src/server/ai/provider.interface";
import { analyzeWithRemoteModel } from "@/src/server/ai/providers/remote-llm";
import type { AIAnalysisInput, AIModelOutput, AIProviderConfig } from "@/src/types/ai";
import { clampScore } from "@/src/server/ai/utils";
import { buildIndicatorSnapshot } from "@/src/server/ai/indicator-suite";
import { buildStandardizedOutput } from "@/src/server/ai/providers/standardized-output";

function readParamNumber(input: AIAnalysisInput, key: string): number | null {
  const value = input.strategyParams?.[key];
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function readParamBoolean(input: AIAnalysisInput, key: string): boolean | null {
  const value = input.strategyParams?.[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return null;
}

function buildRiskManagerOutput(input: AIAnalysisInput, provider: string): AIModelOutput {
  const ind = buildIndicatorSnapshot(input);
  const vetoReasonList: string[] = [];
  const cautionList: string[] = [];
  let riskExposure = 24;

  const dynamicStopPercent = Math.max(0.35, input.volatility * 0.55 + input.spread * 2.1);
  const targetPercent = Math.max(0.45, Math.abs(Number(input.marketSignals?.change24h ?? 0)) * 0.24 + 0.55);
  const rr = targetPercent / Math.max(dynamicStopPercent, 0.01);

  if (rr < 1.2) {
    riskExposure += 18;
    vetoReasonList.push(`Risk/odul zayif (rr=${rr.toFixed(2)})`);
  } else if (rr < 1.5) {
    riskExposure += 9;
    cautionList.push(`Risk/odul sinirda (rr=${rr.toFixed(2)})`);
  } else if (rr > 2.4) {
    riskExposure -= 4;
  }

  if (input.spread > 0.2) {
    riskExposure += 16;
    vetoReasonList.push(`Spread asiri (${input.spread.toFixed(4)}%)`);
  } else if (input.spread > 0.12) {
    riskExposure += 9;
    cautionList.push(`Spread yuksek (${input.spread.toFixed(4)}%)`);
  }

  if (input.volatility > 3.4) {
    riskExposure += 18;
    vetoReasonList.push(`Volatilite kaotik (${input.volatility.toFixed(3)}%)`);
  } else if (input.volatility > 2.2) {
    riskExposure += 8;
    cautionList.push(`Volatilite yuksek (${input.volatility.toFixed(3)}%)`);
  }

  if (input.volume24h < 700_000) {
    riskExposure += 16;
    vetoReasonList.push(`Hacim yetersiz (${input.volume24h.toFixed(2)})`);
  } else if (input.volume24h < 1_400_000) {
    riskExposure += 7;
    cautionList.push("Hacim sinirda");
  }

  if (ind.liquidity.fakeBreakoutDetected || ind.fakeBreakout) {
    riskExposure += 14;
    vetoReasonList.push("Fake breakout riski yuksek");
  }
  if (ind.liquidity.stopHuntDetected) {
    riskExposure += 9;
    cautionList.push("Stop hunt sonrasi ters spike riski");
  }

  const social = Number(input.marketSignals?.socialSentimentScore ?? 50);
  const shortMomentum = Number(input.marketSignals?.shortMomentumPercent ?? 0);
  const velocity = Number(input.marketSignals?.tradeVelocity ?? 0);
  if (social > 78 && shortMomentum > 0.8 && velocity > 2) {
    riskExposure += 12;
    cautionList.push("FOMO/hype kaynakli gec kalinmis giris riski");
  }

  const openPositionCount =
    readParamNumber(input, "openPositionCount") ??
    (readParamBoolean(input, "hasOpenPosition") ? 1 : 0);
  if (openPositionCount > 0) {
    riskExposure += 30;
    vetoReasonList.push("Acik pozisyon varken yeni islem yasak");
  }

  const sameCoinCooldownActive =
    readParamBoolean(input, "sameCoinCooldownActive") ??
    ((readParamNumber(input, "sameCoinLossStreak") ?? 0) > 0);
  if (sameCoinCooldownActive) {
    riskExposure += 14;
    vetoReasonList.push("Ayni coin cooldown aktif");
  }

  const capitalRiskPercent = readParamNumber(input, "capitalRiskPercent") ?? (input.riskSettings?.maxRiskPerTrade ?? null);
  if (capitalRiskPercent !== null && capitalRiskPercent > 2.6) {
    riskExposure += 12;
    cautionList.push(`Sermaye riski yuksek (%${capitalRiskPercent.toFixed(2)})`);
  }

  const regime = input.marketRegime?.mode ?? "RANGE_SIDEWAYS";
  if (regime === "HIGH_VOLATILITY_CHAOS" || regime === "NEWS_DRIVEN_UNSTABLE") {
    riskExposure += 12;
    vetoReasonList.push("Piyasa kaotik rejimde");
  }
  if (regime === "LOW_VOLUME_DEAD_MARKET") {
    riskExposure += 14;
    vetoReasonList.push("Likidite zayif rejim");
  }

  const newsBias = input.marketSignals?.newsSentiment ?? "NEUTRAL";
  if (newsBias === "NEGATIVE") {
    riskExposure += 10;
    cautionList.push("Negatif haber bias");
  } else if (newsBias === "NEUTRAL") {
    cautionList.push("Dogrulanmis haber sinyali yok (notr)");
  }

  const minNotionalOk = readParamBoolean(input, "minNotionalOk");
  const lotSizeOk = readParamBoolean(input, "lotSizeOk");
  const quantityOk = readParamBoolean(input, "quantityOk");
  const feeNetOk = readParamBoolean(input, "feeNetAmountOk");
  if (minNotionalOk === false || lotSizeOk === false || quantityOk === false || feeNetOk === false) {
    riskExposure += 22;
    vetoReasonList.push("Emir guvenligi filtresi gecilemedi");
  } else if ([minNotionalOk, lotSizeOk, quantityOk, feeNetOk].some((x) => x === null)) {
    riskExposure += 4;
    cautionList.push("Order filter dogrulama bilgisi eksik");
  }

  const riskScore = clampScore(riskExposure);
  const reject = vetoReasonList.length > 0 || riskScore >= 72;
  const caution = !reject && (riskScore >= 52 || cautionList.length >= 2);
  const approveRejectCaution = reject ? "REJECT" : caution ? "CAUTION" : "APPROVE";
  const decision = reject ? "NO_TRADE" : "HOLD";
  const portfolioSafetyStatus =
    openPositionCount > 0 ? "BLOCKED_OPEN_POSITION" : sameCoinCooldownActive ? "COOLDOWN_ACTIVE" : "CLEAR";
  const positionSizingSuggestion =
    reject
      ? {
          mode: "BLOCK_NEW_POSITION",
          suggestedCapitalPercent: 0,
          note: "Veto aktif. Yeni pozisyon acilmaz.",
        }
      : caution
        ? {
            mode: "REDUCED_RISK",
            suggestedCapitalPercent: 0.6,
            note: "Daha kucuk lot + teyit bekle.",
          }
        : {
            mode: "NORMAL_RISK",
            suggestedCapitalPercent: 1,
            note: "Standart risk limiti ile devam.",
          };
  const stopSafetyCheck =
    dynamicStopPercent > 2 ? "STOP_TOO_WIDE" : dynamicStopPercent < 0.3 ? "STOP_TOO_TIGHT" : "STOP_BALANCED";
  const takeProfitRealism =
    rr < 1.2 ? "UNREALISTIC" : rr < 1.5 ? "WEAK_EDGE" : rr > 3 ? "OVERSTRETCHED" : "REALISTIC";
  const confidence = clampScore(100 - riskScore * 0.72 + (reject ? 8 : 0));
  const finalRiskSummary = reject
    ? `Risk veto: ${vetoReasonList.join(" | ")}`
    : caution
      ? `Risk caution: ${cautionList.slice(0, 4).join(" | ")}`
      : "Risk profili kontrollu, veto yok.";
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
    reasoningShort: `${provider}: koruyucu risk denetimi tamamlandi (${approveRejectCaution}).`,
    riskScore,
    standardizedOutput: buildStandardizedOutput({
      analysisInput: input,
      decision,
      confidenceScore: confidence,
      coreThesis: "Protective risk audit evaluated execution safety before allowing any trade.",
      bullishFactors: approveRejectCaution === "APPROVE" ? ["Risk exposure controlled", "Portfolio safety clear"] : [],
      bearishFactors: [
        approveRejectCaution === "REJECT" ? "Hard veto conditions detected" : "",
        approveRejectCaution === "CAUTION" ? "Caution mode active" : "",
      ].filter(Boolean),
      riskFlags: [...vetoReasonList, ...cautionList].slice(0, 8),
      noTradeTriggers: reject
        ? ["risk_veto_active", ...vetoReasonList.map((x) => x.toLowerCase().replace(/\s+/g, "_"))].slice(0, 8)
        : [],
      explanationSummary: finalRiskSummary,
    }),
    metadata: {
      remote: false,
      riskManager: true,
      symbol: input.symbol,
      riskScore,
      riskScoreDefinition: "0-100 risk exposure. Yuksek skor daha tehlikeli ve veto olasiligi daha yuksek.",
      approveRejectCaution,
      positionSizingSuggestion,
      stopSafetyCheck,
      takeProfitRealism,
      portfolioSafetyStatus,
      vetoReasonList,
      finalRiskSummary,
      timeframeAlignment,
      cautionList: cautionList.slice(0, 6),
      checks: {
        rrRatio: Number(rr.toFixed(4)),
        dynamicStopPercent: Number(dynamicStopPercent.toFixed(4)),
        targetPercent: Number(targetPercent.toFixed(4)),
        spreadPercent: input.spread,
        volatilityPercent: input.volatility,
        volume24h: input.volume24h,
        openPositionCount,
        sameCoinCooldownActive,
      },
      policy: {
        protectiveMode: true,
        blindApprovalDisabled: true,
        uncertaintyDefaultsToNoTrade: true,
      },
    },
  };
}

export class Provider3Adapter implements AIProviderAdapter {
  readonly config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
  }

  async analyzeTechnicalSignal(input: AIAnalysisInput): Promise<AIModelOutput> {
    const specialist = buildRiskManagerOutput(input, this.config.name);
    const remote = await analyzeWithRemoteModel(this.config, input, "risk");
    if (!remote) return specialist;
    return {
      ...specialist,
      confidence: clampScore(specialist.confidence * 0.78 + remote.confidence * 0.22),
      riskScore: clampScore(specialist.riskScore * 0.82 + remote.riskScore * 0.18),
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
    const specialist = buildRiskManagerOutput(input, this.config.name);
    const remote = await analyzeWithRemoteModel(this.config, input, "risk");
    if (!remote) return specialist;
    return {
      ...specialist,
      confidence: clampScore(specialist.confidence * 0.76 + remote.confidence * 0.24),
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
    const specialist = buildRiskManagerOutput(input, this.config.name);
    const remote = await analyzeWithRemoteModel(this.config, input, "risk");
    if (!remote) return specialist;
    return {
      ...specialist,
      confidence: clampScore(specialist.confidence * 0.75 + remote.confidence * 0.25),
      riskScore: clampScore(specialist.riskScore * 0.78 + remote.riskScore * 0.22),
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
