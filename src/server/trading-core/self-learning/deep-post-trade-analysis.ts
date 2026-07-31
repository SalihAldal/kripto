import { createProviderAdapter } from "@/src/server/ai/provider-factory";
import { getProviderConfigs } from "@/src/server/ai/provider-registry";
import { buildAIInput } from "@/src/server/ai";
import type { LearningNumericFeature } from "@/src/server/metrics/setup-feature-utils";
import type { LearningMarketEvidenceSnapshot } from "@/src/server/trading-core/self-learning/market-evidence-archive";
import type { DeepPostTradeAnalysis, LearningOutcome } from "@/src/server/trading-core/self-learning/self-learning-types";
import { detectRegimeMismatch, type RegimeCompatibilityAnalysis } from "@/src/server/trading-core/self-learning/regime-mismatch-detector";

type DeepAnalysisInput = {
  symbol: string;
  side: "BUY" | "SELL";
  outcome: LearningOutcome;
  entryPrice: number;
  exitPrice: number;
  returnPercent: number;
  realizedPnl: number;
  targetProfitPercent?: number;
  stopLossPercent?: number;
  maxDurationSec?: number;
  holdSec?: number;
  closeReason?: string;
  strategy?: string;
  entryLogic?: string;
  marketRegime?: string;
  historicalRegimeExpectancyPercent?: number;
  qualityScore?: number;
  criticGrade?: "A" | "B" | "C" | "D" | "F";
  criticVerdict?: "SCALE_UP" | "KEEP_TESTING" | "TIGHTEN_FILTERS" | "PAUSE_SETUP";
  patternStatus?: string;
  features: string[];
  numericFeatures: LearningNumericFeature[];
  marketEvidence?: LearningMarketEvidenceSnapshot;
  metadata: Record<string, unknown>;
};

function num(input: DeepAnalysisInput, key: string) {
  return input.numericFeatures.find((row) => row.key === key)?.value;
}

function tag(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_").replace(/_+/g, "_").slice(0, 72);
}

function sentence(parts: string[]) {
  return parts.filter(Boolean).join(" ");
}

