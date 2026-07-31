import type { ModelEvaluationMetrics } from "@/src/server/learning-platform/learning-platform.types";

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function computeTradingMetrics(returns: number[]): Pick<
  ModelEvaluationMetrics,
  "profitFactor" | "expectancy" | "sharpe" | "sortino" | "maxDrawdown"
> {
  if (returns.length === 0) {
    return { profitFactor: 0, expectancy: 0, sharpe: 0, sortino: 0, maxDrawdown: 0 };
  }

  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r < 0);
  const grossProfit = wins.reduce((s, v) => s + v, 0);
  const grossLoss = Math.abs(losses.reduce((s, v) => s + v, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
  const expectancy = returns.reduce((s, v) => s + v, 0) / returns.length;

  const mean = expectancy;
  const variance = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance) || 1e-9;
  const sharpe = (mean / std) * Math.sqrt(252);

  const downside = returns.filter((r) => r < 0);
  const downVar = downside.length > 0 ? downside.reduce((s, v) => s + v ** 2, 0) / downside.length : variance;
  const downStd = Math.sqrt(downVar) || 1e-9;
  const sortino = (mean / downStd) * Math.sqrt(252);

  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  for (const r of returns) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  return {
    profitFactor: Number(profitFactor.toFixed(4)),
    expectancy: Number(expectancy.toFixed(4)),
    sharpe: Number(sharpe.toFixed(4)),
    sortino: Number(sortino.toFixed(4)),
    maxDrawdown: Number(maxDrawdown.toFixed(4)),
  };
}

export function computeClassificationMetrics(
  predicted: string[],
  actual: string[],
): Pick<ModelEvaluationMetrics, "accuracy" | "precision" | "recall" | "f1" | "rocAuc" | "prAuc" | "sampleSize"> {
  const n = Math.min(predicted.length, actual.length);
  if (n === 0) {
    return { accuracy: 0, precision: 0, recall: 0, f1: 0, rocAuc: 0.5, prAuc: 0.5, sampleSize: 0 };
  }

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (let i = 0; i < n; i += 1) {
    const p = predicted[i] === "BUY";
    const a = actual[i] === "BUY";
    if (p && a) tp += 1;
    else if (p && !a) fp += 1;
    else if (!p && a) fn += 1;
    else tn += 1;
  }

  const accuracy = (tp + tn) / n;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    accuracy: Number(accuracy.toFixed(4)),
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number(f1.toFixed(4)),
    rocAuc: Number(((accuracy + recall) / 2).toFixed(4)),
    prAuc: Number(precision.toFixed(4)),
    sampleSize: n,
  };
}

export function evaluateDatasetRows(
  rows: Array<{ labels: Record<string, unknown>; decision: string }>,
): ModelEvaluationMetrics {
  const returns = rows.map((r) => num((r.labels as { peakProfitPct?: number }).peakProfitPct ?? (r.labels as { return4h?: number }).return4h));
  const trading = computeTradingMetrics(returns);
  const predicted = rows.map((r) => {
    const labels = r.labels as { tradeSuccess?: boolean; return4h?: number };
    if (labels.tradeSuccess) return "BUY";
    if ((labels.return4h ?? 0) > 0.3) return "BUY";
    return "NO_TRADE";
  });
  const actual = rows.map((r) => (r.decision.toUpperCase().includes("BUY") ? "BUY" : "NO_TRADE"));
  const classification = computeClassificationMetrics(predicted, actual);

  return { ...classification, ...trading };
}
