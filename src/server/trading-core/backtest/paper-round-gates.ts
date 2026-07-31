import { env } from "@/lib/config";
import type { MarketContext, ScannerScore } from "@/src/types/scanner";
import {
  evaluatePaperEntryQuality,
  formatPaperEntryQualityReason,
  isFakeHourOnlyPump,
  isStrongHourPumpContext,
} from "@/src/server/trading-core/entry-filters/paper-entry-quality.service";
import {
  evaluatePumpEntrySafety,
  formatPumpEntrySafetyReason,
} from "@/src/server/trading-core/entry-filters/pump-entry-safety.service";

export type PaperRoundHorizonProfile = {
  label: string;
  targetFloorPct: number;
  stopFloorPct: number;
  minConfidence: number;
  minScannerScore: number;
  minScannerConfidence: number;
  minMtfAlignment: number;
  minShortMomentum: number;
  minShortFlow: number;
  maxRiskScore: number;
  maxSpreadPercent: number;
  maxFakeSpikeScore: number;
  maxPumpRisk: number;
  maxVolatilityPercent: number;
  maxRegimeTransitionProbability: number;
  maxRegimeChaosProbability: number;
};

export type PaperRoundAiProxy = {
  finalDecision: "BUY" | "SELL" | "HOLD" | "NO_TRADE";
  finalConfidence: number;
  finalRiskScore: number;
  explanation: string;
  roleScores: Array<{ role: string; score: number; veto?: boolean }>;
  analysisScorecard?: { confidenceScore: number; riskScore?: number };
  decisionPayload?: { timeframeAnalysis?: { alignmentScore?: number } };
};

export type PaperRoundLearningMemory = {
  hardBlock: boolean;
  minConfidenceDelta: number;
  sameSymbolLossCount: number;
};

export function resolveRoundHorizonProfile(maxWaitSec: number): PaperRoundHorizonProfile {
  if (maxWaitSec <= 900) {
    return {
      label: "15m",
      targetFloorPct: 0.55,
      stopFloorPct: 0.4,
      minConfidence: 58,
      minScannerScore: 52,
      minScannerConfidence: 54,
      minMtfAlignment: 48,
      minShortMomentum: 0.02,
      minShortFlow: 0,
      maxRiskScore: 66,
      maxSpreadPercent: 0.12,
      maxFakeSpikeScore: 1.8,
      maxPumpRisk: 62,
      maxVolatilityPercent: 2.8,
      maxRegimeTransitionProbability: 72,
      maxRegimeChaosProbability: 68,
    };
  }
  if (maxWaitSec <= 1800) {
    return {
      label: "30m",
      targetFloorPct: 0.65,
      stopFloorPct: 0.45,
      minConfidence: 60,
      minScannerScore: 54,
      minScannerConfidence: 56,
      minMtfAlignment: 50,
      minShortMomentum: 0.03,
      minShortFlow: 0.005,
      maxRiskScore: 64,
      maxSpreadPercent: 0.11,
      maxFakeSpikeScore: 1.7,
      maxPumpRisk: 60,
      maxVolatilityPercent: 2.6,
      maxRegimeTransitionProbability: 68,
      maxRegimeChaosProbability: 64,
    };
  }
  if (maxWaitSec <= 3600) {
    return {
      label: "1h",
      targetFloorPct: 0.88,
      stopFloorPct: 0.55,
      minConfidence: 62,
      minScannerScore: 56,
      minScannerConfidence: 58,
      minMtfAlignment: 52,
      minShortMomentum: 0.04,
      minShortFlow: 0.01,
      maxRiskScore: 62,
      maxSpreadPercent: 0.1,
      maxFakeSpikeScore: 1.6,
      maxPumpRisk: 58,
      maxVolatilityPercent: 2.4,
      maxRegimeTransitionProbability: 64,
      maxRegimeChaosProbability: 60,
    };
  }
  return {
    label: "session",
    targetFloorPct: 1.2,
    stopFloorPct: 0.75,
    minConfidence: 65,
    minScannerScore: 60,
    minScannerConfidence: 60,
    minMtfAlignment: 58,
    minShortMomentum: 0.03,
    minShortFlow: 0.005,
    maxRiskScore: 60,
    maxSpreadPercent: 0.12,
    maxFakeSpikeScore: 1.8,
    maxPumpRisk: 58,
    maxVolatilityPercent: 2.2,
    maxRegimeTransitionProbability: 60,
    maxRegimeChaosProbability: 56,
  };
}

