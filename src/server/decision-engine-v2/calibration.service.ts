import type { CalibrationMethod, MLDecisionLabel } from "@prisma/client";
import type { InferenceArtifact } from "@/src/server/decision-engine-v2/decision-engine-v2.types";

const LABELS: MLDecisionLabel[] = ["BUY", "WAIT", "NO_TRADE"];

function sigmoid(x: number) {
  return 1 / (1 + Math.exp(-x));
}

export function applyPlattScaling(probabilities: Record<MLDecisionLabel, number>, a: number, b: number) {
  const calibrated = {} as Record<MLDecisionLabel, number>;
  let sum = 0;
  for (const label of LABELS) {
    const p = probabilities[label] ?? 0;
    calibrated[label] = sigmoid(a * p + b);
    sum += calibrated[label];
  }
  if (sum <= 0) return probabilities;
  for (const label of LABELS) calibrated[label] = calibrated[label] / sum;
  return calibrated;
}

export function applyIsotonicRegression(probabilities: Record<MLDecisionLabel, number>, x: number[], y: number[]) {
  if (x.length === 0 || y.length === 0) return probabilities;
  const calibrated = {} as Record<MLDecisionLabel, number>;
  let sum = 0;
  for (const label of LABELS) {
    const p = probabilities[label] ?? 0;
    calibrated[label] = interpolateIsotonic(p, x, y);
    sum += calibrated[label];
  }
  if (sum <= 0) return probabilities;
  for (const label of LABELS) calibrated[label] = calibrated[label] / sum;
  return calibrated;
}

function interpolateIsotonic(value: number, x: number[], y: number[]) {
  if (value <= x[0]) return y[0];
  if (value >= x[x.length - 1]) return y[y.length - 1];
  for (let i = 1; i < x.length; i += 1) {
    if (value <= x[i]) {
      const span = x[i] - x[i - 1];
      if (span <= 0) return y[i];
      const ratio = (value - x[i - 1]) / span;
      return y[i - 1] + ratio * (y[i] - y[i - 1]);
    }
  }
  return y[y.length - 1];
}

export function calibrateProbabilities(
  raw: Record<MLDecisionLabel, number>,
  artifact: InferenceArtifact,
): Record<MLDecisionLabel, number> {
  const method = artifact.calibration.method;
  if (method === "PLATT" && artifact.calibration.platt) {
    return applyPlattScaling(raw, artifact.calibration.platt.a, artifact.calibration.platt.b);
  }
  if (method === "ISOTONIC" && artifact.calibration.isotonic) {
    return applyIsotonicRegression(raw, artifact.calibration.isotonic.x, artifact.calibration.isotonic.y);
  }
  return raw;
}

export function fitPlattParams(rawScores: number[], labels: number[]) {
  let a = 1;
  let b = 0;
  for (let epoch = 0; epoch < 50; epoch += 1) {
    let gradA = 0;
    let gradB = 0;
    for (let i = 0; i < rawScores.length; i += 1) {
      const z = a * rawScores[i] + b;
      const pred = sigmoid(z);
      const err = pred - labels[i];
      gradA += err * rawScores[i];
      gradB += err;
    }
    a -= 0.01 * (gradA / Math.max(rawScores.length, 1));
    b -= 0.01 * (gradB / Math.max(rawScores.length, 1));
  }
  return { a, b };
}

export function fitIsotonicCurve(rawScores: number[], labels: number[]) {
  const pairs = rawScores
    .map((x, i) => ({ x, y: labels[i] }))
    .sort((a, b) => a.x - b.x);
  const buckets = new Map<number, { sum: number; count: number }>();
  for (const pair of pairs) {
    const key = Math.round(pair.x * 100) / 100;
    const bucket = buckets.get(key) ?? { sum: 0, count: 0 };
    bucket.sum += pair.y;
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  const x: number[] = [];
  const y: number[] = [];
  for (const [key, bucket] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    x.push(key);
    y.push(bucket.sum / bucket.count);
  }
  return { x, y };
}
