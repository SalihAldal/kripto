import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createEngineeringAudit, persistSecurityFinding, persistRecommendation } from "@/src/server/engineering-intelligence/engineering-intelligence.repository";
import { emitEngineeringEvent, ENGINEERING_EVENT } from "@/src/server/engineering-intelligence/engineering-intelligence.events";

const ROOT = process.cwd();

const SECURITY_PATTERNS: Array<{ name: string; pattern: RegExp; severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"; exclude?: RegExp }> = [
  { name: "SQL_INJECTION_RISK", pattern: /\$\{.*\}.*(?:query|execute|raw)/i, severity: "HIGH" },
  { name: "EVAL_USAGE", pattern: /\beval\s*\(/, severity: "CRITICAL" },
  { name: "EXEC_SYNC", pattern: /execSync\s*\(/, severity: "HIGH" },
  { name: "HARDCODED_JWT", pattern: /jwt.*secret.*=.*["'][^"']{8,}["']/i, severity: "CRITICAL" },
  { name: "INNERHTML", pattern: /dangerouslySetInnerHTML/, severity: "HIGH" },
  { name: "PROCESS_ENV_LEAK", pattern: /console\.log.*process\.env/, severity: "MEDIUM" },
  { name: "DISABLED_SSL", pattern: /rejectUnauthorized:\s*false/, severity: "HIGH" },
];

function walkFiles(dir: string, depth = 0): string[] {
  if (depth > 6 || !existsSync(dir)) return [];
  const out: string[] = [];
  try {
    for (const e of readdirSync(dir)) {
      if (e === "node_modules" || e === ".git" || e === ".next") continue;
      const p = join(dir, e);
      try {
        const stat = require("node:fs").statSync(p);
        if (stat.isDirectory()) out.push(...walkFiles(p, depth + 1));
        else if (/\.(ts|tsx|js|jsx)$/.test(e)) out.push(p);
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return out;
}

export async function auditSecurity(limit = 150) {
  const audit = await createEngineeringAudit({
    auditType: "SECURITY_SCAN",
    category: "SECURITY",
    summary: "Security vulnerability pattern audit",
  });

  const dirs = ["src", "app", "lib", "services", "scripts"].map((d) => join(ROOT, d));
  const files = dirs.flatMap((d) => walkFiles(d)).slice(0, limit * 2);
  let findings = 0;

  for (const filePath of files.slice(0, limit)) {
    const rel = filePath.replace(ROOT, "").replace(/\\/g, "/");
    let content: string;
    try { content = readFileSync(filePath, "utf-8"); } catch { continue; }

    for (const check of SECURITY_PATTERNS) {
      if (check.exclude?.test(rel)) continue;
      if (check.pattern.test(content)) {
        await persistSecurityFinding(audit.id, {
          checkName: check.name,
          status: check.severity === "CRITICAL" ? "FAILED" : "WARNING",
          severity: check.severity,
          filePath: rel,
          finding: `${check.name} pattern detected in ${rel}`,
        });
        findings += 1;
      }
    }
  }

  if (findings > 0) {
    await persistRecommendation({
      auditId: audit.id,
      category: "SECURITY",
      title: "Review security findings",
      description: `${findings} potential security issues detected. Manual review required.`,
      evidence: { findingsCount: findings },
      expectedImpact: "Reduced security risk",
      effortEstimate: "1-5 days",
      riskLevel: "HIGH",
      priority: findings > 5 ? "CRITICAL" : "HIGH",
      affectedModules: ["src", "app"],
    });
  }

  emitEngineeringEvent(ENGINEERING_EVENT.AUDIT_COMPLETED, { auditId: audit.id, findings });
  return { auditId: audit.id, findings, filesScanned: Math.min(files.length, limit) };
}
