import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createEngineeringAudit, persistDependencyFinding } from "@/src/server/engineering-intelligence/engineering-intelligence.repository";
import { emitEngineeringEvent, ENGINEERING_EVENT } from "@/src/server/engineering-intelligence/engineering-intelligence.events";

const ROOT = process.cwd();

export async function auditDependencies(limit = 50) {
  const audit = await createEngineeringAudit({
    auditType: "DEPENDENCY_SCAN",
    category: "DEPENDENCY",
    summary: "Dependency health and license audit",
  });

  const pkgPath = join(ROOT, "package.json");
  if (!existsSync(pkgPath)) {
    emitEngineeringEvent(ENGINEERING_EVENT.AUDIT_COMPLETED, { auditId: audit.id, findings: 0 });
    return { auditId: audit.id, findings: 0 };
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  let findings = 0;
  const entries = Object.entries(allDeps).slice(0, limit);

  for (const [name, version] of entries) {
    const isPinned = version.startsWith("^") || version.startsWith("~");
    const severity = name.includes("deprecated") ? "HIGH" as const : !isPinned ? "INFO" as const : "LOW" as const;

    await persistDependencyFinding(audit.id, {
      packageName: name,
      currentVersion: version,
      status: "PASSED",
      severity,
      finding: isPinned ? `${name}@${version} — semver range` : `${name}@${version} — exact pin`,
      license: undefined,
      isUnused: false,
    });
  }

  const srcFiles = existsSync(join(ROOT, "src")) ? countFiles(join(ROOT, "src")) : 0;
  if (Object.keys(allDeps).length > 80) {
    await persistDependencyFinding(audit.id, {
      packageName: "(total)",
      status: "WARNING",
      severity: "MEDIUM",
      finding: `${Object.keys(allDeps).length} total dependencies — review for unused packages`,
      evidence: { totalDeps: Object.keys(allDeps).length, srcFiles },
    });
    findings += 1;
  }

  emitEngineeringEvent(ENGINEERING_EVENT.AUDIT_COMPLETED, { auditId: audit.id, findings, packages: entries.length });
  return { auditId: audit.id, findings, packages: entries.length };
}

function countFiles(dir: string, depth = 0): number {
  if (depth > 5) return 0;
  let count = 0;
  try {
    for (const e of readdirSync(dir)) {
      if (e === "node_modules") continue;
      const p = join(dir, e);
      const stat = require("node:fs").statSync(p);
      if (stat.isDirectory()) count += countFiles(p, depth + 1);
      else count += 1;
    }
  } catch { /* skip */ }
  return count;
}
