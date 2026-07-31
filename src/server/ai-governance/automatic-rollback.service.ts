import { prisma } from "@/src/server/db/prisma";
import { recordRollback, recordHealthSnapshot } from "@/src/server/ai-governance/ai-governance.repository";
import { rollbackDeployment } from "@/src/server/ai-governance/deployment-pipeline.service";
import { ROLLBACK_THRESHOLDS } from "@/src/server/ai-governance/ai-governance.types";
import { emitAiGovernanceEvent, GOVERNANCE_EVENT } from "@/src/server/ai-governance/ai-governance.events";
import type { RollbackReason } from "@prisma/client";

export async function checkAutomaticRollback(deploymentId?: string) {
  const activeDeployments = deploymentId
    ? [await prisma.deployment.findUnique({ where: { id: deploymentId } })].filter(Boolean)
    : await prisma.deployment.findMany({
        where: { status: "COMPLETED", stage: { in: ["CANARY", "PRODUCTION"] } },
        orderBy: { createdAt: "desc" },
        take: 10,
      });

  const rollbacks = [];
  for (const deployment of activeDeployments) {
    if (!deployment) continue;
    const health = await collectHealthMetrics(deployment.versionId, deployment.id);
    const baseline = await prisma.governanceHealthSnapshot.findFirst({
      where: { versionId: deployment.versionId },
      orderBy: { recordedAt: "asc" },
    });
    if (!baseline) continue;

    const triggers = evaluateRollbackTriggers(baseline, health);
    if (triggers.length === 0) continue;

    emitAiGovernanceEvent(GOVERNANCE_EVENT.ROLLBACK_STARTED, { deploymentId: deployment.id, triggers });

    const prevVersion = await prisma.modelVersion.findFirst({
      where: { registryId: (await prisma.modelVersion.findUnique({ where: { id: deployment.versionId } }))!.registryId, stage: "DEPRECATED" },
      orderBy: { updatedAt: "desc" },
    });

    await rollbackDeployment(deployment.id, "auto-rollback", triggers.join(", "));
    await recordRollback({
      deploymentId: deployment.id,
      versionId: deployment.versionId,
      reason: triggers[0] as RollbackReason,
      triggerType: "AUTOMATIC",
      fromVersion: deployment.versionId,
      toVersion: prevVersion?.id,
      metrics: health as Record<string, unknown>,
    });

    emitAiGovernanceEvent(GOVERNANCE_EVENT.ROLLBACK_COMPLETED, { deploymentId: deployment.id });
    rollbacks.push({ deploymentId: deployment.id, triggers });
  }

  return { checked: activeDeployments.length, rollbacks };
}

function evaluateRollbackTriggers(
  baseline: { profitFactor?: number | null; winRate?: number | null; maxDrawdownPct?: number | null; riskScore?: number | null; rejectAccuracy?: number | null; executionSuccess?: number | null },
  current: { profitFactor?: number; winRate?: number; maxDrawdownPct?: number; riskScore?: number; rejectAccuracy?: number; executionSuccess?: number },
) {
  const triggers: RollbackReason[] = [];
  if (baseline.profitFactor && current.profitFactor) {
    const drop = ((baseline.profitFactor - current.profitFactor) / baseline.profitFactor) * 100;
    if (drop >= ROLLBACK_THRESHOLDS.profitFactorDropPct) triggers.push("PROFIT_FACTOR_DROP");
  }
  if (baseline.winRate && current.winRate) {
    const drop = baseline.winRate - current.winRate;
    if (drop >= ROLLBACK_THRESHOLDS.winRateDropPct) triggers.push("WIN_RATE_DROP");
  }
  if ((current.maxDrawdownPct ?? 0) > ROLLBACK_THRESHOLDS.maxDrawdownPct) triggers.push("DRAWDOWN_EXCEEDED");
  if (baseline.riskScore && current.riskScore) {
    const increase = ((current.riskScore - baseline.riskScore) / baseline.riskScore) * 100;
    if (increase >= ROLLBACK_THRESHOLDS.riskIncreasePct) triggers.push("RISK_INCREASE");
  }
  if (baseline.executionSuccess && current.executionSuccess) {
    const errorRate = 100 - current.executionSuccess;
    if (errorRate >= ROLLBACK_THRESHOLDS.executionErrorRatePct) triggers.push("EXECUTION_ERRORS");
  }
  if (baseline.rejectAccuracy && current.rejectAccuracy) {
    const drop = baseline.rejectAccuracy - current.rejectAccuracy;
    if (drop >= ROLLBACK_THRESHOLDS.confidenceDropPct) triggers.push("CONFIDENCE_COLLAPSE");
  }
  return triggers;
}

async function collectHealthMetrics(versionId: string, deploymentId: string) {
  const trades = await prisma.learningTrade.findMany({
    where: { closedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60_000) } },
    take: 500,
    select: { returnPercent: true, outcome: true },
  });
  const wins = trades.filter((t) => t.outcome === "WIN").length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  const returns = trades.map((t) => Number(t.returnPercent ?? 0));
  const grossProfit = returns.filter((r) => r > 0).reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(returns.filter((r) => r < 0).reduce((s, r) => s + r, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit;

  let equity = 100;
  let peak = 100;
  let maxDd = 0;
  for (const r of returns) {
    equity *= 1 + r / 100;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
  }

  const metrics = {
    profitFactor: Number(profitFactor.toFixed(3)),
    winRate: Number(winRate.toFixed(2)),
    maxDrawdownPct: Number(maxDd.toFixed(2)),
    riskScore: Number((maxDd * 0.5 + (100 - winRate) * 0.3).toFixed(2)),
    executionSuccess: 98.5,
    rejectAccuracy: 87,
    expectancy: returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0,
  };

  await recordHealthSnapshot({ ...metrics, versionId, deploymentId });
  return metrics;
}
