import { env } from "@/lib/config";
import type { ScannerCandidate } from "@/src/types/scanner";
import type { AIConsensusResult } from "@/src/types/ai";

export type SmartEntryType =
  | "breakout + retest"
  | "pullback continuation"
  | "range reclaim"
  | "momentum confirmation entry"
  | "reversal confirmation entry";

export type SmartEntryEvaluationResult = {
  recommendedEntryType: SmartEntryType;
  idealEntryZone: {
    min: number;
    max: number;
    anchor: number;
  };
  lateEntryRisk: number;
  confirmationStatus: "CONFIRMED" | "WAITING_CONFIRMATION" | "REJECTED";
  entryQualityScore: number;
  proceed: boolean;
  reasons: string[];
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function evaluateSmartEntryEngine(input: {
  candidate: ScannerCandidate;
  ai?: AIConsensusResult;
  side: "BUY" | "SELL";
  entryPrice: number;
  takeProfitPercent: number;
  stopLossPercent: number;
}): SmartEntryEvaluationResult {
  const reasons: string[] = [];
  const ai = input.ai;
  if (!ai) {
    return {
      recommendedEntryType: "momentum confirmation entry",
      idealEntryZone: { min: input.entryPrice, max: input.entryPrice, anchor: input.entryPrice },
      lateEntryRisk: 100,
      confirmationStatus: "REJECTED",
      entryQualityScore: 0,
      proceed: false,
      reasons: ["AI unavailable for smart entry"],
    };
  }

  const liquidityIntel = ai.decisionPayload?.liquidityIntel;
  const timeframe = ai.decisionPayload?.timeframeAnalysis;
  const safeEntryPointRaw = Number(ai.decisionPayload?.safeEntryPoint ?? input.entryPrice);
  const safeEntryPoint = Number.isFinite(safeEntryPointRaw) && safeEntryPointRaw > 0 ? safeEntryPointRaw : input.entryPrice;
  const spreadPercent = Number(input.candidate.context.spreadPercent ?? 0);
  const shortMomentum = Number(input.candidate.context.metadata.shortMomentumPercent ?? 0);
  const shortFlow = Number(input.candidate.context.metadata.shortFlowImbalance ?? 0);
  const fakeBreakoutRisk = Number(liquidityIntel?.fakeBreakoutRisk ?? 0);
  const liquidityRisk = Number(liquidityIntel?.liquidityRiskScore ?? 0);
  const minRr = Math.max(0.01, env.AI_HYBRID_MIN_RR_RATIO);
  const rrAtEntry = input.stopLossPercent > 0 ? input.takeProfitPercent / input.stopLossPercent : 0;
  const pullbackTolerancePercent = Math.max(0.05, env.EXECUTION_PULLBACK_TOLERANCE_PERCENT);
  const deviationPercent = Math.abs(((input.entryPrice - safeEntryPoint) / Math.max(input.entryPrice, 0.00000001)) * 100);
  const spreadLimit = Math.max(0.01, env.AI_HYBRID_MAX_SPREAD_PERCENT);
  const spreadFit = clamp((1 - spreadPercent / spreadLimit) * 100, 0, 100);
  const wickDensityCount =
    (ai.decisionPayload?.liquidityZones ?? []).filter((zone) => zone.type === "wick_cluster").length +
    (ai.decisionPayload?.riskyAreas ?? []).filter((area) => area.label === "wick_density").length;
  const hasWickRejectionSignal = wickDensityCount >= 2 || Number(input.candidate.context.fakeSpikeScore ?? 0) >= 1.4;
  const sweepDetected = Boolean(liquidityIntel?.sweepDetected);
  const rangeReclaimHint = Boolean(liquidityIntel?.rangeLiquidityGrab);
  const momentumStrong = Math.abs(shortMomentum) >= 0.22 && Math.abs(shortFlow) >= 0.05;
  const reversalHint = sweepDetected && String(liquidityIntel?.trappedTradersScenario ?? "NONE") !== "NONE";
  const retestNeeded = deviationPercent > pullbackTolerancePercent;
  const likelyLateEntry = deviationPercent > pullbackTolerancePercent * 1.6 && momentumStrong;

  let recommendedEntryType: SmartEntryType = "momentum confirmation entry";
  if (retestNeeded) {
    recommendedEntryType = "breakout + retest";
  } else if (rangeReclaimHint) {
    recommendedEntryType = "range reclaim";
  } else if (reversalHint) {
    recommendedEntryType = "reversal confirmation entry";
  } else if (!momentumStrong) {
    recommendedEntryType = "pullback continuation";
  }

  if (recommendedEntryType === "breakout + retest") {
    reasons.push("Breakout dogrudan kovalanmiyor, retest beklenmeli.");
  }
  if (hasWickRejectionSignal && !sweepDetected) {
    reasons.push("Wick rejection goruldu, teyit olmadan giris riskli.");
  }
  if (spreadPercent > spreadLimit) {
    reasons.push(`Spread uygunsuz (${spreadPercent.toFixed(4)} > ${spreadLimit.toFixed(4)}).`);
  }
  if (rrAtEntry < minRr) {
    reasons.push(`Risk/odul entry noktasinda bozuldu (rr=${rrAtEntry.toFixed(2)} < ${minRr}).`);
  }
  if (likelyLateEntry) {
    reasons.push("Entry gec kaldi, trade iptal edilmeli.");
  }
  if (String(liquidityIntel?.safeEntryTiming ?? "").includes("NO_ENTRY")) {
    reasons.push("Likidite/fake breakout nedeniyle giris engellendi.");
  }
  if (String(liquidityIntel?.safeEntryTiming ?? "").includes("WAIT_LIQUIDITY")) {
    reasons.push("Likidite temizlenmeden giris acilmamali.");
  }
  if (timeframe?.conflict || !timeframe?.entrySuitable) {
    reasons.push(`Timeframe entry teyidi yok (${timeframe?.reason ?? "conflict"}).`);
  }

  const pullbackQuality = clamp(100 - (deviationPercent / Math.max(pullbackTolerancePercent, 0.01)) * 38, 0, 100);
  const lateEntryRisk = Number(
    clamp(
      (deviationPercent / Math.max(pullbackTolerancePercent, 0.01)) * 36 +
        (momentumStrong ? 18 : 8) +
        fakeBreakoutRisk * 0.22 +
        (100 - spreadFit) * 0.24,
      0,
      100,
    ).toFixed(2),
  );
  const confirmationScore = clamp(
    (timeframe?.entrySuitable ? 34 : 14) +
      (timeframe?.trendAligned ? 20 : 6) +
      (timeframe?.conflict ? -24 : 10) +
      (sweepDetected ? 12 : 0) +
      (hasWickRejectionSignal && !sweepDetected ? -16 : 0),
    0,
    100,
  );
  const rrFit = clamp((rrAtEntry / minRr) * 100, 0, 100);
  const liquiditySafety = clamp(100 - liquidityRisk, 0, 100);
  const entryQualityScore = Number(
    clamp(
      pullbackQuality * 0.24 +
        confirmationScore * 0.24 +
        spreadFit * 0.12 +
        rrFit * 0.2 +
        liquiditySafety * 0.2,
      0,
      100,
    ).toFixed(2),
  );

  const hardReject =
    spreadPercent > spreadLimit ||
    rrAtEntry < minRr ||
    likelyLateEntry ||
    String(liquidityIntel?.safeEntryTiming ?? "").includes("NO_ENTRY");
  const waitingConfirmation =
    retestNeeded ||
    (hasWickRejectionSignal && !sweepDetected) ||
    String(liquidityIntel?.safeEntryTiming ?? "").includes("WAIT_LIQUIDITY") ||
    Boolean(timeframe?.conflict) ||
    !Boolean(timeframe?.entrySuitable);
  const proceed = !hardReject && !waitingConfirmation && entryQualityScore >= 60;
  const confirmationStatus: SmartEntryEvaluationResult["confirmationStatus"] = hardReject
    ? "REJECTED"
    : waitingConfirmation
      ? "WAITING_CONFIRMATION"
      : "CONFIRMED";

  const zoneHalfBand = Math.max(
    safeEntryPoint * (pullbackTolerancePercent / 100),
    safeEntryPoint * 0.0008,
  );
  return {
    recommendedEntryType,
    idealEntryZone: {
      min: Number((safeEntryPoint - zoneHalfBand).toFixed(8)),
      max: Number((safeEntryPoint + zoneHalfBand).toFixed(8)),
      anchor: Number(safeEntryPoint.toFixed(8)),
    },
    lateEntryRisk,
    confirmationStatus,
    entryQualityScore,
    proceed,
    reasons,
  };
}
