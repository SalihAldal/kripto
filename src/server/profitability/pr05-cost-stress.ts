import type { Pr05CostStressResult } from "@/src/server/profitability/pr05-types";
import { computeNetExpectancyFromPnls } from "@/src/server/profitability/pr05-metrics";

export const PR05_COST_STRESS_SCENARIOS = [
  { scenarioId: "BASE", label: "Base configured taker fee", feeMultiplier: 1, slippageBps: 0, latencyTicks: 0, measured: false },
  { scenarioId: "FEE_PLUS_50PCT", label: "+50% fee stress", feeMultiplier: 1.5, slippageBps: 0, latencyTicks: 0, measured: false },
  { scenarioId: "SLIPPAGE_PLUS_25BPS", label: "+25bps slippage stress", feeMultiplier: 1, slippageBps: 25, latencyTicks: 0, measured: false },
  { scenarioId: "LATENCY_PLUS_1TICK", label: "+1 tick decision latency", feeMultiplier: 1, slippageBps: 0, latencyTicks: 1, measured: false },
] as const;

export function applyCostStressToNetPnls(input: {
  baseNetPnls: number[];
  entryPrices: number[];
  scenarioId: string;
}) {
  const scenario = PR05_COST_STRESS_SCENARIOS.find((s) => s.scenarioId === input.scenarioId);
  if (!scenario) return { netPnls: input.baseNetPnls, measured: false };
  const netPnls = input.baseNetPnls.map((net, idx) => {
    const entry = input.entryPrices[idx] ?? 100;
    const extraFee = scenario.feeMultiplier > 1 ? Math.abs(net) * (scenario.feeMultiplier - 1) * 0.01 : 0;
    const slippageCost = (entry * scenario.slippageBps) / 10_000;
    const latencyPenalty = scenario.latencyTicks > 0 ? entry * 0.0001 * scenario.latencyTicks : 0;
    return Number((net - extraFee - slippageCost - latencyPenalty).toFixed(8));
  });
  return { netPnls, measured: false };
}

export function runCostStressEvaluation(input: {
  baseNetPnls: number[];
  entryPrices: number[];
}) {
  const baseExp = computeNetExpectancyFromPnls(input.baseNetPnls);
  const results: Pr05CostStressResult[] = [];
  for (const scenario of PR05_COST_STRESS_SCENARIOS) {
    const stressed = applyCostStressToNetPnls({
      baseNetPnls: input.baseNetPnls,
      entryPrices: input.entryPrices,
      scenarioId: scenario.scenarioId,
    });
    const exp = computeNetExpectancyFromPnls(stressed.netPnls);
    const flipsSign =
      baseExp != null && exp != null ? (baseExp > 0 && exp < 0) || (baseExp < 0 && exp > 0) : false;
    results.push({
      scenarioId: scenario.scenarioId,
      label: scenario.label,
      measured: false,
      netExpectancy: exp,
      flipsSign,
    });
  }
  return results;
}
