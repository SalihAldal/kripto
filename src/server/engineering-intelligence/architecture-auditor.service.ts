import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { createEngineeringAudit, persistArchitectureFinding, persistRecommendation } from "@/src/server/engineering-intelligence/engineering-intelligence.repository";
import { emitEngineeringEvent, ENGINEERING_EVENT } from "@/src/server/engineering-intelligence/engineering-intelligence.events";
import { PROTECTED_MODULES, SERVER_ROOTS } from "@/src/server/engineering-intelligence/engineering-intelligence.types";
import type { AuditSeverity, AuditStatus } from "@prisma/client";

const ROOT = process.cwd();

function walkDir(dir: string, maxDepth = 4, depth = 0): string[] {
  if (depth > maxDepth || !existsSync(dir)) return [];
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".git" || entry === ".next") continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) results.push(...walkDir(full, maxDepth, depth + 1));
      else if (/\.(ts|tsx|js|jsx)$/.test(entry)) results.push(full);
    }
  } catch { /* skip unreadable */ }
  return results;
}

function countImports(filePath: string, target: string) {
  try {
    const content = readFileSync(filePath, "utf-8");
    return (content.match(new RegExp(`@/${target}|from ["'].*${target}`, "g")) ?? []).length;
  } catch { return 0; }
}

export async function auditArchitecture(limit = 50) {
  const audit = await createEngineeringAudit({
    auditType: "ARCHITECTURE_SCAN",
    category: "ARCHITECTURE",
    summary: "Architecture layer and module boundary audit",
  });
  emitEngineeringEvent(ENGINEERING_EVENT.AUDIT_STARTED, { auditId: audit.id, type: "ARCHITECTURE" });

  const findings: Array<{ severity: AuditSeverity; status: AuditStatus; checkName: string; finding: string; modulePath?: string }> = [];
  const serverModules = existsSync(join(ROOT, "src/server")) ? readdirSync(join(ROOT, "src/server")) : [];

  for (const mod of serverModules.slice(0, limit)) {
    const modPath = join(ROOT, "src/server", mod);
    if (!statSync(modPath).isDirectory()) continue;
    const files = walkDir(modPath, 2);
    const loc = files.reduce((s, f) => { try { return s + readFileSync(f, "utf-8").split("\n").length; } catch { return s; } }, 0);
    if (loc > 5000) {
      findings.push({ severity: "MEDIUM", status: "WARNING", checkName: "LARGE_MODULE", finding: `Module ${mod} exceeds 5000 LOC (${loc})`, modulePath: `src/server/${mod}` });
    }
  }

  for (const mod of PROTECTED_MODULES) {
    const modDir = join(ROOT, "src/server", mod);
    if (!existsSync(modDir)) continue;
    const apiFiles = walkDir(join(ROOT, "app/api"), 6);
    let crossImports = 0;
    for (const f of apiFiles.slice(0, 100)) {
      crossImports += countImports(f, mod);
    }
    if (crossImports > 0) {
      findings.push({ severity: "INFO", status: "PASSED", checkName: "API_MODULE_ACCESS", finding: `${mod} accessed from ${crossImports} API routes (expected for intelligence APIs)`, modulePath: `src/server/${mod}` });
    }
  }

  const apiCount = walkDir(join(ROOT, "app/api"), 8).filter((f) => f.endsWith("route.ts")).length;
  findings.push({ severity: "INFO", status: "PASSED", checkName: "API_SURFACE", finding: `${apiCount} API route handlers detected`, modulePath: "app/api" });

  if (serverModules.length > 30) {
    findings.push({ severity: "MEDIUM", status: "WARNING", checkName: "MODULE_COUNT", finding: `${serverModules.length} server modules — consider consolidation`, modulePath: "src/server" });
  }

  for (const f of findings) {
    await persistArchitectureFinding(audit.id, f);
  }

  const worstSeverity = findings.some((f) => f.severity === "CRITICAL") ? "CRITICAL" : findings.some((f) => f.severity === "HIGH") ? "HIGH" : findings.some((f) => f.severity === "MEDIUM") ? "MEDIUM" : "INFO";
  const score = Math.max(0, 100 - findings.filter((f) => f.status !== "PASSED").length * 5);

  if (findings.some((f) => f.severity === "MEDIUM")) {
    await persistRecommendation({
      auditId: audit.id,
      category: "ARCHITECTURE",
      title: "Review large modules for decomposition",
      description: "One or more server modules exceed recommended size thresholds.",
      evidence: { findings: findings.filter((f) => f.checkName === "LARGE_MODULE") },
      expectedImpact: "Improved maintainability and testability",
      effortEstimate: "2-5 days per module",
      riskLevel: "LOW",
      priority: "MEDIUM",
      affectedModules: findings.filter((f) => f.modulePath).map((f) => f.modulePath!),
    });
  }

  emitEngineeringEvent(ENGINEERING_EVENT.AUDIT_COMPLETED, { auditId: audit.id, findings: findings.length, score });
  return { auditId: audit.id, findings: findings.length, score, modules: serverModules.length };
}
