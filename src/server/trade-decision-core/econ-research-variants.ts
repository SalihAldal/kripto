import type { StrategyVariantConfig } from "./types";

/** Pre-registered economic hypotheses — frozen parameters in econ-breakout-entry.service.ts */
export const ECON_HYPOTHESIS_VARIANTS: StrategyVariantConfig[] = [
  {
    id: "econ_breakout_rs_pr04",
    entryCandidate: "econ_breakout_rs",
    exitMode: "pr04_trail",
    alphaId: "ECON_BREAKOUT_RS",
    oiFundingRequired: false,
    researchOnly: true,
    label: "Volume+RS breakout continuation (TRY confirmed) + PR04",
    targetsLossMechanism: "breakout_failure+giveback",
  },
  {
    id: "econ_pullback_reclaim_pr04",
    entryCandidate: "econ_pullback_reclaim",
    exitMode: "pr04_trail",
    alphaId: "ECON_PULLBACK_RECLAIM",
    oiFundingRequired: false,
    researchOnly: true,
    label: "Post-breakout controlled pullback reclaim + PR04",
    targetsLossMechanism: "pullback_failure+giveback",
  },
];
