import { readFileSync, statSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createEngineeringAudit, persistCodeQualityFinding, persistRecommendation, persistTechnicalDebt } from "@/src/server/engineering-intelligence/engineering-intelligence.repository";
import { emitEngineeringEvent, ENGINEERING_EVENT } from "@/src/server/engineering-intelligence/engineering-intelligence.events";
import { SERVER_ROOTS } from "@/src/server/engineering-intelligence/engineering-intelligence.types";

const ROOT = process.cwd();
const SECRET_PATTERNS = [/api[_-]?key\s*=\s*["'][^"']+["']/i, /password\s*=\s*["'][^"']+["']/i, /secret\s*=\s*["'][^"']+["']/i, /sk-[a-zA-Z0-9]{20,}/];
const MAGIC_NUMBER_THRESHOLD = 3;

function walkFiles(dir: string, depth = 0): string[] {
  if (depth > 5 || !existsSync(dir)) return [];
  const out: string[] = [];
  try {
    for (const e of readdirSync(dir)) {
      if (e === "node_modules" || e === ".git") continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) out.push(...walkFiles(p, depth + 1));
      else if (/\.(ts|tsx)$/.test(e)) out.push(p);
    }
  } catch { /* skip */ }
  return out;
}

export async function auditCodeQuality(limit = 100) {
  const audit = await createEngineeringAudit({
    auditType: "CODE_QUALITY_SCAN",
    category: "CODE_QUALITY",
    summary: "Code smell and quality audit",
  });

  const files = SERVER_ROOTS.flatMap((r) => walkFiles(join(ROOT, r))).slice(0, limit * 3);
  let findings = 0;

  for (const filePath of files.slice(0, limit)) {
    const rel = filePath.replace(ROOT, "").replace(/\\/g, "/");
    let content: string;
    try { content = readFileSync(filePath, "utf-8"); } catch { continue; }
    const lines = content.split("\n");

    if (lines.length > 500) {
      await persistCodeQualityFinding(audit.id, { smellType: "LARGE_FILE", status: "WARNING", severity: "MEDIUM", finding: `File exceeds 500 lines (${lines.length})`, filePath: rel, lineNumber: lines.length });
      findings += 1;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (/^\s*\/\/.*TODO|FIXME|HACK/.test(line)) {
        await persistCodeQualityFinding(audit.id, { smellType: "TODO_COMMENT", status: "WARNING", severity: "LOW", finding: "Unresolved TODO/FIXME comment", filePath: rel, lineNumber: i + 1 });
        findings += 1;
      }
      if (/^\s*\/\/\s*(const|let|function|import)/.test(line)) {
        await persistCodeQualityFinding(audit.id, { smellType: "COMMENTED_CODE", status: "WARNING", severity: "LOW", finding: "Commented-out code detected", filePath: rel, lineNumber: i + 1 });
        findings += 1;
      }
    }

    const fnMatches = content.match(/(?:async\s+)?function\s+\w+|(?:const|let)\s+\w+\s*=\s*(?:async\s*)?\(/g) ?? [];
    for (const _ of fnMatches) {
      const fnBody = content.slice(content.indexOf(_));
      const fnLines = fnBody.split("\n").slice(0, 80);
      if (fnLines.length > 60) {
        await persistCodeQualityFinding(audit.id, { smellType: "LONG_METHOD", status: "WARNING", severity: "MEDIUM", finding: "Method likely exceeds 60 lines", filePath: rel });
        findings += 1;
        break;
      }
    }

    for (const pat of SECRET_PATTERNS) {
      if (pat.test(content) && !rel.includes(".env.example")) {
        await persistCodeQualityFinding(audit.id, { smellType: "HARDCODED_SECRET", status: "FAILED", severity: "CRITICAL", finding: "Potential hardcoded secret detected", filePath: rel });
        findings += 1;
      }
    }
  }

  if (findings > 10) {
    await persistTechnicalDebt({
      debtKey: "code_quality_smells",
      category: "CODE_QUALITY",
      title: "Accumulated code smells",
      description: `${findings} code quality findings detected in latest scan`,
      severity: findings > 30 ? "HIGH" : "MEDIUM",
      interestScore: Math.min(100, findings * 2),
      evidence: { findingsCount: findings },
    });
    await persistRecommendation({
      auditId: audit.id,
      category: "CODE_QUALITY",
      title: "Address accumulated code smells",
      description: "Multiple code quality issues detected across the codebase.",
      evidence: { findingsCount: findings },
      expectedImpact: "Reduced maintenance cost and bug rate",
      effortEstimate: "1-3 sprints",
      riskLevel: "LOW",
      priority: findings > 30 ? "HIGH" : "MEDIUM",
      affectedModules: SERVER_ROOTS as unknown as string[],
    });
  }

  emitEngineeringEvent(ENGINEERING_EVENT.AUDIT_COMPLETED, { auditId: audit.id, findings });
  return { auditId: audit.id, findings, filesScanned: Math.min(files.length, limit) };
}
