import { createLearningSession, completeLearningSession } from "@/src/server/learning-engine/learning-engine.repository";
import { learnFromDecision, learnFromRecentDecisions } from "@/src/server/learning-engine/decision-learning.service";
import { learnFromRecentTrades, learnFromTrade } from "@/src/server/learning-engine/trade-learning.service";
import { learnFromRecentRejects } from "@/src/server/learning-engine/reject-learning.service";
import { learnFromMissedOpportunities } from "@/src/server/learning-engine/missed-opportunity-learning.service";
import { learnFalsePositives } from "@/src/server/learning-engine/false-positive-learning.service";
import { discoverPatterns } from "@/src/server/learning-engine/pattern-discovery.service";
import { computeFeatureImportance } from "@/src/server/learning-engine/feature-importance.service";
import { generateLearningWeightSuggestions } from "@/src/server/learning-engine/weight-recommendation.service";
import { generateDailyAIReport } from "@/src/server/learning-engine/ai-self-critique.service";
import { generateWeeklyResearch } from "@/src/server/learning-engine/weekly-research.service";
import { buildKnowledgeBase } from "@/src/server/learning-engine/knowledge-base.service";
import { computeConfidenceCalibration } from "@/src/server/learning-engine/confidence-calibration.service";
import { runResearchLabSimulation } from "@/src/server/learning-engine/research-lab.service";
import { syncLearningMemories } from "@/src/server/learning-engine/learning-memory.service";
import { emitLearningEngineEvent, LEARNING_EVENT } from "@/src/server/learning-engine/learning-engine.events";
import type { LearningEngineJobPayload } from "@/src/server/learning-engine/learning-engine.types";

export async function runLearningEngineJob(payload: LearningEngineJobPayload) {
  const session = await createLearningSession({ sessionType: payload.type, metadata: payload as Record<string, unknown> });
  emitLearningEngineEvent(LEARNING_EVENT.SESSION_STARTED, { sessionId: session.id, type: payload.type });

  let result: unknown;
  switch (payload.type) {
    case "DECISION_LEARN":
      result = payload.decisionId ? await learnFromDecision(payload.decisionId) : await learnFromRecentDecisions(payload.limit);
      break;
    case "TRADE_LEARN":
      result = payload.tradeId ? await learnFromTrade(payload.tradeId) : await learnFromRecentTrades(payload.limit);
      break;
    case "REJECT_LEARN":
      result = await learnFromRecentRejects(payload.limit);
      break;
    case "MISSED_OPPORTUNITY_LEARN":
      result = await learnFromMissedOpportunities(payload.limit);
      break;
    case "FALSE_POSITIVE_LEARN":
      result = await learnFalsePositives(payload.limit);
      break;
    case "PATTERN_DISCOVERY":
      result = await discoverPatterns(payload.limit);
      emitLearningEngineEvent(LEARNING_EVENT.PATTERN_DISCOVERED, result as Record<string, unknown>);
      break;
    case "FEATURE_IMPORTANCE":
      result = await computeFeatureImportance(payload.periodHours);
      break;
    case "WEIGHT_RECOMMENDATION":
      result = await generateLearningWeightSuggestions();
      emitLearningEngineEvent(LEARNING_EVENT.WEIGHT_SUGGESTED, result as Record<string, unknown>);
      break;
    case "DAILY_AI_REPORT":
      result = await generateDailyAIReport(payload.date ? new Date(payload.date) : new Date());
      emitLearningEngineEvent(LEARNING_EVENT.REPORT_GENERATED, { type: "DAILY", result });
      break;
    case "WEEKLY_RESEARCH":
      result = await generateWeeklyResearch(payload.weekStart ? new Date(payload.weekStart) : new Date());
      emitLearningEngineEvent(LEARNING_EVENT.REPORT_GENERATED, { type: "WEEKLY", result });
      break;
    case "KNOWLEDGE_BUILD":
      result = await buildKnowledgeBase(payload.limit);
      emitLearningEngineEvent(LEARNING_EVENT.KNOWLEDGE_ADDED, result as Record<string, unknown>);
      break;
    case "CONFIDENCE_CALIBRATION":
      result = await computeConfidenceCalibration(payload.periodHours);
      break;
    case "RESEARCH_LAB":
      result = await runResearchLabSimulation({ ideaId: payload.ideaId });
      break;
    case "MEMORY_SYNC":
      result = await syncLearningMemories(payload.memoryType);
      break;
    default:
      result = { skipped: true };
  }

  await completeLearningSession(session.id, { result });
  emitLearningEngineEvent(LEARNING_EVENT.SESSION_COMPLETED, { sessionId: session.id, type: payload.type });
  return result;
}
