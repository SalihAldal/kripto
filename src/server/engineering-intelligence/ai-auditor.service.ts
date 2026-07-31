import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createEngineeringAudit, persistPerformanceFinding, persistRecommendation } from "@/src/server/engineering-intelligence/engineering-intelligence.repository";
import { emitEngineeringEvent, ENGINEERING_EVENT } from "@/src/server/engineering-intelligence/engineering-intelligence.events";

const ROOT = process.cwd();

export async function auditAiUsage(limit = 50) {
  const audit = await createEngineeringAudit({
    auditType: "AI_USAGE_SCAN",
    category: "AI",
    summary: "AI prompt quality and usage audit (read-only)",
  });

  let findings = 0;
  const aiDirs = ["src/server/ai", "src/server/decision-engine", "lib/ai", "prompts"].map((d) => join(ROOT, d));
  const promptFiles: string[] = [];

  for (const dir of aiDirs) {
    if (!existsSync(dir)) continue;
    promptFiles.push(...walkFiles(dir).filter((f) => /prompt|ai|llm|gpt/i.test(f)));
  }

  const promptContents = new Map<string, string>();
  for (const f of promptFiles.slice(0, limit)) {
    try {
      const content = readFileSync(f, "utf-8");
      promptContents.set(f, content);
    } catch { /* skip */ }
  }

  const hashes = new Map<string, string[]>();
  for (const [file, content] of promptContents) {
    const normalized = content.replace(/\s+/g, " ").slice(0, 500);
    const existing = hashes.get(normalized);
    if (existing) existing.push(file);
    else hashes.set(normalized, [file]);
  }

  for (const [, files] of hashes) {
    if (files.length > 1) {
      await persistPerformanceFinding(audit.id, {
        checkName: "PROMPT_DUPLICATION", status: "WARNING", severity: "MEDIUM",
        finding: `Duplicate prompt content across ${files.length} files`,
        evidence: { files: files.map((f) => f.replace(ROOT, "")) },
      });
      findings += 1;
    }
  }

  for (const [file, content] of promptContents) {
    const tokens = Math.ceil(content.length / 4);
    if (tokens > 4000) {
      await persistPerformanceFinding(audit.id, {
        checkName: "LARGE_PROMPT", status: "WARNING", severity: "MEDIUM",
        finding: `Large prompt (~${tokens} tokens) in ${file.replace(ROOT, "")}`,
        metric: "estimatedTokens", value: tokens, threshold: 4000,
      });
      findings += 1;
    }
  }

  if (findings > 0) {
    await persistRecommendation({
      auditId: audit.id,
      category: "AI",
      title: "Optimize AI prompt usage",
      description: "Duplicate or oversized prompts detected. Review for token waste reduction.",
      evidence: { promptFileCount: promptFiles.length, findings },
      expectedImpact: "Reduced AI cost and latency",
      effortEstimate: "1-2 days",
      riskLevel: "LOW",
      priority: "MEDIUM",
      affectedModules: ["src/server/ai", "prompts"],
    });
  }

  emitEngineeringEvent(ENGINEERING_EVENT.AUDIT_COMPLETED, { auditId: audit.id, findings, promptFiles: promptFiles.length });
  return { auditId: audit.id, findings, promptFiles: promptFiles.length };
}

function walkFiles(dir: string, depth = 0): string[] {
  if (depth > 5 || !existsSync(dir)) return [];
  const out: string[] = [];
  try {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (require("node:fs").statSync(p).isDirectory()) out.push(...walkFiles(p, depth + 1));
      else if (/\.(ts|tsx|md|txt|json)$/.test(e)) out.push(p);
    }
  } catch { /* skip */ }
  return out;
}
