import { PR04_POLICY_VERSION, type ExitPolicyId } from "@/src/server/profitability/pr04-types";

export type ExitPolicyDefinition = {
  exitPolicyId: ExitPolicyId;
  version: typeof PR04_POLICY_VERSION;
  hypothesis: string;
  requiredData: string[];
  structuralStop: boolean;
  fixedTarget: boolean;
  trailing: boolean;
  partialLegs: Array<{ legId: string; targetProfitPct: number; fractionOfInitial: number }>;
  timeExitMs: number | null;
  timeReference: "FIRST_FILL" | "POSITION_OPEN";
  trailingActivationPct: number | null;
  trailingGapPct: number | null;
  missingDataBehavior: "NO_EXIT" | "STRUCTURAL_ONLY";
  priorityOrder: string[];
  parameterSource: "PROVISIONAL_CONFIG";
  experimentalDefault: boolean;
  activeDefault: boolean;
};

const PROVISIONAL = "PROVISIONAL_CONFIG" as const;

export const EXIT_POLICY_REGISTRY: Record<ExitPolicyId, ExitPolicyDefinition> = {
  BASELINE_FIXED_TP_SL: {
    exitPolicyId: "BASELINE_FIXED_TP_SL",
    version: PR04_POLICY_VERSION,
    hypothesis: "Fixed TP/SL baseline without structural invalidation overlay.",
    requiredData: ["markPrice", "takeProfitPercent", "stopLossPrice"],
    structuralStop: false,
    fixedTarget: true,
    trailing: false,
    partialLegs: [],
    timeExitMs: null,
    timeReference: "FIRST_FILL",
    trailingActivationPct: null,
    trailingGapPct: null,
    missingDataBehavior: "NO_EXIT",
    priorityOrder: ["TAKE_PROFIT", "STRUCTURAL_STOP"],
    parameterSource: PROVISIONAL,
    experimentalDefault: false,
    activeDefault: true,
  },
  STRUCTURAL_STOP_TARGET: {
    exitPolicyId: "STRUCTURAL_STOP_TARGET",
    version: PR04_POLICY_VERSION,
    hypothesis: "PR02/PR03 structural invalidation stop with fixed percent target.",
    requiredData: ["markPrice", "invalidationThreshold", "takeProfitPercent"],
    structuralStop: true,
    fixedTarget: true,
    trailing: false,
    partialLegs: [],
    timeExitMs: null,
    timeReference: "FIRST_FILL",
    trailingActivationPct: null,
    trailingGapPct: null,
    missingDataBehavior: "STRUCTURAL_ONLY",
    priorityOrder: ["STRUCTURAL_STOP", "TAKE_PROFIT"],
    parameterSource: PROVISIONAL,
    experimentalDefault: true,
    activeDefault: false,
  },
  STRUCTURAL_STOP_TRAIL: {
    exitPolicyId: "STRUCTURAL_STOP_TRAIL",
    version: PR04_POLICY_VERSION,
    hypothesis: "Structural stop with causal one-way trailing after activation.",
    requiredData: ["markPrice", "invalidationThreshold", "highWaterMark"],
    structuralStop: true,
    fixedTarget: false,
    trailing: true,
    partialLegs: [],
    timeExitMs: null,
    timeReference: "FIRST_FILL",
    trailingActivationPct: 1.2,
    trailingGapPct: 0.45,
    missingDataBehavior: "STRUCTURAL_ONLY",
    priorityOrder: ["STRUCTURAL_STOP", "TRAILING_STOP"],
    parameterSource: PROVISIONAL,
    experimentalDefault: true,
    activeDefault: false,
  },
  STRUCTURAL_PARTIAL_TRAIL: {
    exitPolicyId: "STRUCTURAL_PARTIAL_TRAIL",
    version: PR04_POLICY_VERSION,
    hypothesis: "Structural stop, 25% partial at +2.5%, trailing on remainder.",
    requiredData: ["markPrice", "invalidationThreshold", "highWaterMark", "stepSize"],
    structuralStop: true,
    fixedTarget: false,
    trailing: true,
    partialLegs: [{ legId: "leg-25", targetProfitPct: 2.5, fractionOfInitial: 0.25 }],
    timeExitMs: null,
    timeReference: "FIRST_FILL",
    trailingActivationPct: 1.5,
    trailingGapPct: 0.4,
    missingDataBehavior: "STRUCTURAL_ONLY",
    priorityOrder: ["STRUCTURAL_STOP", "PARTIAL_TAKE_PROFIT", "TRAILING_STOP"],
    parameterSource: PROVISIONAL,
    experimentalDefault: true,
    activeDefault: false,
  },
  STRUCTURAL_TIME_DECAY: {
    exitPolicyId: "STRUCTURAL_TIME_DECAY",
    version: PR04_POLICY_VERSION,
    hypothesis: "Structural stop plus time decay if progress insufficient.",
    requiredData: ["markPrice", "invalidationThreshold", "timeAnchor"],
    structuralStop: true,
    fixedTarget: false,
    trailing: false,
    partialLegs: [],
    timeExitMs: 90 * 60_000,
    timeReference: "FIRST_FILL",
    trailingActivationPct: null,
    trailingGapPct: null,
    missingDataBehavior: "STRUCTURAL_ONLY",
    priorityOrder: ["STRUCTURAL_STOP", "TIME_EXIT"],
    parameterSource: PROVISIONAL,
    experimentalDefault: true,
    activeDefault: false,
  },
};

export function getExitPolicyDefinition(policyId: ExitPolicyId) {
  return EXIT_POLICY_REGISTRY[policyId];
}

export function defaultExitPolicyId(): ExitPolicyId {
  return "BASELINE_FIXED_TP_SL";
}
