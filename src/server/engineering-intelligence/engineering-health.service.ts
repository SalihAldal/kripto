import { prisma } from "@/src/server/db/prisma";
import { persistEngineeringHealth, persistRecommendation } from "@/src/server/engineering-intelligence/engineering-intelligence.repository";
import { emitEngineeringEvent, ENGINEERING_EVENT } from "@/src/server/engineering-intelligence/engineering-intelligence.events";
import type { EngineeringHealthScores } from "@/src/server/engineering-intelligence/engineering-intelligence.types";

export async function computeEngineeringHealth(reportType = "DAILY") {
  const since = new Date(Date.now() - (reportType === "WEEKLY" ? 7 : 1) * 24 * 60 * 60_000);

  const [archAudits, codeAudits, secAudits, perfAudits, testAudits, docAudits, debt, recommendations] = await Promise.all([
    prisma.architectureAudit.count({ where: { recordedAt: { gte: since }, status: { not: "PASSED" } } }),
    prisma.codeQualityAudit.count({ where: { recordedAt: { gte: since }, status: { not: "PASSED" } } }),
    prisma.securityAudit.count({ where: { recordedAt: { gte: since }, severity: { in: ["CRITICAL", "HIGH"] } } }),
    prisma.performanceAudit.count({ where: { recordedAt: { gte: since }, status: { not: "PASSED" } } }),
    prisma.testAudit.count({ where: { recordedAt: { gte: since }, status: { not: "PASSED" } } }),
    prisma.documentationAudit.count({ where: { recordedAt: { gte: since }, status: "FAILED" } }),
    prisma.technicalDebt.count({ where: { isResolved: false } }),
    prisma.engineeringRecommendation.count({ where: { status: "OPEN" } }),
  ]);

  const scores: EngineeringHealthScores = {
    architectureScore: Math.max(0, 100 - archAudits * 3),
    codeQualityScore: Math.max(0, 100 - codeAudits * 2),
    securityScore: Math.max(0, 100 - secAudits * 10),
    performanceScore: Math.max(0, 100 - perfAudits * 4),
    scalabilityScore: Math.max(0, 100 - Math.min(30, debt) * 2),
    maintainabilityScore: Math.max(0, 100 - recommendations * 2),
    reliabilityScore: Math.max(0, 100 - perfAudits * 3),
    testScore: Math.max(0, 100 - testAudits * 5),
    observabilityScore: 75,
    documentationScore: Math.max(0, 100 - docAudits * 15),
    technicalDebtScore: Math.max(0, 100 - debt * 3),
    overallScore: 0,
  };

  scores.overallScore = Number(
    (
      (scores.architectureScore + scores.codeQualityScore + scores.securityScore +
        scores.performanceScore + scores.scalabilityScore + scores.maintainabilityScore +
        scores.reliabilityScore + scores.testScore + scores.observabilityScore +
        scores.documentationScore + scores.technicalDebtScore) /
      11
    ).toFixed(1),
  );

  const critical = secAudits + (archAudits > 5 ? 1 : 0);
  const high = codeAudits + perfAudits;
  const medium = testAudits + docAudits;
  const low = recommendations;

  const health = await persistEngineeringHealth({
    reportType,
    ...scores,
    criticalIssues: critical,
    highIssues: high,
    mediumIssues: medium,
    lowIssues: low,
    metadata: { period: reportType, since: since.toISOString() },
  });

  emitEngineeringEvent(ENGINEERING_EVENT.HEALTH_SCORED, { reportType, overallScore: scores.overallScore });
  return health;
}

