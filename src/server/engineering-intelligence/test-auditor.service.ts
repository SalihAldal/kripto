import { readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { createEngineeringAudit, persistTestFinding } from "@/src/server/engineering-intelligence/engineering-intelligence.repository";
import { emitEngineeringEvent, ENGINEERING_EVENT } from "@/src/server/engineering-intelligence/engineering-intelligence.events";

const ROOT = process.cwd();

function findTests(dir: string, depth = 0): string[] {
  if (depth > 6 || !existsSync(dir)) return [];
  const out: string[] = [];
  try {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) out.push(...findTests(p, depth + 1));
      else if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(e)) out.push(p);
    }
  } catch { /* skip */ }
  return out;
}

function countModules(dir: string): number {
  if (!existsSync(dir)) return 0;
  try { return readdirSync(dir).filter((e) => statSync(join(dir, e)).isDirectory()).length; } catch { return 0; }
}

export async function auditTests(limit = 30) {
  const audit = await createEngineeringAudit({
    auditType: "TEST_SCAN",
    category: "TEST",
    summary: "Test coverage and critical path audit",
  });

  const testDirs = ["tests", "test", "__tests__", "src"].map((d) => join(ROOT, d));
  const allTests = [...new Set(testDirs.flatMap((d) => findTests(d)))];
  const serverModules = countModules(join(ROOT, "src/server"));
  const coverageEstimate = serverModules > 0 ? Math.min(100, (allTests.length / serverModules) * 10) : 0;

  let findings = 0;
  const criticalModules = ["scanner", "decision-engine", "execution", "risk-engine"];
  for (const mod of criticalModules.slice(0, limit)) {
    const modTests = allTests.filter((t) => t.includes(mod));
    const hasTests = modTests.length > 0;
    await persistTestFinding(audit.id, {
      modulePath: `src/server/${mod}`,
      status: hasTests ? "PASSED" : "WARNING",
      severity: hasTests ? "INFO" : "HIGH",
      testCount: modTests.length,
      coveragePct: hasTests ? Math.min(100, modTests.length * 20) : 0,
      finding: hasTests ? `${modTests.length} test files for ${mod}` : `No tests found for critical module ${mod}`,
    });
    if (!hasTests) findings += 1;
  }

  await persistTestFinding(audit.id, {
    status: coverageEstimate >= 30 ? "PASSED" : "WARNING",
    severity: coverageEstimate >= 30 ? "INFO" : "MEDIUM",
    testCount: allTests.length,
    coveragePct: coverageEstimate,
    finding: `Estimated coverage: ${coverageEstimate.toFixed(0)}% (${allTests.length} test files, ${serverModules} modules)`,
  });

  emitEngineeringEvent(ENGINEERING_EVENT.AUDIT_COMPLETED, { auditId: audit.id, findings, testCount: allTests.length });
  return { auditId: audit.id, findings, testCount: allTests.length, coverageEstimate };
}
