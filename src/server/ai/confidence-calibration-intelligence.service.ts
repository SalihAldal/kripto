import { normalizeMarketRegimeLabel } from "@/src/server/scanner/regime-intelligence.service";
import type { AIConsensusResult, AIProviderResult } from "@/src/types/ai";

export type CalibrationBin = {
  binStart: number;
  binEnd: number;
  predictedAvg: number;
  actualSuccessRate: number;
  count: number;
  calibrationError: number;
};

export type ConfidenceCalibrationTelemetry = {
  rawConfidence: number;
  calibratedConfidence: number;
  consensusConfidence: number;
  modelDisagreementScore: number;
  conflictScore: number;
  agreementScore: number;
  calibrationError: number;
  calibrationAdjustment: number;
  overestimated: boolean;
  underestimated: boolean;
  expectedValueRaw: number;
  expectedValueCalibrated: number;
  expectedValueAccuracy?: number;
  historicalWinRate?: number;
  historicalLossRate?: number;
  decisionAccuracy?: number;
  marketRegime?: string;
  modelConfidences: number[];
  providerDecisions: string[];
};

export type CalibrationAggregateKpis = {
  sampleCount: number;
  averageCalibrationError: number;
  averageConfidenceAccuracy: number;
  overestimationRate: number;
  underestimationRate: number;
  decisionAccuracy: number;
  expectedValueAccuracy: number;
  profitFactor?: number;
  sharpeRatio?: number;
  sortinoRatio?: number;
  falsePositiveRate?: number;
  falseNegativeRate?: number;
};

/** Minimum historical outcomes in a bin before upward confidence adjustment is allowed. */
export const MIN_BIN_COUNT_FOR_INCREASE = 5;
/** Minimum historical outcomes in a bin before downward calibration is applied from bin stats. */
export const MIN_BIN_COUNT_FOR_DECREASE = 2;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals = 4) {
  return Number(value.toFixed(decimals));
}

export function buildCalibrationBinsFromOutcomes(
  rows: Array<{ confidence: number; won: boolean }>,
  minBinCount = 1,
): CalibrationBin[] {
  const bins = new Map<string, { predicted: number[]; success: number[] }>();
  for (const row of rows) {
    const conf = clamp(Number(row.confidence ?? 0), 0, 100);
    const start = Math.floor(conf / 10) * 10;
    const key = `${start}-${start + 9}`;
    const bucket = bins.get(key) ?? { predicted: [], success: [] };
    bucket.predicted.push(conf);
    bucket.success.push(row.won ? 1 : 0);
    bins.set(key, bucket);
  }
  return [...bins.entries()]
    .map(([key, bucket]) => {
      const start = Number(key.split("-")[0]);
      const predictedAvg = bucket.predicted.reduce((a, b) => a + b, 0) / bucket.predicted.length;
      const actualSuccessRate =
        (bucket.success.reduce((a, b) => a + b, 0) / bucket.success.length) * 100;
      return {
        binStart: start,
        binEnd: start + 9,
        predictedAvg: round(predictedAvg, 2),
        actualSuccessRate: round(actualSuccessRate, 2),
        count: bucket.predicted.length,
        calibrationError: round(Math.abs(predictedAvg - actualSuccessRate), 2),
      };
    })
    .filter((bin) => bin.count >= minBinCount)
    .sort((a, b) => a.binStart - b.binStart);
}

export function mapPersistedCalibrationBins(
  rows: Array<{
    predictedBin: string;
    predictedAvg: number;
    actualSuccessRate: number;
    count: number;
    calibrationError: number;
  }>,
): CalibrationBin[] {
  return rows
    .map((row) => {
      const start = Number(String(row.predictedBin).split("-")[0]);
      if (Number.isNaN(start)) return null;
      return {
        binStart: start,
        binEnd: start + 9,
        predictedAvg: row.predictedAvg,
        actualSuccessRate: row.actualSuccessRate,
        count: row.count,
        calibrationError: row.calibrationError,
      };
    })
    .filter((row): row is CalibrationBin => row !== null)
    .sort((a, b) => a.binStart - b.binStart);
}

