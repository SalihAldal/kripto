import { buildGlobalContext } from "@/src/server/meta-intelligence/global-context.service";
import { fuseContext } from "@/src/server/meta-intelligence/context-fusion.service";
import { resolveConflicts } from "@/src/server/meta-intelligence/conflict-resolver.service";
import { calibrateConfidence } from "@/src/server/meta-intelligence/confidence-calibration.service";
import { generateExecutiveReasoning } from "@/src/server/meta-intelligence/executive-reasoning.service";
import { buildMarketNarrative } from "@/src/server/meta-intelligence/narrative-builder.service";
import { rankPriorities } from "@/src/server/meta-intelligence/priority-engine.service";
import { conveneCommittee } from "@/src/server/meta-intelligence/committee.service";
import { generateExecutiveReport, generateRecommendations } from "@/src/server/meta-intelligence/executive-reports.service";
import { learnExecutiveInsights } from "@/src/server/meta-intelligence/executive-learning.service";
import { buildMetaKnowledgeGraph } from "@/src/server/meta-intelligence/knowledge-graph.service";
import { planFutureHorizon } from "@/src/server/meta-intelligence/future-planning.service";
import { trackExecutiveKpis } from "@/src/server/meta-intelligence/executive-kpi.service";
import { trackStrategicObjectives } from "@/src/server/meta-intelligence/strategic-objectives.service";
import { recordMetaMemory } from "@/src/server/meta-intelligence/meta-memory.service";
import type { MetaIntelligenceJobPayload } from "@/src/server/meta-intelligence/meta-intelligence.types";

export async function runMetaIntelligenceJob(payload: MetaIntelligenceJobPayload) {
  switch (payload.type) {
    case "CONTEXT_BUILD":
      return buildGlobalContext();
    case "CONTEXT_FUSION":
      return fuseContext(payload.contextId);
    case "CONFLICT_RESOLVE":
      return resolveConflicts(payload.contextId);
    case "CONFIDENCE_CALIBRATE":
      return calibrateConfidence(payload.contextId);
    case "EXECUTIVE_REASON":
      return generateExecutiveReasoning(payload.contextId);
    case "NARRATIVE_BUILD":
      return buildMarketNarrative(payload.limit);
    case "PRIORITY_RANK":
      return rankPriorities(payload.limit);
    case "COMMITTEE_MEET":
      return conveneCommittee(payload.topic);
    case "EXECUTIVE_REPORT":
      return generateExecutiveReport(payload.reportType);
    case "EXECUTIVE_LEARN":
      return learnExecutiveInsights(payload.limit);
    case "KNOWLEDGE_BUILD":
      return buildMetaKnowledgeGraph(payload.limit);
    case "FUTURE_PLAN":
      return planFutureHorizon();
    case "KPI_TRACK":
      return trackExecutiveKpis();
    case "STRATEGIC_OBJECTIVES":
      return trackStrategicObjectives();
    default:
      return { skipped: true };
  }
}
