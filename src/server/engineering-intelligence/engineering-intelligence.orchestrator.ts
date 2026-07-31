import { auditArchitecture } from "@/src/server/engineering-intelligence/architecture-auditor.service";
import { auditCodeQuality } from "@/src/server/engineering-intelligence/code-quality-auditor.service";
import { auditPerformance } from "@/src/server/engineering-intelligence/performance-auditor.service";
import { auditDatabase } from "@/src/server/engineering-intelligence/database-auditor.service";
import { auditQueues } from "@/src/server/engineering-intelligence/queue-auditor.service";
import { auditApis } from "@/src/server/engineering-intelligence/api-auditor.service";
import { auditSecurity } from "@/src/server/engineering-intelligence/security-auditor.service";
import { auditDependencies } from "@/src/server/engineering-intelligence/dependency-auditor.service";
import { auditInfrastructure } from "@/src/server/engineering-intelligence/infrastructure-auditor.service";
import { auditTests } from "@/src/server/engineering-intelligence/test-auditor.service";
import { auditDocumentation } from "@/src/server/engineering-intelligence/documentation-auditor.service";
import { auditObservability } from "@/src/server/engineering-intelligence/observability-auditor.service";
import { auditBusinessRules } from "@/src/server/engineering-intelligence/business-rule-auditor.service";
import { auditAiUsage } from "@/src/server/engineering-intelligence/ai-auditor.service";
import { auditTradingPlatform } from "@/src/server/engineering-intelligence/trading-platform-auditor.service";
import { computeEngineeringHealth, generateRefactoringAdvice, runDailyAudit, runWeeklyAudit } from "@/src/server/engineering-intelligence/engineering-health.service";
import type { EngineeringIntelligenceJobPayload } from "@/src/server/engineering-intelligence/engineering-intelligence.types";

export async function runEngineeringIntelligenceJob(payload: EngineeringIntelligenceJobPayload) {
  switch (payload.type) {
    case "DAILY_AUDIT":
      return runDailyAudit();
    case "WEEKLY_AUDIT":
      return runWeeklyAudit();
    case "ARCHITECTURE_SCAN":
      return auditArchitecture(payload.limit);
    case "CODE_QUALITY_SCAN":
      return auditCodeQuality(payload.limit);
    case "PERFORMANCE_SCAN":
      return auditPerformance(payload.limit);
    case "SECURITY_SCAN":
      return auditSecurity(payload.limit);
    case "DATABASE_SCAN":
      return auditDatabase(payload.limit);
    case "QUEUE_SCAN":
      return auditQueues(payload.limit);
    case "API_SCAN":
      return auditApis(payload.limit);
    case "INFRASTRUCTURE_SCAN":
      return auditInfrastructure(payload.limit);
    case "DEPENDENCY_SCAN":
      return auditDependencies(payload.limit);
    case "DOCUMENTATION_SCAN":
      return auditDocumentation(payload.limit);
    case "TEST_SCAN":
      return auditTests(payload.limit);
    case "OBSERVABILITY_SCAN":
      return auditObservability(payload.limit);
    case "BUSINESS_RULE_SCAN":
      return auditBusinessRules(payload.limit);
    case "AI_USAGE_SCAN":
      return auditAiUsage(payload.limit);
    case "TRADING_PLATFORM_SCAN":
      return auditTradingPlatform(payload.limit);
    case "HEALTH_SCORE":
      return computeEngineeringHealth(payload.reportType);
    case "REFACTORING_ADVISE":
      return generateRefactoringAdvice(payload.limit);
    default:
      return { skipped: true };
  }
}
