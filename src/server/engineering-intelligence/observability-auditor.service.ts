import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createEngineeringAudit, persistPerformanceFinding } from "@/src/server/engineering-intelligence/engineering-intelligence.repository";
import { emitEngineeringEvent, ENGINEERING_EVENT } from "@/src/server/engineering-intelligence/engineering-intelligence.events";

const ROOT = process.cwd();

export async function auditObservability(limit = 30) {
  const audit = await createEngineeringAudit({
    auditType: "OBSERVABILITY_SCAN",
    category: "OBSERVABILITY",
    summary: "Logging, tracing, and monitoring audit",
  });

  let findings = 0;
  const obsDir = join(ROOT, "src/server/observability");
  const hasObservability = existsSync(obsDir);

  await persistPerformanceFinding(audit.id, {
    checkName: "OBSERVABILITY_MODULE", status: hasObservability ? "PASSED" : "WARNING",
    severity: hasObservability ? "INFO" : "MEDIUM",
    finding: hasObservability ? "Observability module present" : "No dedicated observability module",
    target: "src/server/observability",
  });
  if (!hasObservability) findings += 1;

  const libLogger = join(ROOT, "lib/logger.ts");
  const hasLogger = existsSync(libLogger);
  await persistPerformanceFinding(audit.id, {
    checkName: "CENTRALIZED_LOGGING", status: hasLogger ? "PASSED" : "WARNING",
    severity: hasLogger ? "INFO" : "HIGH",
    finding: hasLogger ? "Centralized logger configured" : "Missing centralized logger",
    target: "lib/logger.ts",
  });
  if (!hasLogger) findings += 1;

  if (existsSync(join(ROOT, "src/server"))) {
    let consoleLogCount = 0;
    let loggerUsage = 0;
    const files = walkFiles(join(ROOT, "src/server")).slice(0, limit * 5);
    for (const f of files) {
      try {
        const c = readFileSync(f, "utf-8");
        consoleLogCount += (c.match(/console\.(log|warn|error)/g) ?? []).length;
        loggerUsage += (c.match(/logger\.(info|warn|error|debug)/g) ?? []).length;
      } catch { /* skip */ }
    }
    if (consoleLogCount > loggerUsage) {
      await persistPerformanceFinding(audit.id, {
        checkName: "CONSOLE_LOG_USAGE", status: "WARNING", severity: "LOW",
        finding: `console.log usage (${consoleLogCount}) exceeds logger usage (${loggerUsage})`,
        metric: "consoleLogCount", value: consoleLogCount, threshold: loggerUsage,
      });
      findings += 1;
    }
  }

  emitEngineeringEvent(ENGINEERING_EVENT.AUDIT_COMPLETED, { auditId: audit.id, findings });
  return { auditId: audit.id, findings };
}

function walkFiles(dir: string, depth = 0): string[] {
  if (depth > 4 || !existsSync(dir)) return [];
  const out: string[] = [];
  try {
    for (const e of readdirSync(dir)) {
      if (e === "node_modules") continue;
      const p = join(dir, e);
      if (require("node:fs").statSync(p).isDirectory()) out.push(...walkFiles(p, depth + 1));
      else if (/\.ts$/.test(e)) out.push(p);
    }
  } catch { /* skip */ }
  return out;
}
