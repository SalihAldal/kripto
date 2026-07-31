import { env } from "@/lib/config";
import { createEngineeringAudit, persistInfrastructureFinding } from "@/src/server/engineering-intelligence/engineering-intelligence.repository";
import { emitEngineeringEvent, ENGINEERING_EVENT } from "@/src/server/engineering-intelligence/engineering-intelligence.events";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

export async function auditInfrastructure(limit = 15) {
  const audit = await createEngineeringAudit({
    auditType: "INFRASTRUCTURE_SCAN",
    category: "INFRASTRUCTURE",
    summary: "Infrastructure and environment audit",
  });

  const components = [
    { name: "Redis", check: () => Boolean(env.REDIS_URL), health: env.REDIS_URL ? 90 : 50 },
    { name: "PostgreSQL", check: () => Boolean(process.env.DATABASE_URL), health: process.env.DATABASE_URL ? 95 : 30 },
    { name: "Docker", check: () => existsSync(join(ROOT, "Dockerfile")) || existsSync(join(ROOT, "docker-compose.yml")), health: 80 },
    { name: "Worker", check: () => env.SCANNER_WORKER_ENABLED, health: env.SCANNER_WORKER_ENABLED ? 90 : 60 },
    { name: "SeparateWorker", check: () => !env.ENABLE_SEPARATE_WORKER || env.APP_ROLE === "worker", health: 85 },
    { name: "Environment", check: () => Boolean(env.APP_ENV), health: 90 },
  ];

  let findings = 0;
  for (const comp of components.slice(0, limit)) {
    const ok = comp.check();
    await persistInfrastructureFinding(audit.id, {
      component: comp.name,
      status: ok ? "PASSED" : "WARNING",
      severity: ok ? "INFO" : "MEDIUM",
      healthScore: ok ? comp.health : comp.health - 30,
      finding: ok ? `${comp.name} configured` : `${comp.name} not configured or missing`,
    });
    if (!ok) findings += 1;
  }

  emitEngineeringEvent(ENGINEERING_EVENT.AUDIT_COMPLETED, { auditId: audit.id, findings });
  return { auditId: audit.id, findings };
}
