import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/src/server/db/prisma";
import { createEngineeringAudit, persistPerformanceFinding } from "@/src/server/engineering-intelligence/engineering-intelligence.repository";
import { emitEngineeringEvent, ENGINEERING_EVENT } from "@/src/server/engineering-intelligence/engineering-intelligence.events";

const ROOT = process.cwd();

export async function auditPerformance(limit = 30) {
  const audit = await createEngineeringAudit({
    auditType: "PERFORMANCE_SCAN",
    category: "PERFORMANCE",
    summary: "Performance and query pattern audit",
  });

  let findings = 0;
  const schemaPath = join(ROOT, "prisma/schema.prisma");
  if (existsSync(schemaPath)) {
    const schema = readFileSync(schemaPath, "utf-8");
    const models = schema.match(/^model\s+\w+/gm) ?? [];
    const indexes = schema.match(/@@index/g) ?? [];
    const indexRatio = models.length > 0 ? indexes.length / models.length : 0;
    if (indexRatio < 1.5) {
      await persistPerformanceFinding(audit.id, {
        checkName: "INDEX_COVERAGE", status: "WARNING", severity: "MEDIUM",
        finding: `Low index-to-model ratio (${indexRatio.toFixed(1)} indexes per model)`,
        metric: "indexRatio", value: indexRatio, threshold: 1.5,
      });
      findings += 1;
    }
  }

  const jobStates = await Promise.allSettled([
    prisma.decisionEngineJobState.findMany({ take: 5 }),
    prisma.learningEngineJobState.findMany({ take: 5 }),
    prisma.engineeringIntelligenceJobState.findMany({ take: 5 }),
  ]);

  for (const result of jobStates) {
    if (result.status === "rejected") {
      await persistPerformanceFinding(audit.id, {
        checkName: "JOB_STATE_QUERY", status: "WARNING", severity: "LOW",
        finding: "Job state query failed during performance audit",
      });
      findings += 1;
    }
  }

  const largeTables = ["LearningTrade", "DecisionLog", "NewsArticle", "WhaleTransaction", "BlockchainSnapshot"];
  for (const table of largeTables.slice(0, limit)) {
    const model = (prisma as unknown as Record<string, { count?: () => Promise<number> }>)[table.charAt(0).toLowerCase() + table.slice(1)];
    if (model?.count) {
      try {
        const count = await model.count();
        if (count > 100_000) {
          await persistPerformanceFinding(audit.id, {
            checkName: "LARGE_TABLE", status: "WARNING", severity: "MEDIUM",
            finding: `Table ${table} has ${count} rows — consider partitioning or archival`,
            target: table, metric: "rowCount", value: count, threshold: 100_000,
          });
          findings += 1;
        }
      } catch { /* skip */ }
    }
  }

  emitEngineeringEvent(ENGINEERING_EVENT.AUDIT_COMPLETED, { auditId: audit.id, findings });
  return { auditId: audit.id, findings };
}