export async function generateRefactoringAdvice(limit = 20) {
  const openRecs = await prisma.engineeringRecommendation.findMany({
    where: { status: "OPEN" },
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
    take: limit,
  });

  const debt = await prisma.technicalDebt.findMany({
    where: { isResolved: false },
    orderBy: { interestScore: "desc" },
    take: limit,
  });

  const advice = [];
  for (const rec of openRecs) {
    advice.push({
      type: "RECOMMENDATION",
      title: rec.title,
      description: rec.description,
      priority: rec.priority,
      effort: rec.effortEstimate,
      impact: rec.expectedImpact,
      modules: rec.affectedModules,
    });
  }

  for (const d of debt) {
    if (advice.length >= limit) break;
    await persistRecommendation({
      category: d.category,
      title: `Resolve technical debt: ${d.title}`,
      description: d.description,
      evidence: d.evidence as Record<string, unknown> ?? {},
      expectedImpact: "Reduced maintenance burden",
      effortEstimate: d.estimatedHours ? `${d.estimatedHours}h` : "Unknown",
      riskLevel: d.severity,
      priority: d.severity,
      affectedModules: d.modulePath ? [d.modulePath] : [],
    });
    advice.push({ type: "DEBT", title: d.title, interestScore: d.interestScore });
  }

  return { advice, count: advice.length };
}

export async function runDailyAudit() {
  const { auditArchitecture } = await import("@/src/server/engineering-intelligence/architecture-auditor.service");
  const { auditCodeQuality } = await import("@/src/server/engineering-intelligence/code-quality-auditor.service");
  const { auditSecurity } = await import("@/src/server/engineering-intelligence/security-auditor.service");
  const { auditQueues } = await import("@/src/server/engineering-intelligence/queue-auditor.service");
  const { auditApis } = await import("@/src/server/engineering-intelligence/api-auditor.service");

  const results = await Promise.allSettled([
    auditArchitecture(30),
    auditCodeQuality(80),
    auditSecurity(100),
    auditQueues(10),
    auditApis(80),
    computeEngineeringHealth("DAILY"),
  ]);

  emitEngineeringEvent(ENGINEERING_EVENT.DAILY_REPORT, {
    completed: results.filter((r) => r.status === "fulfilled").length,
    failed: results.filter((r) => r.status === "rejected").length,
  });

  return {
    type: "DAILY",
    scans: results.map((r, i) => ({ index: i, status: r.status })),
    health: results[5]?.status === "fulfilled" ? (results[5] as PromiseFulfilledResult<unknown>).value : null,
  };
}

export async function runWeeklyAudit() {
  const { auditPerformance } = await import("@/src/server/engineering-intelligence/performance-auditor.service");
  const { auditDatabase } = await import("@/src/server/engineering-intelligence/database-auditor.service");
  const { auditDependencies } = await import("@/src/server/engineering-intelligence/dependency-auditor.service");
  const { auditTests } = await import("@/src/server/engineering-intelligence/test-auditor.service");
  const { auditDocumentation } = await import("@/src/server/engineering-intelligence/documentation-auditor.service");
  const { auditInfrastructure } = await import("@/src/server/engineering-intelligence/infrastructure-auditor.service");
  const { auditObservability } = await import("@/src/server/engineering-intelligence/observability-auditor.service");
  const { auditAiUsage } = await import("@/src/server/engineering-intelligence/ai-auditor.service");
  const { auditBusinessRules } = await import("@/src/server/engineering-intelligence/business-rule-auditor.service");
  const { auditTradingPlatform } = await import("@/src/server/engineering-intelligence/trading-platform-auditor.service");

  const results = await Promise.allSettled([
    auditPerformance(30),
    auditDatabase(50),
    auditDependencies(100),
    auditTests(30),
    auditDocumentation(10),
    auditInfrastructure(10),
    auditObservability(30),
    auditAiUsage(50),
    auditBusinessRules(20),
    auditTradingPlatform(10),
    computeEngineeringHealth("WEEKLY"),
    generateRefactoringAdvice(30),
  ]);

  emitEngineeringEvent(ENGINEERING_EVENT.WEEKLY_REPORT, {
    completed: results.filter((r) => r.status === "fulfilled").length,
  });

  return {
    type: "WEEKLY",
    scans: results.length,
    health: results[10]?.status === "fulfilled" ? (results[10] as PromiseFulfilledResult<unknown>).value : null,
  };
}
