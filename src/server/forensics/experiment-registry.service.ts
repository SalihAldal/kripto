import { createHash } from "node:crypto";
import type {
  ProfitabilityExperimentRecord,
  ProfitabilityExperimentRegistry,
  PromotionGateStatus,
  StrategyComparisonReport,
} from "@/src/server/forensics/forensic.types";

function deterministicHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

export function buildExperimentRegistry(input: {
  experiments: Array<{
    experimentId: string;
    baseline: string;
    variant: string;
    hypothesis: string;
    parameters: Record<string, unknown>;
    report: StrategyComparisonReport | { baseline: { metrics: ProfitabilityExperimentRecord["metrics"] }; candidate: { metrics: ProfitabilityExperimentRecord["metrics"] } };
    promotionStatus: PromotionGateStatus;
    acceptanceTest: string;
  }>;
}): ProfitabilityExperimentRegistry {
  const experiments: ProfitabilityExperimentRecord[] = input.experiments.map((exp) => {
    const before =
      "baseline" in exp.report && "metrics" in exp.report.baseline
        ? exp.report.baseline.metrics
        : (exp.report as StrategyComparisonReport).baseline.metrics;
    const after =
      "candidate" in exp.report && "metrics" in exp.report.candidate
        ? exp.report.candidate.metrics
        : (exp.report as StrategyComparisonReport).candidate.metrics;
    return {
      experimentId: exp.experimentId,
      baseline: exp.baseline,
      variant: exp.variant,
      hypothesis: exp.hypothesis,
      parameters: exp.parameters,
      sample: before.sampleSize,
      metrics: after,
      risk: { maxDrawdown: after.maxDrawdown, riskExposure: undefined },
      result: exp.promotionStatus,
      promotionStatus: exp.promotionStatus,
      acceptanceTest: exp.acceptanceTest,
    };
  });

  const registry: ProfitabilityExperimentRegistry = {
    generatedAt: new Date().toISOString(),
    experiments,
    safetyPreserved: {
      aiGate: true,
      riskGate: true,
      sizingGate: true,
      executionIntegrity: true,
      pnlReconciliation: true,
    },
    deterministicHash: "",
  };
  registry.deterministicHash = deterministicHash({ experiments, safetyPreserved: registry.safetyPreserved });
  return registry;
}
