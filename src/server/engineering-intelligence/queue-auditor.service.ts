import { prisma } from "@/src/server/db/prisma";
import { createEngineeringAudit, persistQueueFinding } from "@/src/server/engineering-intelligence/engineering-intelligence.repository";
import { emitEngineeringEvent, ENGINEERING_EVENT } from "@/src/server/engineering-intelligence/engineering-intelligence.events";

const QUEUE_JOB_TABLES = [
  { name: "scanner", table: "scannerJobState" },
  { name: "decision-engine", table: "decisionEngineJobState" },
  { name: "learning-engine", table: "learningEngineJobState" },
  { name: "quant-research", table: "quantResearchJobState" },
  { name: "ai-governance", table: "aiGovernanceJobState" },
  { name: "news-intelligence", table: "newsIntelligenceJobState" },
  { name: "whale-intelligence", table: "whaleIntelligenceJobState" },
  { name: "onchain-intelligence", table: "onChainIntelligenceJobState" },
  { name: "engineering-intelligence", table: "engineeringIntelligenceJobState" },
] as const;

export async function auditQueues(limit = 20) {
  const audit = await createEngineeringAudit({
    auditType: "QUEUE_SCAN",
    category: "QUEUE",
    summary: "Queue and worker health audit",
  });

  let findings = 0;
  for (const q of QUEUE_JOB_TABLES.slice(0, limit)) {
    try {
      const delegate = (prisma as unknown as Record<string, { findMany: (args: unknown) => Promise<Array<{ status?: string; lastProcessedAt?: Date | null }>> }>)[q.table];
      if (!delegate?.findMany) continue;
      const states = await delegate.findMany({ take: 20 });
      const failed = states.filter((s) => s.status === "FAILED" || s.status === "ERROR").length;
      const stale = states.filter((s) => s.lastProcessedAt && Date.now() - s.lastProcessedAt.getTime() > 24 * 60 * 60_000).length;
      const workerHealth = Math.max(0, 100 - failed * 20 - stale * 5);

      const severity = failed > 0 ? "HIGH" as const : stale > 3 ? "MEDIUM" as const : "INFO" as const;
      const status = failed > 0 ? "FAILED" as const : stale > 3 ? "WARNING" as const : "PASSED" as const;

      await persistQueueFinding(audit.id, {
        queueName: q.name,
        status,
        severity,
        pendingJobs: 0,
        failedJobs: failed,
        workerHealth,
        finding: failed > 0 ? `${failed} failed jobs in ${q.name}` : stale > 3 ? `${stale} stale jobs in ${q.name}` : `${q.name} queue healthy`,
        evidence: { jobCount: states.length, failed, stale },
      });
      if (status !== "PASSED") findings += 1;
    } catch {
      await persistQueueFinding(audit.id, {
        queueName: q.name, status: "SKIPPED", severity: "LOW",
        finding: `Could not inspect ${q.name} — table may not exist yet`,
      });
    }
  }

  emitEngineeringEvent(ENGINEERING_EVENT.AUDIT_COMPLETED, { auditId: audit.id, findings });
  return { auditId: audit.id, findings, queuesInspected: QUEUE_JOB_TABLES.length };
}
