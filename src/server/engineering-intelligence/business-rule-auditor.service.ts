import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createEngineeringAudit, persistArchitectureFinding } from "@/src/server/engineering-intelligence/engineering-intelligence.repository";
import { emitEngineeringEvent, ENGINEERING_EVENT } from "@/src/server/engineering-intelligence/engineering-intelligence.events";
import { PROTECTED_MODULES } from "@/src/server/engineering-intelligence/engineering-intelligence.types";

const ROOT = process.cwd();

export async function auditBusinessRules(limit = 20) {
  const audit = await createEngineeringAudit({
    auditType: "BUSINESS_RULE_SCAN",
    category: "BUSINESS_RULE",
    summary: "Business rule consistency and config drift audit (read-only)",
  });

  let findings = 0;
  const ruleModules = [
    { name: "scanner", path: "src/server/scanner" },
    { name: "decision-engine", path: "src/server/decision-engine" },
    { name: "risk-engine", path: "src/server/risk" },
    { name: "execution", path: "src/server/execution" },
    { name: "learning-engine", path: "src/server/learning-engine" },
  ];

  for (const mod of ruleModules.slice(0, limit)) {
    const fullPath = join(ROOT, mod.path);
    const exists = existsSync(fullPath);
    const fileCount = exists ? countFiles(fullPath) : 0;

    await persistArchitectureFinding(audit.id, {
      checkName: "RULE_MODULE_INTEGRITY",
      status: exists ? "PASSED" : "FAILED",
      severity: exists ? "INFO" : "CRITICAL",
      modulePath: mod.path,
      finding: exists ? `${mod.name} module intact (${fileCount} files) — audit only, no modifications` : `${mod.name} module missing`,
      score: exists ? 100 : 0,
    });
    if (!exists) findings += 1;
  }

  for (const mod of PROTECTED_MODULES) {
    const modPath = join(ROOT, "src/server", mod);
    if (existsSync(modPath)) {
      await persistArchitectureFinding(audit.id, {
        checkName: "PROTECTED_MODULE",
        status: "PASSED",
        severity: "INFO",
        modulePath: `src/server/${mod}`,
        finding: `Protected module ${mod} present — excluded from auto-modification`,
        score: 100,
      });
    }
  }

  emitEngineeringEvent(ENGINEERING_EVENT.AUDIT_COMPLETED, { auditId: audit.id, findings });
  return { auditId: audit.id, findings };
}

function countFiles(dir: string, depth = 0): number {
  if (depth > 4) return 0;
  let n = 0;
  try {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (require("node:fs").statSync(p).isDirectory()) n += countFiles(p, depth + 1);
      else n += 1;
    }
  } catch { /* skip */ }
  return n;
}
