import type { SafetyScores, SafetyValidationStageResult } from "@/src/server/execution-safety/execution-safety.types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function calculateSafetyScores(input: {
  stages: SafetyValidationStageResult[];
  apiLatencyMs?: number;
  connectionQuality?: number;
  driftPct?: number;
}): SafetyScores {
  const total = input.stages.length;
  const passed = input.stages.filter((stage) => stage.passed).length;
  const validationQuality = total > 0 ? (passed / total) * 100 : 0;

  const apiStage = input.stages.find((stage) => stage.stage === "API");
  const marketStage = input.stages.find((stage) => stage.stage === "MARKET");
  const priceStage = input.stages.find((stage) => stage.stage === "PRICE");

  const latencyMs = input.apiLatencyMs ?? Number(apiStage?.metadata?.latencyMs ?? 0);
  const exchangeHealthScore = clamp(100 - latencyMs / 25 - Number(marketStage?.metadata?.openCircuitCount ?? 0) * 8, 0, 100);
  const driftPct = input.driftPct ?? Number(priceStage?.metadata?.driftPct ?? 0);
  const slippagePenalty = driftPct * 12;
  const safetyScore = clamp(validationQuality - slippagePenalty, 0, 100);
  const orderConfidence = clamp((validationQuality + exchangeHealthScore) / 2, 0, 100);
  const executionReadiness = clamp(
    safetyScore * 0.35 + exchangeHealthScore * 0.25 + orderConfidence * 0.25 + validationQuality * 0.15,
    0,
    100,
  );

  return {
    safetyScore: Number(safetyScore.toFixed(2)),
    exchangeHealthScore: Number(exchangeHealthScore.toFixed(2)),
    orderConfidence: Number(orderConfidence.toFixed(2)),
    validationQuality: Number(validationQuality.toFixed(2)),
    executionReadiness: Number(executionReadiness.toFixed(2)),
  };
}