export function resolveModelDisagreementScore(providerResults: AIProviderResult[]) {
  const decisions = providerResults
    .filter((row) => row.ok && row.output)
    .map((row) => row.output!.decision);
  const confidences = providerResults
    .filter((row) => row.ok && row.output)
    .map((row) => Number(row.output!.confidence ?? 0));
  if (!decisions.length) return { score: 0, decisions: [], confidences: [] };
  const uniqueDecisions = new Set(decisions);
  const decisionSpread = uniqueDecisions.size > 1 ? Math.min(100, (uniqueDecisions.size - 1) * 28) : 0;
  const confidenceSpread =
    confidences.length > 1 ? Math.max(...confidences) - Math.min(...confidences) : 0;
  return {
    score: round(clamp(decisionSpread + confidenceSpread * 0.35, 0, 100), 2),
    decisions: [...uniqueDecisions],
    confidences,
  };
}

export function applyConfidenceCalibration(input: {
  rawConfidence: number;
  bins?: CalibrationBin[];
  disagreementScore?: number;
  conflictScore?: number;
  agreementScore?: number;
  marketRegime?: string;
}): {
  calibratedConfidence: number;
  calibrationError: number;
  calibrationAdjustment: number;
  overestimated: boolean;
  underestimated: boolean;
} {
  const raw = clamp(Number(input.rawConfidence ?? 0), 0, 100);
  let target = raw;
  let binError = 0;
  const bin = input.bins?.find((row) => raw >= row.binStart && raw <= row.binEnd);
  if (bin) {
    binError = Math.abs(raw - bin.actualSuccessRate);
    if (bin.count >= MIN_BIN_COUNT_FOR_DECREASE && bin.actualSuccessRate < bin.predictedAvg - 1) {
      target = raw + (bin.actualSuccessRate - bin.predictedAvg) * 0.65;
    } else if (
      bin.count >= MIN_BIN_COUNT_FOR_INCREASE &&
      bin.actualSuccessRate > bin.predictedAvg + 3
    ) {
      target = raw + (bin.actualSuccessRate - bin.predictedAvg) * 0.45;
    } else {
      target = raw * 0.985;
    }
  } else {
    target = raw * 0.975;
  }
  const disagreementPenalty = (input.disagreementScore ?? 0) * 0.12;
  const conflictPenalty = (input.conflictScore ?? 0) * 0.08;
  const agreementPenalty = Math.max(0, (50 - (input.agreementScore ?? 50)) * 0.06);
  const regime = normalizeMarketRegimeLabel(input.marketRegime ?? "RANGE_SIDEWAYS");
  const regimeAdjust =
    regime === "HIGH_VOLATILITY_CHAOS" || regime === "NEWS_DRIVEN_UNSTABLE" ? -2.5 : 0;
  const calibratedUncapped = clamp(
    round(target - disagreementPenalty - conflictPenalty - agreementPenalty + regimeAdjust, 2),
    35,
    92,
  );
  const allowIncrease = Boolean(
    bin &&
      bin.count >= MIN_BIN_COUNT_FOR_INCREASE &&
      bin.actualSuccessRate > bin.predictedAvg + 3,
  );
  const calibrated = allowIncrease
    ? calibratedUncapped
    : Math.min(raw, calibratedUncapped);
  const adjustment = round(calibrated - raw, 2);
  return {
    calibratedConfidence: calibrated,
    calibrationError: round(bin ? binError : Math.abs(adjustment), 2),
    calibrationAdjustment: adjustment,
    overestimated: calibrated < raw - 0.5,
    underestimated: allowIncrease && calibrated > raw + 0.5,
  };
}

