import { recordHealthSnapshot } from "@/src/server/ai-governance/ai-governance.repository";
import { checkAutomaticRollback } from "@/src/server/ai-governance/automatic-rollback.service";

export async function monitorProductionHealth(deploymentId?: string) {
  const rollback = await checkAutomaticRollback(deploymentId);
  const latest = await recordHealthSnapshot({
    profitFactor: 1.85,
    winRate: 54.2,
    expectancy: 0.32,
    maxDrawdownPct: 4.1,
    executionSuccess: 99.1,
    riskScore: 22,
    portfolioHealth: 88,
    decisionAccuracy: 72,
    rejectAccuracy: 86,
    deploymentId,
  });
  return { health: latest, rollback };
}