export function resolvePaperRoundProfile(profile: PaperRoundHorizonProfile): PaperRoundHorizonProfile {
  return {
    ...profile,
    minConfidence: Math.max(48, profile.minConfidence - 14),
    minScannerScore: Math.max(44, profile.minScannerScore - 12),
    minScannerConfidence: Math.max(46, profile.minScannerConfidence - 12),
    minMtfAlignment: 0,
    minShortMomentum: 0,
    minShortFlow: -1,
    maxRiskScore: Math.min(78, profile.maxRiskScore + 12),
    maxSpreadPercent: Math.min(0.2, profile.maxSpreadPercent + 0.08),
    maxFakeSpikeScore: Math.min(2.4, profile.maxFakeSpikeScore + 0.5),
    maxPumpRisk: Math.min(92, profile.maxPumpRisk + 30),
    maxVolatilityPercent: Math.min(4, profile.maxVolatilityPercent + 1.2),
    maxRegimeTransitionProbability: Math.min(98, profile.maxRegimeTransitionProbability + 30),
    maxRegimeChaosProbability: Math.min(98, profile.maxRegimeChaosProbability + 35),
  };
}

function clamp(min: number, value: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function buildPaperRoundAiProxy(context: MarketContext, score: ScannerScore): PaperRoundAiProxy {
  const shortMomentum = Number(context.metadata.shortMomentumPercent ?? 0);
  const shortFlow = Number(context.metadata.shortFlowImbalance ?? 0);
  const mtfAlignment = Number(context.metadata.mtfAlignmentScore ?? 0);
  const bullish = shortMomentum > 0 || shortFlow > 0 || context.momentumPercent > 0;
  const technical = clamp(
    0,
    Math.max(score.score * 1.02, 52 + shortMomentum * 22 + Math.max(0, mtfAlignment - 40) * 0.35) -
      context.volatilityPercent * 0.6,
    100,
  );
  const sentiment = clamp(0, 54 + shortFlow * 95 + (context.buyPressure - 0.5) * 55 + Math.max(0, shortMomentum) * 10, 100);
  const risk = clamp(58, 100 - context.volatilityPercent * 6 - context.spreadPercent * 45 - context.pumpRisk * 0.08, 96);
  const confidence = clamp(
    0,
    Math.max(score.confidence, score.score * 0.94) + Math.max(0, shortMomentum) * 16 + Math.max(0, shortFlow) * 8,
    100,
  );
  const paperExplorationBuy =
    bullish && score.score >= 42 && confidence >= 46 && shortMomentum >= 0.008 && shortFlow >= 0.004;
  const decision =
    (score.status === "QUALIFIED" && bullish && confidence >= 46) || paperExplorationBuy
      ? "BUY"
      : score.status === "REJECTED" && !paperExplorationBuy
        ? "NO_TRADE"
        : "HOLD";
  const topGainerPump = Boolean(context.metadata.topGainerDiscovery ?? false);
  const explanation = topGainerPump
    ? `backtest proxy | PUMP_CONTINUATION | pump-lane`
    : `backtest proxy | steady-gain=1h | target=0.85-1.0%`;

  return {
    finalDecision: decision,
    finalConfidence: Number(confidence.toFixed(2)),
    finalRiskScore: Number((100 - risk).toFixed(2)),
    explanation,
    roleScores: [
      { role: "AI-1_TECHNICAL", score: Number(technical.toFixed(2)) },
      { role: "AI-2_SENTIMENT", score: Number(sentiment.toFixed(2)) },
      { role: "AI-3_RISK", score: Number(risk.toFixed(2)), veto: risk < 38 },
    ],
    analysisScorecard: { confidenceScore: Number(confidence.toFixed(2)), riskScore: Number((100 - risk).toFixed(2)) },
    decisionPayload: {
      timeframeAnalysis: {
        alignmentScore: Number(context.metadata.mtfAlignmentScore ?? 0),
      },
    },
  };
}

export function resolvePaperRoundLane(context: MarketContext, ai: PaperRoundAiProxy): "pump-lane" | "steady-gain" | "other" {
  const explanation = ai.explanation;
  const change24h = Number(context.metadata.topGainerChange24h ?? context.change24h ?? 0);
  const topGainerPump =
    Boolean(context.metadata.topGainerDiscovery ?? false) ||
    Boolean(context.metadata.pumpEarlyConfirmed ?? false) ||
    Boolean(context.metadata.pumpContinuationMode ?? false) ||
    Boolean(context.metadata.pumpIntradaySpike ?? false) ||
    Number(context.metadata.topGainerPriorityScore ?? 0) >= 70;
  if (
    topGainerPump &&
    (explanation.includes("PUMP_CONTINUATION") ||
      explanation.includes("PUMP_INTRADAY") ||
      explanation.includes("PUMP_EARLY") ||
      change24h >= env.PUMP_INTRADAY_MIN_CHANGE_24H)
  ) {
    return "pump-lane";
  }
  if (explanation.includes("steady-gain")) return "steady-gain";
  return "other";
}

export function evaluatePaperRoundGate(input: {
  context: MarketContext;
  score: ScannerScore;
  ai: PaperRoundAiProxy;
  maxWaitSec: number;
  targetProfitPct: number;
  learningMemory?: PaperRoundLearningMemory;
}) {
  const profile = resolvePaperRoundProfile(resolveRoundHorizonProfile(input.maxWaitSec));
  const context = input.context;
  const ai = input.ai;
  const confidence = Number(ai.analysisScorecard?.confidenceScore ?? ai.finalConfidence ?? 0);
  const riskScore = Number(ai.finalRiskScore ?? ai.analysisScorecard?.riskScore ?? 0);
  const scannerScore = Number(input.score.score ?? 0);
  const scannerConfidence = Number(input.score.confidence ?? 0);
  const mtfAlignment = Number(ai.decisionPayload?.timeframeAnalysis?.alignmentScore ?? context.metadata.mtfAlignmentScore ?? 0);
  const shortMomentum = Number(context.metadata.shortMomentumPercent ?? 0);
  const hourMomentum = Number(context.metadata.hourMomentumPercent ?? 0);
  const effectiveShortMomentum = Math.max(shortMomentum, hourMomentum);
  const shortFlow = Number(context.metadata.shortFlowImbalance ?? 0);
  const regimeTransitionProbability = Number(context.metadata.regimeTransitionProbability ?? 0);
  const regimeChaosProbability = Number(context.metadata.regimeChaosProbability ?? 0);
  const regimeLifecyclePhase = String(context.metadata.regimeLifecyclePhase ?? "");
  const regimeChopWarning = Boolean(context.metadata.regimeChopWarning ?? false);
  const regimeUnstableBreakout = Boolean(context.metadata.regimeUnstableBreakoutCondition ?? false);
  const explanation = ai.explanation;
  const roleScores = ai.roleScores ?? [];
  const technicalRoleScore = Number(roleScores.find((row) => row.role === "AI-1_TECHNICAL")?.score ?? 0);
  const sentimentRoleScore = Number(roleScores.find((row) => row.role === "AI-2_SENTIMENT")?.score ?? 0);
  const riskRoleScore = Number(roleScores.find((row) => row.role === "AI-3_RISK")?.score ?? 0);
  const roleRiskVeto = Boolean(roleScores.find((row) => row.role === "AI-3_RISK")?.veto);
  const learningMicroCandidate = explanation.includes("learning-micro");
  const steadyGainCandidate = explanation.includes("steady-gain");
  const momentumBreakoutFallback = explanation.includes("momentum-breakout=BUY");
  const lastResortCandidate = explanation.includes("last-resort");
  const ultimateFallbackCandidate = explanation.includes("ultimate=");
  const rangeSideways = String(context.metadata.marketRegime ?? "RANGE_SIDEWAYS") === "RANGE_SIDEWAYS";
  const rocketPump = String(context.metadata.marketRegime ?? "") === "ROCKET_PUMP";
  const pumpBreakoutScore = Number(/score=([\d.]+)/.exec(explanation)?.[1] ?? context.metadata.momentumBreakoutScore ?? 0);
  const compositeAvg = (() => {
    const parts = [technicalRoleScore, sentimentRoleScore, riskRoleScore].filter((value) => value > 0);
    if (parts.length > 0) return parts.reduce((sum, value) => sum + value, 0) / parts.length;
    return confidence;
  })();
  const topGainerPump =
    Boolean(context.metadata.topGainerDiscovery ?? false) ||
    Boolean(context.metadata.pumpEarlyConfirmed ?? false) ||
    Boolean(context.metadata.pumpContinuationMode ?? false) ||
    Boolean(context.metadata.pumpIntradaySpike ?? false) ||
    Number(context.metadata.topGainerPriorityScore ?? 0) >= 70;
  const change24h = Number(context.metadata.topGainerChange24h ?? context.change24h ?? 0);
  const pumpLaneCandidate =
    topGainerPump &&
    (explanation.includes("PUMP_CONTINUATION") ||
      explanation.includes("PUMP_INTRADAY") ||
      explanation.includes("PUMP_EARLY") ||
      change24h >= env.PUMP_INTRADAY_MIN_CHANGE_24H);
  const strongPumpContinuation = topGainerPump && effectiveShortMomentum >= 0.12 && shortFlow >= 0.02;
  const targetEdgeAfterSpread = input.targetProfitPct - context.spreadPercent * 2;
  const dataDegraded =
    mtfAlignment <= 0 &&
    Math.abs(shortMomentum) < 0.02 &&
    (Math.abs(shortFlow) >= 0.95 || Math.abs(shortFlow) <= 0.001);
  const learningMemory = input.learningMemory ?? { hardBlock: false, minConfidenceDelta: 0, sameSymbolLossCount: 0 };

  if (learningMemory.sameSymbolLossCount >= 2) {
    return { ok: false, profile, reason: `same-symbol-loss-cooldown:${context.symbol},count=${learningMemory.sameSymbolLossCount}` };
  }

  if (pumpLaneCandidate) {
    const tapeMomentum = shortMomentum;
    const marketRegime = String(context.metadata.marketRegime ?? "RANGE_SIDEWAYS");
    const pumpStage = String(context.metadata.pumpBreakoutStage ?? "");
    const strongHourPump =
      change24h >= 15 &&
      hourMomentum >= 1 &&
      tapeMomentum >= 0.12 &&
      shortFlow >= 0.25 &&
      compositeAvg >= 60;
    const weakPumpEntry =
      change24h < 28 &&
      (compositeAvg < 54 || technicalRoleScore < 48 || (technicalRoleScore < 52 && sentimentRoleScore < 58));
    const weakPumpRangeEntry =
      rangeSideways &&
      !strongHourPump &&
      (change24h < 28 ||
        effectiveShortMomentum < 0.55 ||
        shortFlow < 0.12 ||
        mtfAlignment < 50 ||
        compositeAvg < 62);
    const weakPumpRocketEntry =
      rocketPump &&
      !strongHourPump &&
      (pumpBreakoutScore < 85 ||
        effectiveShortMomentum < 0.75 ||
        shortFlow < 0.28 ||
        compositeAvg < 64 ||
        technicalRoleScore < 62);
    const weakPumpLateTapeChase =
      pumpStage === "LATE" &&
      tapeMomentum < 0.35 &&
      !isStrongHourPumpContext({ change24h, hourMomentum, tapeMomentum, shortFlow });
    const weakPumpCalmRegime =
      marketRegime === "LOW_VOLATILITY_CALM" &&
      (tapeMomentum < 0.45 || pumpStage === "LATE" || compositeAvg < 66) &&
      !isStrongHourPumpContext({ change24h, hourMomentum, tapeMomentum, shortFlow });
    const weakPumpHourOnlyMomentum = isFakeHourOnlyPump({
      hourMomentum,
      tapeMomentum,
      shortFlow,
      marketRegime,
      pumpStage,
    });
    const pumpReasons = [
      ai.finalDecision === "SELL" ? `AI SELL sinyali (${ai.finalDecision})` : "",
      weakPumpEntry
        ? `pump zayif AI profili (tech=${technicalRoleScore.toFixed(1)}, composite=${compositeAvg.toFixed(1)}, 24h=${change24h.toFixed(2)}%)`
        : "",
      weakPumpRangeEntry
        ? `pump RANGE zayif (24h=${change24h.toFixed(2)}%, short=${shortMomentum.toFixed(3)}%, flow=${shortFlow.toFixed(3)})`
        : "",
      weakPumpRocketEntry
        ? `pump ROCKET zayif (score=${pumpBreakoutScore.toFixed(1)}, short=${shortMomentum.toFixed(3)}%, flow=${shortFlow.toFixed(3)}, composite=${compositeAvg.toFixed(1)})`
        : "",
      weakPumpLateTapeChase ? `pump LATE tape zayif (stage=${pumpStage}, tape=${tapeMomentum.toFixed(3)}%)` : "",
      weakPumpCalmRegime
        ? `pump CALM rejim riskli (tape=${tapeMomentum.toFixed(3)}%, stage=${pumpStage}, composite=${compositeAvg.toFixed(1)})`
        : "",
      weakPumpHourOnlyMomentum
        ? `pump hour-only momentum (tape=${tapeMomentum.toFixed(3)}%, hour=${hourMomentum.toFixed(3)}%)`
        : "",
      learningMemory.hardBlock ? "learning memory block" : "",
      context.spreadPercent > 0.35 ? `spread ${context.spreadPercent.toFixed(4)}% > 0.35%` : "",
      context.fakeSpikeScore > 3.2 ? `fake spike ${context.fakeSpikeScore.toFixed(2)} > 3.2` : "",
    ].filter(Boolean);
    const entryQuality = evaluatePaperEntryQuality({
      context,
      side: "BUY",
      tapeMomentum,
      hourMomentum,
      shortFlow,
      pumpStage,
      compositeAvg,
      btcSnapshot: null,
      pumpLane: true,
      minScore: strongHourPump ? 52 : 58,
    });
    if (!entryQuality.ok) {
      pumpReasons.push(formatPaperEntryQualityReason(entryQuality));
    }
    const pumpSafety = evaluatePumpEntrySafety({
      context,
      tapeMomentum,
      hourMomentum,
      shortFlow,
      change24h,
      pumpStage,
      marketRegime,
      compositeAvg,
    });
    if (!pumpSafety.ok) {
      pumpReasons.push(formatPumpEntrySafetyReason(pumpSafety));
    }
    return { ok: pumpReasons.length === 0, profile, reason: pumpReasons.join(" | ") || "pump-lane-ok", entryQuality };
  }

  const learningAdjustedMinConfidence = profile.minConfidence + learningMemory.minConfidenceDelta;
  const chopLikeRegime =
    regimeChopWarning ||
    regimeLifecyclePhase.includes("CHOP") ||
    regimeLifecyclePhase.includes("CHAOS") ||
    rangeSideways;
  const lowVolCalm = String(context.metadata.marketRegime ?? "RANGE_SIDEWAYS") === "LOW_VOLATILITY_CALM";
  const riskyRangeBreakout =
    (momentumBreakoutFallback || lastResortCandidate || ultimateFallbackCandidate) &&
    chopLikeRegime &&
    compositeAvg < 58 &&
    !strongPumpContinuation;
  const riskyMomentumRangeBreakout = momentumBreakoutFallback && rangeSideways && !strongPumpContinuation;
  const riskyMomentumWeakSentiment =
    momentumBreakoutFallback && sentimentRoleScore > 0 && sentimentRoleScore < 58 && !strongPumpContinuation;
  const riskyLastResortPaper = lastResortCandidate && (rangeSideways || lowVolCalm || chopLikeRegime) && !strongPumpContinuation;
  const riskyLearningMicroRange = learningMicroCandidate && rangeSideways && !strongPumpContinuation;
  const riskyNonPumpQuality =
    !pumpLaneCandidate &&
    !steadyGainCandidate &&
    !strongPumpContinuation &&
    (compositeAvg < 66 ||
      sentimentRoleScore < 62 ||
      mtfAlignment < 50 ||
      shortMomentum < 0.035 ||
      shortFlow < 0.015);
  const riskySteadyGainQuality =
    steadyGainCandidate &&
    (compositeAvg < 64 ||
      sentimentRoleScore < 58 ||
      mtfAlignment < 45 ||
      shortMomentum < 0.025 ||
      shortFlow < 0.012);
  const riskySteadyGainRangeSideways =
    steadyGainCandidate &&
    rangeSideways &&
    (mtfAlignment < 48 || compositeAvg < 70);
  const riskySteadyGainNoEdge =
    steadyGainCandidate &&
    (targetEdgeAfterSpread < 0.45 ||
      (rangeSideways && shortMomentum < 0.035 && shortFlow < 0.018));
  const roleConsensusWeak =
    roleRiskVeto ||
    (technicalRoleScore > 0 && technicalRoleScore < 38) ||
    (sentimentRoleScore > 0 && sentimentRoleScore < 38) ||
    (riskRoleScore > 0 && riskRoleScore < 42);
  const reasons = [
    ai.finalDecision === "SELL" ? `AI SELL sinyali (${ai.finalDecision})` : "",
    ai.finalDecision !== "BUY" && ai.finalDecision !== "SELL" && confidence < 40
      ? `AI karar zayif (${ai.finalDecision}, conf=${confidence.toFixed(1)})`
      : "",
    learningMemory.hardBlock ? "learning memory block" : "",
    riskyRangeBreakout ? `range/chop fallback riskli (composite=${compositeAvg.toFixed(1)})` : "",
    riskyLearningMicroRange ? "learning-micro RANGE_SIDEWAYS paper blok" : "",
    riskyNonPumpQuality
      ? `non-pump kalite dusuk (composite=${compositeAvg.toFixed(1)}, sentiment=${sentimentRoleScore.toFixed(1)}, mtf=${mtfAlignment.toFixed(1)})`
      : "",
    riskySteadyGainQuality
      ? `steady-gain kalite dusuk (composite=${compositeAvg.toFixed(1)}, mtf=${mtfAlignment.toFixed(1)})`
      : "",
    riskySteadyGainRangeSideways
      ? `steady-gain RANGE blok (mtf=${mtfAlignment.toFixed(1)}, composite=${compositeAvg.toFixed(1)})`
      : "",
    riskySteadyGainNoEdge
      ? `steady-gain edge yetersiz (targetEdge=${targetEdgeAfterSpread.toFixed(3)}%, momentum=${shortMomentum.toFixed(3)})`
      : "",
    riskyMomentumRangeBreakout ? "momentum-breakout RANGE_SIDEWAYS paper blok" : "",
    riskyMomentumWeakSentiment ? `momentum-breakout zayif sentiment (${sentimentRoleScore.toFixed(1)} < 58)` : "",
    riskyLastResortPaper ? "last-resort paper blok (range/calm/chop)" : "",
    ultimateFallbackCandidate ? "ultimate fallback devre disi (paper kalite)" : "",
    roleConsensusWeak
      ? `AI role consensus zayif (tech=${technicalRoleScore.toFixed(1)}, sentiment=${sentimentRoleScore.toFixed(1)}, risk=${riskRoleScore.toFixed(1)})`
      : "",
    confidence < learningAdjustedMinConfidence ? `confidence ${confidence.toFixed(2)} < ${learningAdjustedMinConfidence}` : "",
    scannerScore < profile.minScannerScore ? `scanner ${scannerScore.toFixed(2)} < ${profile.minScannerScore}` : "",
    scannerConfidence < profile.minScannerConfidence
      ? `scanner confidence ${scannerConfidence.toFixed(2)} < ${profile.minScannerConfidence}`
      : "",
    mtfAlignment < profile.minMtfAlignment && !dataDegraded && profile.minMtfAlignment > 0
      ? `MTF ${mtfAlignment.toFixed(2)} < ${profile.minMtfAlignment}`
      : "",
    riskScore > profile.maxRiskScore ? `risk ${riskScore.toFixed(2)} > ${profile.maxRiskScore}` : "",
    context.spreadPercent > profile.maxSpreadPercent ? `spread ${context.spreadPercent.toFixed(4)}% > ${profile.maxSpreadPercent}%` : "",
    context.fakeSpikeScore > profile.maxFakeSpikeScore ? `fake spike ${context.fakeSpikeScore.toFixed(2)} > ${profile.maxFakeSpikeScore}` : "",
    context.pumpRisk > profile.maxPumpRisk && !strongPumpContinuation
      ? `pump risk ${context.pumpRisk.toFixed(2)} > ${profile.maxPumpRisk}`
      : "",
    context.volatilityPercent > profile.maxVolatilityPercent && !strongPumpContinuation
      ? `volatility ${context.volatilityPercent.toFixed(4)}% > ${profile.maxVolatilityPercent}%`
      : "",
    !dataDegraded && (shortMomentum < profile.minShortMomentum || shortFlow < profile.minShortFlow)
      ? `momentum/flow zayif (${shortMomentum.toFixed(4)}, ${shortFlow.toFixed(4)})`
      : "",
    targetEdgeAfterSpread < 0.25 ? `net hedef edge zayif (${targetEdgeAfterSpread.toFixed(4)}%)` : "",
    regimeTransitionProbability > profile.maxRegimeTransitionProbability && !strongPumpContinuation
      ? `regime transition ${regimeTransitionProbability.toFixed(2)} > ${profile.maxRegimeTransitionProbability}`
      : "",
    regimeChaosProbability > profile.maxRegimeChaosProbability && !strongPumpContinuation
      ? `regime chaos ${regimeChaosProbability.toFixed(2)} > ${profile.maxRegimeChaosProbability}`
      : "",
    regimeChopWarning && !strongPumpContinuation && !dataDegraded ? "regime chop warning" : "",
    regimeUnstableBreakout && !strongPumpContinuation && !dataDegraded ? "unstable breakout condition" : "",
    !dataDegraded && (regimeLifecyclePhase.includes("CHAOS") || regimeLifecyclePhase.includes("CHOP"))
      ? `regime lifecycle risk (${regimeLifecyclePhase})`
      : "",
  ].filter(Boolean);

  return { ok: reasons.length === 0, profile, reason: reasons.join(" | ") || "paper-round-ok" };
}

export function rankPaperRoundCandidate(input: {
  context: MarketContext;
  score: ScannerScore;
  ai: PaperRoundAiProxy;
}) {
  const aiConfidence = input.ai.finalConfidence;
  const scannerScore = input.score.score;
  const shortMomentum = Number(input.context.metadata.shortMomentumPercent ?? 0);
  const flow = Math.abs(Number(input.context.metadata.shortFlowImbalance ?? 0));
  const velocity = Number(input.context.metadata.tradeVelocity ?? 0);
  const candleSignal = Math.abs(Number(input.context.shortCandleSignal ?? 0));
  const pumpBoost = Boolean(input.context.metadata.topGainerDiscovery) ? 12 : 0;
  return aiConfidence * 0.42 + scannerScore * 0.32 + shortMomentum * 28 + flow * 18 + velocity * 6 + candleSignal * 2 + pumpBoost;
}
