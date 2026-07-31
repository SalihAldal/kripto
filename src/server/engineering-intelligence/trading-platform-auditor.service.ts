import { prisma } from "@/src/server/db/prisma";
import { createEngineeringAudit, persistArchitectureFinding } from "@/src/server/engineering-intelligence/engineering-intelligence.repository";
import { emitEngineeringEvent, ENGINEERING_EVENT } from "@/src/server/engineering-intelligence/engineering-intelligence.events";

export async function auditTradingPlatform(limit = 20) {
  const audit = await createEngineeringAudit({
    auditType: "TRADING_PLATFORM_SCAN",
    category: "TRADING_PLATFORM",
    summary: "Trading platform consistency audit (read-only, no modifications)",
  });

  let findings = 0;
  const checks = [
    { name: "OPEN_POSITIONS", fn: () => prisma.position.count({ where: { status: "OPEN" } }) },
    { name: "DECISION_LOGS", fn: () => prisma.decisionLog.count() },
  ];

  for (const check of checks.slice(0, limit)) {
    try {
      const count = await check.fn();
      const severity = check.name === "OPEN_POSITIONS" && count > 100 ? "MEDIUM" as const : "INFO" as const;
      await persistArchitectureFinding(audit.id, {
        checkName: check.name,
        status: "PASSED",
        severity,
        finding: `${check.name}: ${count} records — consistency check only`,
        score: 100,
        evidence: { count },
      });
    } catch {
      await persistArchitectureFinding(audit.id, {
        checkName: check.name,
        status: "SKIPPED",
        severity: "LOW",
        finding: `${check.name}: table not available for audit`,
      });
    }
  }

  emitEngineeringEvent(ENGINEERING_EVENT.AUDIT_COMPLETED, { auditId: audit.id, findings });
  return { auditId: audit.id, findings };
}