function fmt(value: number, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function hasFeature(input: DeepAnalysisInput, value: string) {
  return input.features.some((feature) => feature.toLowerCase() === value.toLowerCase());
}

function classify(input: DeepAnalysisInput) {
  const shortMomentum = num(input, "shortMomentum") ?? 0;
  const shortFlow = num(input, "shortFlow") ?? 0;
  const spread = num(input, "spreadPercent") ?? 0;
  const volatility = num(input, "volatilityPercent") ?? 0;
  const orderBook = num(input, "orderBookImbalance") ?? 0;
  const fakeSpike = num(input, "fakeSpikeScore") ?? 0;
  const pumpRisk = num(input, "pumpRisk") ?? 0;
  const pumpIntensity = num(input, "pumpIntensity") ?? 0;
  const volumeSpike = num(input, "volumeSpikePercent") ?? 0;
  const momentumBreakoutScore = num(input, "momentumBreakoutScore") ?? 0;
  const momentumBreakoutOk = (num(input, "momentumBreakoutOk") ?? 0) >= 1 || hasFeature(input, "momentum_breakout:yes");
  const momentumBreakoutStage = input.features.find((feature) => feature.startsWith("momentum_stage:"))?.split(":").slice(1).join(":") ?? "unknown";
  const momentumBreakoutLate = momentumBreakoutStage === "late";
  const mtf = num(input, "mtfAlignment") ?? 0;
  const rr = num(input, "rrRatio") ?? 0;
  const quality = input.qualityScore ?? num(input, "qualityScore") ?? 0;
  const evidence = input.marketEvidence?.summary;
  const fundingRate = evidence?.fundingRate ?? num(input, "fundingRate") ?? 0;
  const openInterest = evidence?.openInterest ?? num(input, "openInterest") ?? 0;
  const liquidationImbalance = evidence?.liquidationImbalance ?? num(input, "liquidationImbalance") ?? 0;
  const futuresRiskScore = num(input, "futuresRiskScore") ?? 0;
  const leveragedTrapProbability = num(input, "leveragedTrapProbability") ?? 0;
  const squeezeProbability = num(input, "squeezeProbability") ?? 0;
  const newsNegative = evidence?.newsSentiment === "NEGATIVE" || evidence?.macroHighImpactNews === true;
  const profitable = input.outcome === "WIN";
  const weakProfit = input.returnPercent > 0 && input.returnPercent < 0.5;
  const directionalFlowBad =
    input.side === "BUY"
      ? shortMomentum < -0.04 || shortFlow < -0.03 || orderBook < -0.25
      : shortMomentum > 0.04 || shortFlow > 0.03 || orderBook > 0.25;
  const manipulationHigh = fakeSpike >= 1.8 || pumpRisk >= 60 || (pumpIntensity >= 65 && volumeSpike >= 120);
  const momentumOpportunity = momentumBreakoutOk && momentumBreakoutScore >= 42;
  const structureWeak = mtf > 0 && mtf < 45;
  const riskBad = rr > 0 && rr < 1.6;
  const marketHostile = volatility >= 3 || spread >= 0.18;
  const futuresRisk =
    Math.abs(fundingRate) >= 0.0008 ||
    Math.abs(liquidationImbalance) >= 0.45 ||
    futuresRiskScore >= 70 ||
    leveragedTrapProbability >= 70 ||
    squeezeProbability >= 75 ||
    newsNegative;
  let deterministicScore = 50;
  deterministicScore += profitable ? 22 : input.outcome === "BREAKEVEN" ? 2 : -24;
  deterministicScore += directionalFlowBad ? -18 : 8;
  deterministicScore += manipulationHigh ? -16 : 4;
  deterministicScore += momentumOpportunity && !momentumBreakoutLate ? 10 : momentumBreakoutLate ? -6 : 0;
  deterministicScore += structureWeak ? -12 : 4;
  deterministicScore += riskBad ? -10 : 4;
  deterministicScore += marketHostile ? -8 : 2;
  deterministicScore += futuresRisk ? -8 : 3;
  deterministicScore += quality >= 70 ? 8 : quality > 0 && quality < 50 ? -8 : 0;
  deterministicScore = Math.max(0, Math.min(100, Number(deterministicScore.toFixed(2))));
  return {
    shortMomentum,
    shortFlow,
    spread,
    volatility,
    orderBook,
    fakeSpike,
    pumpRisk,
    pumpIntensity,
    volumeSpike,
    momentumBreakoutScore,
    momentumBreakoutOk,
    momentumBreakoutStage,
    momentumOpportunity,
    momentumBreakoutLate,
    mtf,
    rr,
    quality,
    fundingRate,
    openInterest,
    liquidationImbalance,
    newsNegative,
    weakProfit,
    directionalFlowBad,
    manipulationHigh,
    structureWeak,
    riskBad,
    marketHostile,
    futuresRisk,
    futuresRiskScore,
    leveragedTrapProbability,
    squeezeProbability,
    deterministicScore,
  };
}

function isQualityRejected(input: DeepAnalysisInput) {
  return (
    hasFeature(input, "quality:reject") ||
    hasFeature(input, "confirm:rejected") ||
    String(input.metadata.qualityDecision ?? "").toLowerCase().includes("reject")
  );
}

function isCriticPaused(input: DeepAnalysisInput) {
  return (
    input.criticGrade === "F" ||
    input.criticVerdict === "PAUSE_SETUP" ||
    String(input.patternStatus ?? "").toUpperCase() === "BLACKLISTED"
  );
}

function resolveRegimeCompatibility(input: DeepAnalysisInput, c: ReturnType<typeof classify>) {
  return detectRegimeMismatch({
    strategy: input.strategy ?? String(input.metadata.marketRegimeStrategy ?? input.metadata.strategy ?? ""),
    entryLogic: input.entryLogic ?? String(input.metadata.entryType ?? input.metadata.recommendedEntryType ?? ""),
    marketRegime: input.marketRegime,
    regimeConfidence: num(input, "marketRegimeConfidence") ?? Number(input.metadata.marketRegimeConfidenceScore ?? NaN),
    volatilityPercent: c.volatility,
    momentumPercent: c.shortMomentum,
    shortMomentumPercent: c.shortMomentum,
    liquidityDepth: Number(input.metadata.effectiveLiquidity24h ?? input.metadata.volume24h ?? NaN),
    spreadPercent: c.spread,
    fundingRate: c.fundingRate,
    openInterest: c.openInterest,
    liquidationImbalance: c.liquidationImbalance,
    fakeSpikeScore: c.fakeSpike,
    pumpRisk: c.pumpRisk,
    mtfAlignment: c.mtf,
    executionTiming: String(input.metadata.safeEntryTiming ?? input.metadata.executionAction ?? input.closeReason ?? ""),
    historicalExpectancyPercent: input.historicalRegimeExpectancyPercent,
  });
}

function resolveTradeQuality(
  score: number,
  input: DeepAnalysisInput,
  aiVerdict: DeepPostTradeAnalysis["aiVerdict"] = "NOT_AVAILABLE",
): DeepPostTradeAnalysis["tradeQuality"] {
  const qualityRejected = isQualityRejected(input);
  const criticPaused = isCriticPaused(input);
  const aiConfirmedRisk = aiVerdict === "CONFIRMED_RISK";
  if (input.outcome === "LOSS" && (criticPaused || qualityRejected || aiConfirmedRisk || score <= 45)) {
    return score <= 28 || criticPaused ? "DANGEROUS" : "WEAK";
  }
  if (criticPaused || (qualityRejected && aiConfirmedRisk)) return "WEAK";
  if (qualityRejected || aiConfirmedRisk || (input.outcome === "WIN" && input.returnPercent > 0 && input.returnPercent < 0.25)) {
    return score <= 45 ? "WEAK" : "ACCEPTABLE";
  }
  if (score <= 28) return "DANGEROUS";
  if (score <= 45) return "WEAK";
  if (score <= 72) return "ACCEPTABLE";
  return "CLEAN";
}

function resolveAiVerdict(aiText?: string): DeepPostTradeAnalysis["aiVerdict"] {
  const lower = (aiText ?? "").toLowerCase();
  if (!lower) return "NOT_AVAILABLE";
  if (lower.includes("no_trade") || lower.includes("reject") || lower.includes("avoid") || lower.includes("block")) {
    return "CONFIRMED_RISK";
  }
  if (lower.includes("hold") || lower.includes("watch")) return "CONFLICTED";
  if (lower.includes("buy") || lower.includes("sell") || lower.includes("boost")) return "SUPPORTIVE";
  return "CONFLICTED";
}

function resolvePolicyRecommendation(
  input: DeepAnalysisInput,
  score: number,
  aiVerdict: DeepPostTradeAnalysis["aiVerdict"],
): DeepPostTradeAnalysis["policyRecommendation"] {
  const qualityRejected = isQualityRejected(input);
  const criticPaused = isCriticPaused(input);
  const aiConfirmedRisk = aiVerdict === "CONFIRMED_RISK";

  if (input.outcome === "LOSS" && criticPaused) return "BLOCK";
  if (input.outcome === "LOSS" && qualityRejected && aiConfirmedRisk) return score <= 58 ? "BLOCK" : "TIGHTEN";
  if (input.outcome === "LOSS" && (qualityRejected || aiConfirmedRisk || score <= 55)) return "TIGHTEN";
  if (input.outcome === "BREAKEVEN" && (qualityRejected || aiConfirmedRisk)) return "TIGHTEN";
  if (input.outcome === "WIN" && criticPaused) return "TIGHTEN";
  if (input.outcome === "WIN" && (qualityRejected || aiConfirmedRisk)) return "KEEP_TESTING";
  if (score <= 28) return "BLOCK";
  if (score <= 45) return "TIGHTEN";
  if (score >= 76 && input.outcome === "WIN" && !qualityRejected && !aiConfirmedRisk) return "BOOST";
  return "KEEP_TESTING";
}

function buildRootCause(input: DeepAnalysisInput, c: ReturnType<typeof classify>, aiText?: string, regimeCompatibility?: RegimeCompatibilityAnalysis) {
  const aiVerdict = resolveAiVerdict(aiText);
  const tradeQuality = resolveTradeQuality(c.deterministicScore, input, aiVerdict);
  const factors = [
    regimeCompatibility &&
    (regimeCompatibility.status === "REGIME_MISMATCH" || regimeCompatibility.status === "HIGH_RISK_REGIME_CONFLICT")
      ? regimeCompatibility.explanation
      : "",
    c.directionalFlowBad ? "Entry yonu ile kisa momentum/orderflow uyumsuzdu." : "",
    c.manipulationHigh ? "Hacim spike/pump riski setup'i manipulative hale getirdi." : "",
    c.momentumOpportunity
      ? c.momentumBreakoutLate
        ? "Momentum breakout gec fazdaydi; tepeden kovalama/pullback riski yuksekti."
        : "Momentum breakout firsati vardi; flow, hiz ve hacim trade lehine calisti."
      : "",
    c.structureWeak ? "MTF/grafik uyumu giris icin yeterince temiz degildi." : "",
    c.riskBad ? "RR/TP-SL dengesi bu volatiliteye gore zayif kaldi." : "",
    c.marketHostile ? "Spread/volatilite execution kalitesini dusurdu." : "",
    c.futuresRisk ? "Funding, liquidation veya news/macro evidence risk baskisi olusturdu." : "",
    c.futuresRiskScore >= 70 ? "Pre-trade futures intelligence leverage stress/trap riski gosterdi." : "",
    isQualityRejected(input) ? "Setup kalite/confirmation filtresinden gecemedi." : "",
    isCriticPaused(input) ? "Post-trade critic bu pattern'i durdurulmasi gereken setup olarak isaretledi." : "",
    aiVerdict === "CONFIRMED_RISK" ? "AI katmani da islem oncesi risk/no-trade sinyalini teyit etti." : "",
  ].filter(Boolean);
  if (input.outcome === "WIN" && factors.length === 0) {
    factors.push("Setup planla uyumlu calisti; tekrar test edilebilir.");
  }
  if (factors.length === 0) {
    factors.push("Tek bir baskin hata yok; pattern daha fazla ornek ve daha net filtre istiyor.");
  }
  const primary = factors[0] ?? "Pattern net degil.";
  const rootCause =
    input.outcome === "LOSS"
      ? `Zararin ana sebebi: ${primary}`
      : input.outcome === "BREAKEVEN"
        ? `Islem basabas kaldi; ana ders: ${primary}`
        : factors.length > 0 && primary !== "Setup planla uyumlu calisti; tekrar test edilebilir."
          ? `Karli ama riskli islem; ana ders: ${primary}`
          : `Karli islem; ana avantaj: ${primary}`;
  const professionalSummary = [
    `${input.symbol} ${input.side} islemi ${fmt(input.returnPercent, 4)}% sonuc verdi.`,
    `Skor ${fmt(c.deterministicScore, 0)}/100, kalite ${tradeQuality}.`,
    `Hacim spike ${fmt(c.volumeSpike, 2)}%, flow ${fmt(c.shortFlow, 4)}, momentum ${fmt(c.shortMomentum, 4)}%, MTF ${fmt(c.mtf, 1)}.`,
    `Momentum breakout ${c.momentumBreakoutOk ? "YES" : "NO"}, stage=${c.momentumBreakoutStage}, score=${fmt(c.momentumBreakoutScore, 1)}.`,
    regimeCompatibility ? `Regime compatibility ${regimeCompatibility.status}, score=${fmt(regimeCompatibility.compatibilityScore, 1)}.` : "",
    `Funding ${fmt(c.fundingRate, 6)}, OI ${fmt(c.openInterest, 0)}, liquidation imbalance ${fmt(c.liquidationImbalance, 3)}, futuresRisk ${fmt(c.futuresRiskScore, 1)}.`,
    factors.slice(0, 3).join(" "),
  ].join(" ");
  return { rootCause, professionalSummary, factors };
}

function deterministicAnalysis(input: DeepAnalysisInput): DeepPostTradeAnalysis {
  const c = classify(input);
  const regimeCompatibility = resolveRegimeCompatibility(input, c);
  const narrative = buildRootCause(input, c, undefined, regimeCompatibility);
  const aiVerdict: DeepPostTradeAnalysis["aiVerdict"] = "NOT_AVAILABLE";
  const recommendation = resolvePolicyRecommendation(input, c.deterministicScore, aiVerdict);
  const learningTags = [
    input.outcome === "WIN" ? "outcome:win" : input.outcome === "LOSS" ? "outcome:loss" : "outcome:breakeven",
    c.directionalFlowBad ? "flow:against_entry" : "flow:supportive_or_neutral",
    c.manipulationHigh ? "risk:manipulation_high" : "risk:manipulation_normal",
    c.structureWeak ? "mtf:weak_structure" : "mtf:acceptable_structure",
    c.riskBad ? "rr:weak" : "rr:acceptable",
    c.marketHostile ? "market:hostile_execution" : "market:tradable_execution",
    c.momentumBreakoutOk ? "momentum_breakout:yes" : "momentum_breakout:no",
    c.momentumBreakoutStage !== "unknown" ? `momentum_stage:${tag(c.momentumBreakoutStage)}` : "",
    c.momentumOpportunity && !c.momentumBreakoutLate ? "momentum:opportunity" : c.momentumBreakoutLate ? "momentum:late_chase_risk" : "",
    c.futuresRisk ? "futures:risk_elevated" : "futures:risk_normal",
    c.leveragedTrapProbability >= 70 ? "futures:leveraged_trap" : "",
    c.squeezeProbability >= 75 ? "futures:squeeze_probability_high" : "",
    input.marketEvidence?.summary.openInterest !== undefined ? "oi:available" : "",
    input.marketEvidence?.summary.newsSentiment ? `news:${tag(input.marketEvidence.summary.newsSentiment)}` : "",
    c.weakProfit ? "profit:weak_positive" : "",
    recommendation === "BLOCK" ? "policy:block" : recommendation === "TIGHTEN" ? "policy:tighten" : "",
    input.closeReason ? `close:${tag(input.closeReason)}` : "",
    ...regimeCompatibility.learningTags,
    regimeCompatibility.recommendedAction === "STRONG_PENALTY" ? "policy:regime_penalty_strong" : "",
    regimeCompatibility.recommendedAction === "REDUCE_WEIGHT" ? "policy:regime_penalty" : "",
  ].filter(Boolean);
  return {
    professionalSummary: narrative.professionalSummary,
    rootCause: narrative.rootCause,
    rootCauseFactors: narrative.factors,
    marketRead: {
      volume: sentence([
        `Volume spike ${c.volumeSpike.toFixed(2)}%.`,
        c.volumeSpike >= 120 ? "Hacim anormal sismis; breakout kalitesi sorgulanmali." : "Hacim normal/orta bantta.",
      ]),
      orderbook: sentence([
        `Orderbook imbalance ${c.orderBook.toFixed(4)}.`,
        c.directionalFlowBad ? "Likidite/duvar giris yonune karsi calismis." : "Orderbook girise karsi sert bir sinyal vermemis.",
      ]),
      flow: `Short momentum ${c.shortMomentum.toFixed(4)}%, short flow ${c.shortFlow.toFixed(4)}; ${c.directionalFlowBad ? "flow ters" : "flow notr/destekleyici"}.`,
      momentumBreakout: `Breakout=${c.momentumBreakoutOk ? "yes" : "no"}, stage=${c.momentumBreakoutStage}, score=${c.momentumBreakoutScore.toFixed(2)}; ${c.momentumOpportunity ? c.momentumBreakoutLate ? "gec faz/pullback riski" : "momentum firsati destekli" : "breakout sinyali zayif veya yok"}.`,
      mtf: `MTF alignment ${c.mtf.toFixed(2)}; ${c.structureWeak ? "grafik uyumu zayif" : "grafik uyumu kabul edilebilir"}.`,
      volatility: `Volatility ${c.volatility.toFixed(4)}%, spread ${c.spread.toFixed(4)}%; ${c.marketHostile ? "execution kosulu zor" : "execution kosulu makul"}.`,
      manipulation: `Fake spike ${c.fakeSpike.toFixed(4)}, pump risk ${c.pumpRisk.toFixed(2)}, funding ${c.fundingRate}, liquidation imbalance ${c.liquidationImbalance}, futuresRisk ${c.futuresRiskScore.toFixed(2)}, trap ${c.leveragedTrapProbability.toFixed(2)}, squeeze ${c.squeezeProbability.toFixed(2)}; ${c.manipulationHigh || c.futuresRisk ? "manipulasyon/futures riski yuksek" : "manipulasyon ve futures riski dusuk/orta"}.`,
    },
    entryMistake: regimeCompatibility.status === "REGIME_MISMATCH" || regimeCompatibility.status === "HIGH_RISK_REGIME_CONFLICT"
      ? regimeCompatibility.explanation
      : c.directionalFlowBad || c.structureWeak ? "Entry onayi zayif; momentum/MTF netlesmeden girilmis olabilir." : "Entry tarafinda belirgin kural ihlali yok.",
    exitMistake: input.outcome === "BREAKEVEN" || c.weakProfit ? "Cikis kar kalitesini buyutememis; trailing/hold suresi tekrar ayarlanmali." : "Cikis sonucu plana gore kabul edilebilir.",
    riskMistake: c.riskBad || c.futuresRisk ? `Risk/odul veya futures risk zayif. Funding=${c.fundingRate}, OI=${c.openInterest}, liquidationImbalance=${c.liquidationImbalance}.` : "Risk/odul kabul edilebilir veya veri yetersiz.",
    learningTags,
    policyRecommendation: recommendation,
    nextSetupRules:
      recommendation === "BLOCK"
        ? ["Bu pattern yeterli ornek gelene kadar live tarafinda bloklanmali.", "Momentum, MTF ve orderflow ayni yone donmeden girme.", "Fake spike/pump risk yuksekse trade acma."]
        : recommendation === "TIGHTEN"
          ? ["Min confidence ve quality esigini yukselt.", "RR 1.8 altindaysa girme.", "Flow tersse sadece paper test olarak izle."]
          : recommendation === "BOOST"
            ? ["Ayni pattern kontrollu sekilde tekrar denenebilir.", "Risk artisi kademeli olmali.", "Drawdown baslarsa boost iptal edilmeli."]
            : ["Daha fazla ornek topla.", "TP/SL onerilerini ayni horizon icinde test et.", "Root cause dagilimini izle."],
    tradeQuality: resolveTradeQuality(c.deterministicScore, input, aiVerdict),
    aiVerdict,
    confidence: Math.max(35, Math.min(92, c.deterministicScore)),
    deterministicScore: c.deterministicScore,
    aiSummary: "AI analizi kullanilamadi; deterministic forensic analiz uygulandi.",
    regimeCompatibility,
    generatedAt: new Date().toISOString(),
    source: "RULES_ONLY",
  };
}

export function rebuildDeepPostTradeAnalysis(input: DeepAnalysisInput, aiText?: string): DeepPostTradeAnalysis {
  const base = deterministicAnalysis(input);
  return aiText ? mergeAi(input, base, aiText) : base;
}

function mergeAi(input: DeepAnalysisInput, base: DeepPostTradeAnalysis, aiText: string): DeepPostTradeAnalysis {
  const c = classify(input);
  const lower = aiText.toLowerCase();
  const regimeCompatibility = resolveRegimeCompatibility(input, c);
  const narrative = buildRootCause(input, c, aiText, regimeCompatibility);
  const tags = [
    lower.includes("volume") || lower.includes("hacim") ? "ai:volume_focus" : "",
    lower.includes("orderbook") || lower.includes("liquidity") || lower.includes("likidite") ? "ai:liquidity_focus" : "",
    lower.includes("fake") || lower.includes("manip") || lower.includes("wick") ? "ai:manipulation_focus" : "",
    lower.includes("mtf") || lower.includes("trend") || lower.includes("structure") ? "ai:structure_focus" : "",
    lower.includes("risk") || lower.includes("stop") || lower.includes("rr") ? "ai:risk_focus" : "",
    lower.includes("funding") ? "ai:funding_focus" : "",
    lower.includes("open interest") || lower.includes("oi") ? "ai:oi_focus" : "",
    lower.includes("liquidation") || lower.includes("likidasyon") ? "ai:liquidation_focus" : "",
    lower.includes("news") || lower.includes("macro") || lower.includes("haber") ? "ai:news_macro_focus" : "",
  ].filter(Boolean);
  const aiVerdict = resolveAiVerdict(aiText);
  const aiRecommendation =
    lower.includes("block") || lower.includes("avoid") || lower.includes("pause")
      ? "BLOCK"
      : lower.includes("tighten") || lower.includes("stricter")
        ? "TIGHTEN"
        : lower.includes("boost") || lower.includes("scale")
          ? "BOOST"
          : base.policyRecommendation;
  const ruleRecommendation = resolvePolicyRecommendation(input, c.deterministicScore, aiVerdict);
  const finalRecommendation =
    ruleRecommendation === "BLOCK" || aiRecommendation === "BLOCK"
      ? "BLOCK"
      : ruleRecommendation === "TIGHTEN" || aiRecommendation === "TIGHTEN"
        ? "TIGHTEN"
        : aiRecommendation === "BOOST" && input.outcome === "WIN"
          ? "BOOST"
          : ruleRecommendation;
  return {
    ...base,
    professionalSummary: narrative.professionalSummary,
    rootCause: narrative.rootCause,
    rootCauseFactors: narrative.factors,
    learningTags: Array.from(new Set([
      ...base.learningTags,
      ...tags,
      ...regimeCompatibility.learningTags,
      finalRecommendation === "BLOCK" ? "policy:block" : finalRecommendation === "TIGHTEN" ? "policy:tighten" : "",
    ].filter(Boolean))),
    policyRecommendation: finalRecommendation,
    confidence: Math.max(base.confidence, Math.min(95, c.deterministicScore + (tags.length * 4))),
    aiSummary: `AI raw consensus: ${aiText.slice(0, 1400)}`,
    aiVerdict,
    regimeCompatibility,
    tradeQuality: resolveTradeQuality(c.deterministicScore, input, aiVerdict),
    source: "AI_AND_RULES",
  };
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    task,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("deep post-trade AI timeout")), timeoutMs)),
  ]);
}

