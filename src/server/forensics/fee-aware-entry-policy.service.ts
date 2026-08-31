import type { FeeAwareEntryPolicyEvaluation, FeeEdgeMetricsSnapshot } from "@/src/server/forensics/forensic.types";
import { classifyFeeEdge } from "@/src/server/forensics/fee-edge-metrics.service";

export const FEE_AWARE_ENTRY_POLICY_VERSION = "fee-aware-v1";

export function evaluateFeeAwareEntryPolicy(input: {
  metrics: FeeEdgeMetricsSnapshot;
  blockingEnabled?: boolean;
  minGrossToFeeRatio?: number;
}): FeeAwareEntryPolicyEvaluation {
  const blockingEnabled = Boolean(input.blockingEnabled);
  const minRatio = Number(input.minGrossToFeeRatio ?? 1);
  const ratio = Number(input.metrics.expectedGrossToFeeRatio ?? 0);
  const coversFees = Number(input.metrics.expectedNetAfterFeesAtTp ?? 0) >= 0;
  const passByRatio = ratio >= minRatio && coversFees;

  let verdict: FeeAwareEntryPolicyEvaluation["verdict"] = "OBSERVE";
  let reasonCode = passByRatio ? "FEE_EDGE_PASS_OBSERVE" : "FEE_EDGE_BELOW_TARGET";
  let reasonDetail = passByRatio
    ? `Expected TP gross covers round-trip fees (ratio=${ratio}); blocking disabled`
    : `Fee drag visible (ratio=${ratio}, min=${minRatio}); blocking disabled`;

  if (blockingEnabled) {
    if (passByRatio) {
      verdict = "PASS";
      reasonCode = "FEE_EDGE_PASS";
      reasonDetail = `Expected TP gross covers round-trip fees (ratio=${ratio})`;
    } else {
      verdict = "BLOCK";
      reasonCode = "FEE_EDGE_BLOCK";
      reasonDetail = `Expected gross edge does not cover round-trip fees (ratio=${ratio}, min=${minRatio})`;
    }
  }

  return {
    policyVersion: FEE_AWARE_ENTRY_POLICY_VERSION,
    verdict,
    feeEdgeClass: classifyFeeEdge({
      expectedGross: input.metrics.expectedGrossAtTp,
      expectedNet: input.metrics.expectedNetAfterFeesAtTp,
      fee: input.metrics.estimatedRoundTripFees,
      ratio,
    }),
    expectedGrossToFeeRatio: ratio,
    minimumGrossToCoverFees: input.metrics.minimumGrossToCoverFees,
    estimatedRoundTripFees: input.metrics.estimatedRoundTripFees,
    expectedNetAfterFeesAtTp: input.metrics.expectedNetAfterFeesAtTp,
    minGrossToFeeRatio: minRatio,
    minGrossToFeeRatioSource: "fee-aware-entry-policy.minGrossToFeeRatio(default=1)",
    blockingEnabled,
    reasonCode,
    reasonDetail,
    timestamp: new Date().toISOString(),
  };
}
