import { createHash } from "node:crypto";
import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type { AuditCategory, AuditSeverity, AuditStatus, EngineeringHealthScores, RefactoringRecommendation } from "@/src/server/engineering-intelligence/engineering-intelligence.types";

export function buildAuditKey(auditType: string) {
  return createHash("sha256").update(`${auditType}_${Date.now()}`).digest("hex").slice(0, 24);
}

export async function createEngineeringAudit(input: {
  auditType: string;
  category: AuditCategory;
  summary: string;
  status?: AuditStatus;
  severity?: AuditSeverity;
  findingsCount?: number;
  score?: number;
  evidence?: Record<string, unknown>;
}) {
  const auditKey = buildAuditKey(input.auditType);
  return prisma.engineeringAudit.create({
    data: {
      auditKey,
      auditType: input.auditType,
      category: input.category,
      summary: input.summary,
      status: input.status ?? "PASSED",
      severity: input.severity ?? "INFO",
      findingsCount: input.findingsCount ?? 0,
      score: input.score ?? 100,
      evidence: input.evidence as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });
}

export async function persistArchitectureFinding(auditId: string, input: {
  checkName: string; status: AuditStatus; severity: AuditSeverity; finding: string;
  modulePath?: string; evidence?: Record<string, unknown>; score?: number;
}) {
  return prisma.architectureAudit.create({ data: { auditId, ...input, evidence: input.evidence as Prisma.InputJsonValue } });
}

export async function persistPerformanceFinding(auditId: string, input: {
  checkName: string; status: AuditStatus; severity: AuditSeverity; finding: string;
  target?: string; metric?: string; value?: number; threshold?: number; evidence?: Record<string, unknown>;
}) {
  return prisma.performanceAudit.create({ data: { auditId, ...input, evidence: input.evidence as Prisma.InputJsonValue } });
}

export async function persistSecurityFinding(auditId: string, input: {
  checkName: string; status: AuditStatus; severity: AuditSeverity; finding: string;
  filePath?: string; cveId?: string; evidence?: Record<string, unknown>;
}) {
  return prisma.securityAudit.create({ data: { auditId, ...input, evidence: input.evidence as Prisma.InputJsonValue } });
}

export async function persistDependencyFinding(auditId: string, input: {
  packageName: string; status: AuditStatus; severity: AuditSeverity; finding: string;
  currentVersion?: string; latestVersion?: string; license?: string; cveIds?: string[]; isUnused?: boolean; evidence?: Record<string, unknown>;
}) {
  return prisma.dependencyAudit.create({ data: { auditId, ...input, cveIds: input.cveIds ?? [], evidence: input.evidence as Prisma.InputJsonValue } });
}

export async function persistCodeQualityFinding(auditId: string, input: {
  smellType: string; status: AuditStatus; severity: AuditSeverity; finding: string;
  filePath?: string; lineNumber?: number; evidence?: Record<string, unknown>;
}) {
  return prisma.codeQualityAudit.create({ data: { auditId, ...input, evidence: input.evidence as Prisma.InputJsonValue } });
}

export async function persistQueueFinding(auditId: string, input: {
  queueName: string; status: AuditStatus; severity: AuditSeverity; finding: string;
  pendingJobs?: number; failedJobs?: number; avgProcessMs?: number; workerHealth?: number; evidence?: Record<string, unknown>;
}) {
  return prisma.queueAudit.create({ data: { auditId, ...input, evidence: input.evidence as Prisma.InputJsonValue } });
}

export async function persistApiFinding(auditId: string, input: {
  routePath: string; method?: string; status: AuditStatus; severity: AuditSeverity; finding: string;
  responseTimeMs?: number; hasAuth?: boolean; evidence?: Record<string, unknown>;
}) {
  return prisma.apiAudit.create({ data: { auditId, method: input.method ?? "GET", ...input, evidence: input.evidence as Prisma.InputJsonValue } });
}

export async function persistInfrastructureFinding(auditId: string, input: {
  component: string; status: AuditStatus; severity: AuditSeverity; finding: string;
  healthScore?: number; evidence?: Record<string, unknown>;
}) {
  return prisma.infrastructureAudit.create({ data: { auditId, ...input, evidence: input.evidence as Prisma.InputJsonValue } });
}

export async function persistTestFinding(auditId: string, input: {
  modulePath?: string; status: AuditStatus; severity: AuditSeverity; finding: string;
  coveragePct?: number; testCount?: number; evidence?: Record<string, unknown>;
}) {
  return prisma.testAudit.create({ data: { auditId, ...input, evidence: input.evidence as Prisma.InputJsonValue } });
}

export async function persistDocumentationFinding(auditId: string, input: {
  docType: string; status: AuditStatus; severity: AuditSeverity; finding: string;
  docPath?: string; evidence?: Record<string, unknown>;
}) {
  return prisma.documentationAudit.create({ data: { auditId, ...input, evidence: input.evidence as Prisma.InputJsonValue } });
}

export async function persistRecommendation(input: RefactoringRecommendation & { auditId?: string }) {
  return prisma.engineeringRecommendation.create({
    data: {
      auditId: input.auditId,
      category: input.category,
      title: input.title,
      description: input.description,
      evidence: input.evidence as Prisma.InputJsonValue,
      expectedImpact: input.expectedImpact,
      effortEstimate: input.effortEstimate,
      riskLevel: input.riskLevel,
      priority: input.priority,
      affectedModules: input.affectedModules,
    },
  });
}

export async function persistTechnicalDebt(input: {
  debtKey: string; category: AuditCategory; title: string; description: string;
  severity?: AuditSeverity; modulePath?: string; estimatedHours?: number; interestScore?: number; evidence?: Record<string, unknown>;
}) {
  return prisma.technicalDebt.upsert({
    where: { debtKey: input.debtKey },
    create: { ...input, evidence: input.evidence as Prisma.InputJsonValue },
    update: { description: input.description, severity: input.severity, interestScore: input.interestScore, evidence: input.evidence as Prisma.InputJsonValue },
  });
}

export async function persistEngineeringHealth(input: EngineeringHealthScores & {
  reportType: string; criticalIssues?: number; highIssues?: number; mediumIssues?: number; lowIssues?: number; metadata?: Record<string, unknown>;
}) {
  const reportKey = `${input.reportType}_${Date.now()}`;
  return prisma.engineeringHealth.create({
    data: { reportKey, ...input, metadata: input.metadata as Prisma.InputJsonValue },
  });
}

export async function getEngineeringDashboard() {
  const [audits, health, recommendations, debt, critical, high] = await Promise.all([
    prisma.engineeringAudit.findMany({ orderBy: { startedAt: "desc" }, take: 30 }),
    prisma.engineeringHealth.findMany({ orderBy: { scoredAt: "desc" }, take: 10 }),
    prisma.engineeringRecommendation.findMany({ where: { status: "OPEN" }, orderBy: { priority: "asc" }, take: 30 }),
    prisma.technicalDebt.findMany({ where: { isResolved: false }, orderBy: { interestScore: "desc" }, take: 30 }),
    prisma.engineeringAudit.count({ where: { severity: "CRITICAL", startedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60_000) } } }),
    prisma.engineeringAudit.count({ where: { severity: "HIGH", startedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60_000) } } }),
  ]);
  return { audits, health, recommendations, debt, issueCounts: { critical, high } };
}

export async function listAuditHistory(limit = 50, category?: string) {
  return prisma.engineeringAudit.findMany({
    where: category ? { category: category as never } : undefined,
    orderBy: { startedAt: "desc" },
    take: limit,
    include: { recommendations: { take: 5 } },
  });
}

export async function listOpenRecommendations(limit = 50) {
  return prisma.engineeringRecommendation.findMany({
    where: { status: "OPEN" },
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
    take: limit,
  });
}

export async function listTechnicalDebt(limit = 50) {
  return prisma.technicalDebt.findMany({
    where: { isResolved: false },
    orderBy: { interestScore: "desc" },
    take: limit,
  });
}