export function calibrateExpectedValue(input: {
  expectedProfitPercent: number;
  calibratedConfidence: number;
  rawConfidence: number;
  realizationRatio?: number;
}) {
  const raw = Number(input.expectedProfitPercent ?? 0);
  if (raw <= 0) return 0;
  const confidenceRatio =
    input.rawConfidence > 0 ? clamp(input.calibratedConfidence / input.rawConfidence, 0.65, 1.05) : 1;
  const realization = input.realizationRatio ?? confidenceRatio;
  return round(raw * realization, 4);
}

export function buildConfidenceCalibrationTelemetry(input: {
  result: AIConsensusResult;
  providerResults: AIProviderResult[];
  bins?: CalibrationBin[];
  marketRegime?: string;
  realizedOutcome?: { won: boolean; pnlUsdt?: number; expectedProfitPercent?: number };
}): ConfidenceCalibrationTelemetry {
  const rawConfidence = Number(input.result.finalConfidence ?? 0);
  const consensusConfidence = Number(
    input.result.finalConsensusConfidence ?? input.result.decisionPayload?.confidenceScore ?? rawConfidence,
  );
  const disagreement = resolveModelDisagreementScore(input.providerResults);
  const master = input.result.decisionPayload?.masterDecisionEngine;
  const conflictScore = Number(master?.conflictScore ?? 0);
  const agreementScore = Number(master?.agreementScore ?? 50);
  const calibrated = applyConfidenceCalibration({
    rawConfidence,
    bins: input.bins,
    disagreementScore: disagreement.score,
    conflictScore,
    agreementScore,
    marketRegime: input.marketRegime,
  });
  const expectedValueRaw = Number(input.result.analysisScorecard?.expectedMovePercent ?? 0);
  const expectedValueCalibrated = calibrateExpectedValue({
    expectedProfitPercent: expectedValueRaw,
    calibratedConfidence: calibrated.calibratedConfidence,
    rawConfidence,
  });
  const historicalWinRate = input.bins?.length
    ? round(
        input.bins.reduce((sum, bin) => sum + bin.actualSuccessRate * bin.count, 0) /
          Math.max(1, input.bins.reduce((sum, bin) => sum + bin.count, 0)),
        2,
      )
    : undefined;
  const historicalLossRate =
    historicalWinRate !== undefined ? round(100 - historicalWinRate, 2) : undefined;
  const decisionAccuracy =
    input.realizedOutcome !== undefined
      ? input.realizedOutcome.won === (input.result.finalDecision === "BUY")
        ? 100
        : 0
      : undefined;
  return {
    rawConfidence,
    calibratedConfidence: calibrated.calibratedConfidence,
    consensusConfidence,
    modelDisagreementScore: disagreement.score,
    conflictScore,
    agreementScore,
    calibrationError: calibrated.calibrationError,
    calibrationAdjustment: calibrated.calibrationAdjustment,
    overestimated: calibrated.overestimated,
    underestimated: calibrated.underestimated,
    expectedValueRaw,
    expectedValueCalibrated,
    expectedValueAccuracy:
      input.realizedOutcome?.expectedProfitPercent && input.realizedOutcome.pnlUsdt !== undefined
        ? round(
            Math.max(
              0,
              100 -
                Math.abs(
                  input.realizedOutcome.expectedProfitPercent -
                    (input.realizedOutcome.pnlUsdt >= 0 ? input.realizedOutcome.expectedProfitPercent : 0),
                ),
            ),
            2,
          )
        : undefined,
    historicalWinRate,
    historicalLossRate,
    decisionAccuracy,
    marketRegime: input.marketRegime ? normalizeMarketRegimeLabel(input.marketRegime) : undefined,
    modelConfidences: disagreement.confidences,
    providerDecisions: disagreement.decisions,
  };
}

