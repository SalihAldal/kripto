import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createEngineeringAudit, persistPerformanceFinding } from "@/src/server/engineering-intelligence/engineering-intelligence.repository";
import { emitEngineeringEvent, ENGINEERING_EVENT } from "@/src/server/engineering-intelligence/engineering-intelligence.events";

const ROOT = process.cwd();

export async function auditDatabase(limit = 30) {
  const audit = await createEngineeringAudit({
    auditType: "DATABASE_SCAN",
    category: "DATABASE",
    summary: "Schema health and migration consistency audit",
  });

  let findings = 0;
  const schemaPath = join(ROOT, "prisma/schema.prisma");
  const migrationsDir = join(ROOT, "prisma/migrations");

  if (existsSync(schemaPath)) {
    const schema = readFileSync(schemaPath, "utf-8");
    const models = [...schema.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1]);
    const enums = [...schema.matchAll(/^enum\s+(\w+)/gm)].map((m) => m[1]);

    for (const model of models.slice(0, limit)) {
      const block = schema.slice(schema.indexOf(`model ${model}`));
      const end = block.indexOf("\n}");
      const modelBlock = block.slice(0, end);
      const hasId = modelBlock.includes("@id");
      const hasCreatedAt = modelBlock.includes("createdAt");
      if (!hasId) {
        await persistPerformanceFinding(audit.id, {
          checkName: "MISSING_PRIMARY_KEY", status: "FAILED", severity: "CRITICAL",
          finding: `Model ${model} missing @id field`, target: model,
        });
        findings += 1;
      }
      if (!hasCreatedAt && !model.includes("JobState")) {
        await persistPerformanceFinding(audit.id, {
          checkName: "MISSING_TIMESTAMP", status: "WARNING", severity: "LOW",
          finding: `Model ${model} missing createdAt timestamp`, target: model,
        });
        findings += 1;
      }
    }

    if (existsSync(migrationsDir)) {
      const migrations = readdirSync(migrationsDir).filter((d) => d !== "migration_lock.toml");
      await persistPerformanceFinding(audit.id, {
        checkName: "MIGRATION_COUNT", status: "PASSED", severity: "INFO",
        finding: `${migrations.length} migrations, ${models.length} models, ${enums.length} enums`,
        metric: "migrationCount", value: migrations.length,
      });
    }
  }

  emitEngineeringEvent(ENGINEERING_EVENT.AUDIT_COMPLETED, { auditId: audit.id, findings });
  return { auditId: audit.id, findings };
}
