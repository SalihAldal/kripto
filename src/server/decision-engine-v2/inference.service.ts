import type { MLDecisionLabel } from "@prisma/client";
import type {
  DecisionEngineV2FeatureVector,
  InferenceArtifact,
  DecisionEngineV2Prediction,
} from "@/src/server/decision-engine-v2/decision-engine-v2.types";
import { featureVectorToArray } from "@/src/server/decision-engine-v2/feature-vector.service";
import { calibrateProbabilities } from "@/src/server/decision-engine-v2/calibration.service";

const LABELS: MLDecisionLabel[] = ["BUY", "WAIT", "NO_TRADE"];

function softmax(logits: number[]) {
  const max = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - max));
  const sum = exps.reduce((s, v) => s + v, 0);
  return exps.map((v) => v / Math.max(sum, 1e-9));
}

function normalizeFeatures(values: number[], means: number[], stds: number[]) {
  return values.map((v, i) => {
    const std = stds[i] > 1e-9 ? stds[i] : 1;
    return (v - means[i]) / std;
  });
}

export function runInference(input: {
  artifact: InferenceArtifact;
  features: DecisionEngineV2FeatureVector;
  modelId: string;
  modelVersion: string;
}): Omit<DecisionEngineV2Prediction, "inferenceTimeMs"> {
  const { artifact, features, modelId, modelVersion } = input;
  const rawValues = featureVectorToArray(features, artifact.featureNames);
  const normalized = normalizeFeatures(rawValues, artifact.featureMeans, artifact.featureStds);

  const logits = artifact.classLabels.map((_, classIdx) => {
    let sum = artifact.intercepts[classIdx] ?? 0;
    for (let i = 0; i < normalized.length; i += 1) {
      sum += (artifact.coefficients[classIdx]?.[i] ?? 0) * normalized[i];
    }
    return sum;
  });

  const probs = softmax(logits);
  const rawProbabilities = Object.fromEntries(
    artifact.classLabels.map((label, i) => [label, Number((probs[i] * 100).toFixed(4))]),
  ) as Record<MLDecisionLabel, number>;

  const calibratedProbabilities = calibrateProbabilities(rawProbabilities, artifact);
  let bestLabel: MLDecisionLabel = "NO_TRADE";
  let bestProb = -1;
  for (const label of LABELS) {
    const p = calibratedProbabilities[label] ?? 0;
    if (p > bestProb) {
      bestProb = p;
      bestLabel = label;
    }
  }

  const stats = artifact.outcomeStats[bestLabel];
  const topFeatures = artifact.featureNames
    .map((name, i) => ({ name, value: rawValues[i] }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 4)
    .map((row) => `${row.name}=${row.value.toFixed(2)}`)
    .join(", ");

  return {
    decision: bestLabel,
    confidence: Number(bestProb.toFixed(2)),
    rawProbabilities,
    calibratedProbabilities,
    expectedReturn: stats?.expectedReturn ?? 0,
    expectedRisk: stats?.expectedRisk ?? 0,
    expectedHoldingMinutes: stats?.expectedHoldingMinutes ?? 90,
    expectedMaxDrawdown: stats?.expectedMaxDrawdown ?? 0,
    expectedMaxProfit: stats?.expectedMaxProfit ?? 0,
    reason: `ML ${artifact.algorithm} → ${bestLabel} (${bestProb.toFixed(1)}%) | ${topFeatures}`,
    modelId,
    modelVersion,
    featuresUsed: features,
  };
}

export function buildFallbackArtifact(): InferenceArtifact {
  const featureNames = [
    "momentum",
    "relativeVolume",
    "atr",
    "vwapDistance",
    "rsi",
    "emaDistance",
    "btcStrength",
    "ethStrength",
    "spread",
    "liquidity",
    "orderbookImbalance",
    "volatility",
    "discoveryScore",
    "marketRegimeScore",
    "historicalCoinBehaviour",
    "confidencePrior",
  ] as const;

  const means = featureNames.map(() => 0);
  const stds = featureNames.map(() => 1);
  const classLabels: MLDecisionLabel[] = ["BUY", "WAIT", "NO_TRADE"];

  const coefficients = [
    [0.35, 0.25, 0.05, 0.1, 0.08, 0.06, 0.12, 0.08, -0.2, 0.1, 0.15, -0.05, 0.2, 0.15, 0.1, 0.12],
    [0.1, 0.08, 0.02, 0.03, 0.02, 0.02, 0.04, 0.03, -0.05, 0.03, 0.04, -0.02, 0.05, 0.04, 0.03, 0.04],
    [-0.25, -0.15, -0.04, -0.08, -0.06, -0.05, -0.1, -0.06, 0.15, -0.06, -0.1, 0.04, -0.12, -0.1, -0.06, -0.08],
  ];

  return {
    algorithm: "GRADIENT_BOOSTING",
    featureNames: [...featureNames],
    classLabels,
    featureMeans: means,
    featureStds: stds,
    coefficients,
    intercepts: [0.2, 0, -0.2],
    calibration: { method: "PLATT", platt: { a: 1.1, b: -0.05 } },
    outcomeStats: {
      BUY: { expectedReturn: 2.1, expectedRisk: 1.2, expectedHoldingMinutes: 90, expectedMaxDrawdown: 1.5, expectedMaxProfit: 4.2 },
      WAIT: { expectedReturn: 0.4, expectedRisk: 0.8, expectedHoldingMinutes: 180, expectedMaxDrawdown: 0.8, expectedMaxProfit: 1.2 },
      NO_TRADE: { expectedReturn: 0, expectedRisk: 0.3, expectedHoldingMinutes: 0, expectedMaxDrawdown: 0.2, expectedMaxProfit: 0 },
    },
  };
}