export function applyConfidenceCalibrationToDecision(input: {
  result: AIConsensusResult;
  providerResults: AIProviderResult[];
  bins?: CalibrationBin[];
  marketRegime?: string;
}): AIConsensusResult {
  const telemetry = buildConfidenceCalibrationTelemetry({
    result: input.result,
    providerResults: input.providerResults,
    bins: input.bins,
    marketRegime: input.marketRegime,
  });
  const calibratedConfidence = telemetry.calibratedConfidence;
  return {
    ...input.result,
    finalConfidence: calibratedConfidence,
    finalConsensusConfidence: calibratedConfidence,
    decisionPayload: {
      ...(input.result.decisionPayload ?? {
        coin: "",
        entryPrice: 0,
        targetPrice: null,
        stopPrice: null,
        riskRewardRatio: 0,
        technicalReason: "",
        sentimentReason: "",
        riskAssessment: "",
        confidenceScore: calibratedConfidence,
        openTrade: input.result.finalDecision === "BUY",
      }),
      confidenceScore: calibratedConfidence,
      confidenceCalibration: telemetry,
    },
  };
}

export function aggregateCalibrationKpis(input: {
  telemetryRows: ConfidenceCalibrationTelemetry[];
  pnls?: number[];
  acceptedFlags?: boolean[];
  profitableFlags?: boolean[];
}) {
  const rows = input.telemetryRows;
  if (!rows.length) {
    return {
      sampleCount: 0,
      averageCalibrationError: 0,
      averageConfidenceAccuracy: 0,
      overestimationRate: 0,
      underestimationRate: 0,
      decisionAccuracy: 0,
      expectedValueAccuracy: 0,
    } satisfies CalibrationAggregateKpis;
  }
  const avg = (values: number[]) =>
    values.length ? round(values.reduce((a, b) => a + b, 0) / values.length, 2) : 0;
  const confidenceAccuracy = rows.map((row) =>
    Math.max(0, 100 - row.calibrationError),
  );
  const evAccuracy = rows
    .map((row) => row.expectedValueAccuracy)
    .filter((value): value is number => value !== undefined);
  const decisionAccuracy = rows
    .map((row) => row.decisionAccuracy)
    .filter((value): value is number => value !== undefined);
  const pnls = input.pnls ?? [];
  const mean = pnls.length ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0;
  const variance = pnls.length ? pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / pnls.length : 0;
  const sharpeRatio = variance > 0 ? round(mean / Math.sqrt(variance), 4) : 0;
  const downside = pnls.filter((p) => p < 0);
  const downsideVar = downside.length ? downside.reduce((s, p) => s + p ** 2, 0) / downside.length : 0;
  const sortinoRatio = downsideVar > 0 ? round(mean / Math.sqrt(downsideVar), 4) : sharpeRatio;
  const grossProfit = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(pnls.filter((p) => p < 0).reduce((a, b) => a + b, 0));
  const accepted = input.acceptedFlags ?? [];
  const profitable = input.profitableFlags ?? [];
  const falsePositives = accepted.filter((_, i) => accepted[i] && profitable[i] === false).length;
  const falseNegatives = accepted.filter((_, i) => !accepted[i] && profitable[i] === true).length;
  return {
    sampleCount: rows.length,
    averageCalibrationError: avg(rows.map((row) => row.calibrationError)),
    averageConfidenceAccuracy: avg(confidenceAccuracy),
    overestimationRate: round((rows.filter((row) => row.overestimated).length / rows.length) * 100, 2),
    underestimationRate: round((rows.filter((row) => row.underestimated).length / rows.length) * 100, 2),
    decisionAccuracy: decisionAccuracy.length ? avg(decisionAccuracy) : 0,
    expectedValueAccuracy: evAccuracy.length ? avg(evAccuracy) : 0,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 4) : grossProfit > 0 ? 999 : 0,
    sharpeRatio,
    sortinoRatio,
    falsePositiveRate: accepted.length ? round((falsePositives / accepted.length) * 100, 2) : undefined,
    falseNegativeRate: accepted.length ? round((falseNegatives / accepted.length) * 100, 2) : undefined,
  } satisfies CalibrationAggregateKpis;
}