export async function runDeepPostTradeAnalysis(input: DeepAnalysisInput): Promise<DeepPostTradeAnalysis> {
  const base = rebuildDeepPostTradeAnalysis(input);
  try {
    const aiInput = await buildAIInput(input.symbol, {
      analysisProfile: "POST_TRADE_DEEP_FORENSIC",
      analystMode: "professional-post-trade",
      objective: [
        "Perform a deep post-trade forensic analysis like a senior crypto trader.",
        `Trade: side=${input.side}, outcome=${input.outcome}, returnPercent=${input.returnPercent}, pnl=${input.realizedPnl}.`,
        `Strategy/regime: strategy=${input.strategy ?? "unknown"}, entryLogic=${input.entryLogic ?? "unknown"}, regime=${input.marketRegime ?? "unknown"}, historicalRegimeExpectancy=${input.historicalRegimeExpectancyPercent ?? "unknown"}.`,
        `Plan: TP=${input.targetProfitPercent ?? "n/a"}%, SL=${input.stopLossPercent ?? "n/a"}%, maxDuration=${input.maxDurationSec ?? "n/a"}s, hold=${input.holdSec ?? "n/a"}s.`,
        `Context: regime=${input.marketRegime ?? "unknown"}, closeReason=${input.closeReason ?? "unknown"}, quality=${input.qualityScore ?? "unknown"}.`,
        `Market evidence: ${JSON.stringify(input.marketEvidence?.summary ?? {}).slice(0, 1800)}`,
        `Feature tags: ${input.features.slice(0, 40).join(", ")}`,
        "Explain root cause across volume, orderbook, flow, MTF, fake breakout/manipulation, funding, open interest, liquidation, news/macro, entry, exit, risk, and next setup rules.",
        "Return the strongest concise forensic reasoning in the model output reasoning.",
      ].join("\n"),
    });
    const providers = getProviderConfigs().slice(0, 3).map((config) => createProviderAdapter(config));
    const outputs = await withTimeout(
      Promise.allSettled(
        providers.map(async (provider) => {
          const output = await provider.analyzeTechnicalSignal(aiInput);
          return `${provider.config.name}:${output.decision}:${output.confidence} ${output.reasoningShort}`;
        }),
      ),
      12_000,
    );
    const aiText = outputs
      .map((row) => row.status === "fulfilled" ? row.value : "")
      .filter(Boolean)
      .join(" | ");
    return aiText ? mergeAi(input, base, aiText) : base;
  } catch {
    return base;
  }
}

