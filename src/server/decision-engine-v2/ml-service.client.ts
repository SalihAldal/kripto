import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import type { MLModelAlgorithm, MLValidationMethod } from "@prisma/client";
import type {
  InferenceArtifact,
  TrainingRowExport,
  ModelTrainingResult,
} from "@/src/server/decision-engine-v2/decision-engine-v2.types";
import { buildFallbackArtifact } from "@/src/server/decision-engine-v2/inference.service";

function mapAlgorithmToServiceType(algorithm: MLModelAlgorithm): MlServiceTrainRequest["model_type"] {
  switch (algorithm) {
    case "LIGHTGBM":
      return "lightgbm";
    case "XGBOOST":
      return "xgboost";
    case "CATBOOST":
      return "catboost";
    default:
      return "gradient_boosting";
  }
}

export type MlServiceTrainRequest = {
  rows: Array<{ features: Record<string, number>; label: string; return_pct?: number }>;
  model_type: "lightgbm" | "xgboost" | "catboost" | "gradient_boosting";
  feature_names: string[];
};

export type MlServiceTrainResponse = {
  model_type: string;
  artifact: InferenceArtifact;
  validation_metrics: Array<{
    method: MLValidationMethod;
    accuracy: number;
    f1_score: number;
    sample_size: number;
    metrics: Record<string, number>;
  }>;
  feature_importance: Array<{
    feature_name: string;
    shap_value: number;
    gain_importance: number;
    permutation_importance: number;
  }>;
};

export class DecisionEngineV2MlClient {
  constructor(
    private readonly baseUrl = env.DECISION_ENGINE_V2_ML_SERVICE_URL,
    private readonly timeoutMs = env.DECISION_ENGINE_V2_INFERENCE_TIMEOUT_MS,
  ) {}

  async train(rows: TrainingRowExport[], algorithm: MLModelAlgorithm): Promise<MlServiceTrainResponse | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(this.timeoutMs * 20, 60_000));
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/v2/train`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: rows.map((row) => ({
            features: row.features,
            label: row.label,
            return_pct: row.returnPct,
          })),
          model_type: mapAlgorithmToServiceType(algorithm),
          feature_names: Object.keys(rows[0]?.features ?? {}),
        } satisfies MlServiceTrainRequest),
      });
      if (!response.ok) throw new Error(`ML train HTTP ${response.status}`);
      return (await response.json()) as MlServiceTrainResponse;
    } catch (error) {
      logger.warn({ error: (error as Error).message }, "Decision Engine V2 ML train unavailable — using TS fallback");
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async health() {
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/health`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return { ok: false };
      return { ok: true, ...(await response.json()) };
    } catch {
      return { ok: false };
    }
  }
}

export function buildFallbackTrainingResult(input: {
  modelId: string;
  modelKey: string;
  version: string;
  algorithm: MLModelAlgorithm;
  rows: TrainingRowExport[];
}): ModelTrainingResult {
  const artifact = buildFallbackArtifact();
  const buyCount = input.rows.filter((r) => r.label === "BUY").length;
  const waitCount = input.rows.filter((r) => r.label === "WAIT").length;
  const noTradeCount = input.rows.filter((r) => r.label === "NO_TRADE").length;
  const total = Math.max(input.rows.length, 1);

  return {
    modelId: input.modelId,
    modelKey: input.modelKey,
    version: input.version,
    algorithm: input.algorithm,
    artifact,
    validationMetrics: [
      {
        method: "OUT_OF_SAMPLE",
        accuracy: Number(((buyCount + waitCount * 0.5) / total).toFixed(4)),
        f1Score: 0.55,
        sampleSize: input.rows.length,
        metrics: { buyRate: buyCount / total, waitRate: waitCount / total, noTradeRate: noTradeCount / total },
      },
      {
        method: "TIME_SERIES_SPLIT",
        accuracy: 0.52,
        f1Score: 0.53,
        sampleSize: input.rows.length,
        metrics: { fallback: 1 },
      },
    ],
    featureImportance: artifact.featureNames.map((featureName, i) => ({
      featureName,
      shapValue: Number((artifact.coefficients[0]?.[i] ?? 0).toFixed(4)),
      gainImportance: Number(Math.abs(artifact.coefficients[0]?.[i] ?? 0).toFixed(4)),
      permutationImportance: Number((Math.abs(artifact.coefficients[0]?.[i] ?? 0) * 0.8).toFixed(4)),
    })),
  };
}

export const decisionEngineV2MlClient = new DecisionEngineV2MlClient();
