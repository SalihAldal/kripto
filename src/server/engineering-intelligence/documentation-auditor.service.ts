import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createEngineeringAudit, persistDocumentationFinding } from "@/src/server/engineering-intelligence/engineering-intelligence.repository";
import { emitEngineeringEvent, ENGINEERING_EVENT } from "@/src/server/engineering-intelligence/engineering-intelligence.events";

const ROOT = process.cwd();

const REQUIRED_DOCS = [
  { type: "README", path: "README.md", severity: "HIGH" as const },
  { type: "AGENTS", path: "AGENTS.md", severity: "MEDIUM" as const },
  { type: "CLAUDE", path: "CLAUDE.md", severity: "LOW" as const },
  { type: "ENV_EXAMPLE", path: ".env.example", severity: "MEDIUM" as const },
  { type: "DOCKER", path: "Dockerfile", severity: "LOW" as const },
  { type: "PRISMA_SCHEMA", path: "prisma/schema.prisma", severity: "INFO" as const },
];

export async function auditDocumentation(limit = 20) {
  const audit = await createEngineeringAudit({
    auditType: "DOCUMENTATION_SCAN",
    category: "DOCUMENTATION",
    summary: "Documentation completeness audit",
  });

  let findings = 0;
  for (const doc of REQUIRED_DOCS.slice(0, limit)) {
    const fullPath = join(ROOT, doc.path);
    const exists = existsSync(fullPath);
    let wordCount = 0;
    if (exists) {
      try { wordCount = readFileSync(fullPath, "utf-8").split(/\s+/).length; } catch { /* skip */ }
    }

    await persistDocumentationFinding(audit.id, {
      docType: doc.type,
      docPath: doc.path,
      status: exists ? (wordCount > 50 ? "PASSED" : "WARNING") : "FAILED",
      severity: exists ? "INFO" : doc.severity,
      finding: exists ? `${doc.type} present (${wordCount} words)` : `Missing ${doc.type}: ${doc.path}`,
      evidence: { exists, wordCount },
    });
    if (!exists || wordCount < 50) findings += 1;
  }

  emitEngineeringEvent(ENGINEERING_EVENT.AUDIT_COMPLETED, { auditId: audit.id, findings });
  return { auditId: audit.id, findings };
}
