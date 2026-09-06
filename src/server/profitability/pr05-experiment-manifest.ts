import type { StrategyId } from "@/src/server/forensics/p4-regime-strategy-shadow";
import { createHash } from "node:crypto";
import { PR02_POLICY_VERSION } from "@/src/server/profitability/pr02-types";
import { PR03_POLICY_VERSION } from "@/src/server/profitability/pr03-types";
import { PR04_POLICY_VERSION } from "@/src/server/profitability/pr04-types";
import { EXIT_POLICY_REGISTRY } from "@/src/server/profitability/pr04-policy-registry";
import {
  PR05_EXPERIMENT_ID,
  PR05_POLICY_VERSION,
  PR05_SCHEMA_VERSION,
  type Pr05ExperimentManifest,
} from "@/src/server/profitability/pr05-types";

export function createLockedPr05ExperimentManifest(input: {
  headCommit: string;
  recordedMarketAvailable: boolean;
  priorDevelopmentRangesTouched: boolean;
  lockedAtMs?: number;
}): Pr05ExperimentManifest {
  const lockedAtMs = input.lockedAtMs ?? Date.now();
  const exitPolicyIds = Object.keys(EXIT_POLICY_REGISTRY) as Pr05ExperimentManifest["exitPolicyIds"];
  const body = {
    schemaVersion: PR05_SCHEMA_VERSION,
    experimentId: PR05_EXPERIMENT_ID,
    version: PR05_POLICY_VERSION,
    strategies: ["EARLY_ACCELERATION", "MOMENTUM_CONTINUATION", "BREAKOUT_RETEST"] as StrategyId[],
    exitPolicyIds,
    baselinePolicyId: "BASELINE_FIXED_TP_SL" as const,
    primaryMetric: "NET_EXPECTANCY_PER_CLOSED_TRADE" as const,
    secondaryMetrics: [
      "WIN_RATE",
      "PROFIT_FACTOR",
      "MAX_DRAWDOWN",
      "CENSORED_COUNT",
      "FEE_SLIPPAGE_SHARE",
      "LARGEST_WINNER_SHARE",
    ],
    costAssumptions: ["configured-taker-fee", "fill-price-includes-spread-flag"],
    fillAssumptions: ["simulated-fill-on-decision-tick", "no-imaginary-fill-without-price"],
    startingCapital: 10_000,
    riskLimits: ["canonical-risk-decision-unchanged", "no-loosening-for-experiment"],
    splitRatios: { train: 0.6, validation: 0.2, test: 0.2 },
    embargoMs: 5 * 60_000,
    purgeRule: "LABEL_END_PLUS_EMBARGO" as const,
    minClosedTradesPerSplit: 30,
    minIndependentLifecycleGroups: 20,
    negativeControl: {
      method: "CAUSAL_ENTRY_TIME_SHIFT" as const,
      seed: 42_026_0906,
      iterations: 200,
      breaks: ["entry-signal-timing-dependency"],
      preserves: ["exit-engine", "cost-model", "venue-eligibility"],
    },
    uncertaintyMethod: "BLOCK_BOOTSTRAP_BY_LIFECYCLE" as const,
    candidateRules: [
      "require-recorded-market-data",
      "require-min-closed-trades-per-split",
      "require-negative-control-not-fail",
      "require-holdout-provenance-independent",
      "no-promotion-without-holdout",
    ],
    costStressScenarios: ["BASE", "FEE_PLUS_50PCT", "SLIPPAGE_PLUS_25BPS", "LATENCY_PLUS_1TICK"],
    resourceLimits: ["no-new-market-download", "no-production-db-write", "no-live-orders"],
    codeFingerprint: {
      headCommit: input.headCommit,
      pr02PolicyVersion: PR02_POLICY_VERSION,
      pr03PolicyVersion: PR03_POLICY_VERSION,
      pr04PolicyVersion: PR04_POLICY_VERSION,
    },
    dataFingerprint: {
      recordedMarketAvailable: input.recordedMarketAvailable,
      syntheticFixtureAllowed: true,
      priorDevelopmentRangesTouched: input.priorDevelopmentRangesTouched,
    },
  };
  const manifestHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  return {
    ...body,
    manifestHash,
    lockedAtMs,
  };
}

export function verifyExperimentManifestUnchanged(original: Pr05ExperimentManifest, candidate: Pr05ExperimentManifest) {
  return original.manifestHash === candidate.manifestHash;
}
