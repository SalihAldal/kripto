import { persistAuditLog } from "@/src/server/aoc/aoc.repository";

export type ChaosScenario = "WORKER_FAILURE" | "EXCHANGE_FAILURE" | "DATABASE_FAILURE" | "QUEUE_FAILURE" | "NETWORK_FAILURE";

export async function simulateChaos(scenario: ChaosScenario, dryRun = true) {
  await persistAuditLog("CHAOS_TEST", scenario, true, { dryRun, scenario });
  return {
    scenario,
    dryRun,
    status: "STUB",
    message: `Chaos simulation ${scenario} registered — execution disabled in production`,
  };
}

export const CHAOS_SCENARIOS: ChaosScenario[] = [
  "WORKER_FAILURE",
  "EXCHANGE_FAILURE",
  "DATABASE_FAILURE",
  "QUEUE_FAILURE",
  "NETWORK_FAILURE",
];
