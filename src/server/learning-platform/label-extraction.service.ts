import type { DatasetLabels } from "@/src/server/learning-platform/learning-platform.types";

type HistoricalOutcomeRow = {
  horizonLabel: string;
  returnPct: number | null;
  mfePct: number | null;
  maePct: number | null;
};

type EvaluationRow = {
  mfePct: number | null;
  maePct: number | null;
  peakProfitPct: number | null;
  maxDrawdownPct: number | null;
  missedProfitPct: number | null;
  horizonReturns?: unknown;
};

function num(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function horizonFromOutcomes(outcomes: HistoricalOutcomeRow[], label: string) {
  const row = outcomes.find((o) => o.horizonLabel.toUpperCase() === label.toUpperCase());
  return row ? num(row.returnPct) : null;
}

export function extractLabelsFromReplay(
  evaluation: EvaluationRow,
  historicalOutcomes: HistoricalOutcomeRow[],
): DatasetLabels {
  const horizonReturns = (evaluation.horizonReturns as Record<string, number> | null) ?? {};
  const return1h = horizonFromOutcomes(historicalOutcomes, "1H") ?? num(horizonReturns["1h"] ?? horizonReturns["1H"]);
  const return4h = horizonFromOutcomes(historicalOutcomes, "4H") ?? num(horizonReturns["4h"] ?? horizonReturns["4H"]);
  const return12h = horizonFromOutcomes(historicalOutcomes, "12H") ?? num(horizonReturns["12h"] ?? horizonReturns["12H"]);
  const return24h = horizonFromOutcomes(historicalOutcomes, "24H") ?? num(horizonReturns["24h"] ?? horizonReturns["24H"]);

  const mfe = num(evaluation.mfePct);
  const mae = num(evaluation.maePct);
  const peak = num(evaluation.peakProfitPct) ?? 0;
  const tradeSuccess = peak > 0.5;
  const tradeFailure = peak < -0.5;

  const expectedRr =
    mfe != null && mae != null && Math.abs(mae) > 0.01 ? Number((mfe / Math.abs(mae)).toFixed(3)) : null;

  return {
    return1h,
    return4h,
    return12h,
    return24h,
    mfe,
    mae,
    tradeSuccess,
    tradeFailure,
    expectedRr,
    peakProfitPct: num(evaluation.peakProfitPct),
    maxDrawdownPct: num(evaluation.maxDrawdownPct),
  };
}

export function labelFromDatasetLabels(labels: DatasetLabels): string {
  if (labels.tradeSuccess) return "BUY";
  if (labels.tradeFailure) return "NO_TRADE";
  if ((labels.return4h ?? 0) > 0.3) return "BUY";
  if ((labels.return4h ?? 0) < -0.3) return "NO_TRADE";
  return "WAIT";
}
