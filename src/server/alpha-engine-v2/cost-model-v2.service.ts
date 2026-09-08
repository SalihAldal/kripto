export const COST_MODEL_V2_VERSION = "v2.0.0";

export const SPOT_COST_REALISTIC = {
  takerFeePerSidePct: 0.15,
  roundTripFeePct: 0.3,
  slippageBpsPerSide: 7,
  realisticSlippageRtPct: 0.14,
  realisticRoundTripPct: 0.44,
  stressSlippageRtPct: 70,
  stressRoundTripPct: 1.0,
} as const;

export const FUTURES_COST_REALISTIC = {
  takerFeePerSidePct: 0.04,
  roundTripFeePct: 0.08,
  slippageBpsPerSide: 7,
  realisticSlippageRtPct: 0.14,
  realisticRoundTripPct: 0.22,
  stressSlippageRtPct: 70,
  stressRoundTripPct: 0.78,
} as const;

export type CostScenario = "REALISTIC" | "STRESS" | "ZERO_DIAGNOSTIC";

export function resolveRoundTripCostPct(
  venue: "SPOT" | "FUTURES",
  scenario: CostScenario = "REALISTIC",
): number {
  const base = venue === "FUTURES" ? FUTURES_COST_REALISTIC : SPOT_COST_REALISTIC;
  if (scenario === "ZERO_DIAGNOSTIC") return 0;
  if (scenario === "STRESS") return base.stressRoundTripPct;
  return base.realisticRoundTripPct;
}

export function netAfterCost(grossPct: number, fundingPnlPct: number, roundTripCostPct: number) {
  return grossPct + fundingPnlPct - roundTripCostPct;
}

export function grossReturnPct(side: "LONG" | "SHORT", entry: number, exit: number) {
  if (entry <= 0 || exit <= 0) return 0;
  return side === "LONG" ? ((exit - entry) / entry) * 100 : ((entry - exit) / entry) * 100;
}

export function fundingPnlDuringHold(
  side: "LONG" | "SHORT",
  fundingEvents: Array<{ fundingTime: number; fundingRate: number }>,
  entryTime: number,
  exitTime: number,
): number {
  let pnl = 0;
  for (const row of fundingEvents) {
    if (row.fundingTime <= entryTime || row.fundingTime > exitTime) continue;
    const ratePct = row.fundingRate * 100;
    pnl += side === "LONG" ? -ratePct : ratePct;
  }
  return pnl;
}
