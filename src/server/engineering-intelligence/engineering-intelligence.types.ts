import type { AuditCategory, AuditSeverity, AuditStatus, EngineeringIntelligenceJobType, RecommendationStatus } from "@prisma/client";

export type EngineeringIntelligenceJobPayload =
  | { type: "DAILY_AUDIT" }
  | { type: "WEEKLY_AUDIT" }
  | { type: "ARCHITECTURE_SCAN"; limit?: number }
  | { type: "CODE_QUALITY_SCAN"; limit?: number }
  | { type: "PERFORMANCE_SCAN"; limit?: number }
  | { type: "SECURITY_SCAN"; limit?: number }
  | { type: "DATABASE_SCAN"; limit?: number }
  | { type: "QUEUE_SCAN"; limit?: number }
  | { type: "API_SCAN"; limit?: number }
  | { type: "INFRASTRUCTURE_SCAN"; limit?: number }
  | { type: "DEPENDENCY_SCAN"; limit?: number }
  | { type: "DOCUMENTATION_SCAN"; limit?: number }
  | { type: "TEST_SCAN"; limit?: number }
  | { type: "OBSERVABILITY_SCAN"; limit?: number }
  | { type: "BUSINESS_RULE_SCAN"; limit?: number }
  | { type: "AI_USAGE_SCAN"; limit?: number }
  | { type: "TRADING_PLATFORM_SCAN"; limit?: number }
  | { type: "HEALTH_SCORE"; reportType?: string }
  | { type: "REFACTORING_ADVISE"; limit?: number };

export type AuditFinding = {
  checkName: string;
  status: AuditStatus;
  severity: AuditSeverity;
  finding: string;
  modulePath?: string;
  filePath?: string;
  evidence?: Record<string, unknown>;
  score?: number;
};

export type RefactoringRecommendation = {
  category: AuditCategory;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  expectedImpact: string;
  effortEstimate: string;
  riskLevel: AuditSeverity;
  priority: AuditSeverity;
  affectedModules: string[];
};

export type EngineeringHealthScores = {
  architectureScore: number;
  codeQualityScore: number;
  securityScore: number;
  performanceScore: number;
  scalabilityScore: number;
  maintainabilityScore: number;
  reliabilityScore: number;
  testScore: number;
  observabilityScore: number;
  documentationScore: number;
  technicalDebtScore: number;
  overallScore: number;
};

export const PROTECTED_MODULES = [
  "scanner", "decision-engine", "execution", "risk", "portfolio",
  "learning-engine", "quant-research", "ai-governance", "news-intelligence",
  "whale-intelligence", "onchain-intelligence", "trading-strategy",
] as const;

export const SERVER_ROOTS = ["src/server", "app/api", "services", "lib", "scripts"] as const;

export const ENGINEERING_EVENT = {
  AUDIT_STARTED: "EngineeringAuditStarted",
  AUDIT_COMPLETED: "EngineeringAuditCompleted",
  FINDING_DETECTED: "EngineeringFindingDetected",
  RECOMMENDATION_CREATED: "EngineeringRecommendationCreated",
  HEALTH_SCORED: "EngineeringHealthScored",
  DEBT_DETECTED: "TechnicalDebtDetected",
  DAILY_REPORT: "EngineeringDailyReport",
  WEEKLY_REPORT: "EngineeringWeeklyReport",
} as const;

export type { AuditCategory, AuditSeverity, AuditStatus, EngineeringIntelligenceJobType, RecommendationStatus };
