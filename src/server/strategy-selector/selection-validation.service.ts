import type { ValidationResult } from "@/src/server/strategy-selector/strategy-selector.types";
import type { RegimeDetectionResult, StrategyScore } from "@/src/server/strategy-selector/strategy-selector.types";

export function validateStrategySelection(
  regime: RegimeDetectionResult,
  primary: StrategyScore,
  snapshotAgeMs: number,
): ValidationResult {
  const details: string[] = [];
  const regimeConfidence = regime.regimeConfidence;
  const strategyConfidence = primary.confidence;
  const historicalSimilarity = primary.historicalAccuracy;
  const compatibility = primary.marketCompatibility;
  const dataFreshness = snapshotAgeMs < 300_000 ? 95 : snapshotAgeMs < 900_000 ? 70 : 40;

  if (regimeConfidence < 45) details.push("Regime confidence below threshold");
  if (strategyConfidence < 50) details.push("Strategy confidence below threshold");
  if (compatibility < 40) details.push("Market compatibility insufficient");
  if (dataFreshness < 60) details.push("Market data stale");

  const passed =
    regimeConfidence >= 45 &&
    strategyConfidence >= 50 &&
    compatibility >= 40 &&
    dataFreshness >= 60 &&
    historicalSimilarity >= 30;

  return {
    passed,
    regimeConfidence,
    strategyConfidence,
    historicalSimilarity,
    compatibility,
    dataFreshness,
    details,
  };
}
