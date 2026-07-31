import type { ExpertType } from "@prisma/client";
import type { AIAnalysisInput, AIProviderResult } from "@/src/types/ai";
import type { ExpertOpinionResult } from "@/src/server/decision-engine/decision-engine.types";
import {
  analyzeExecutionExpert,
  analyzeLearningExpert,
  analyzeLiquidityExpert,
  analyzeMarketExpert,
  analyzeMomentumExpert,
  analyzeNewsExpert,
  analyzeRiskExpert,
  analyzeVolumeExpert,
} from "@/src/server/decision-engine/experts/domain-experts";

const EXPERT_TIMEOUT_MS = 8_000;

type ExpertTask = {
  expertType: ExpertType;
  run: () => ExpertOpinionResult;
};

function fallbackOpinion(expertType: ExpertType, reason: string): ExpertOpinionResult {
  return {
    expertType,
    opinion: "NO_OPINION",
    confidence: 0,
    score: 0,
    summary: reason,
    positiveFactors: [],
    negativeFactors: [],
    topRisks: [reason],
  };
}

async function withTimeout(expertType: ExpertType, fn: () => ExpertOpinionResult): Promise<ExpertOpinionResult> {
  return Promise.race([
    Promise.resolve().then(fn),
    new Promise<ExpertOpinionResult>((resolve) => {
      setTimeout(() => resolve(fallbackOpinion(expertType, "timeout")), EXPERT_TIMEOUT_MS);
    }),
  ]).catch(() => fallbackOpinion(expertType, "expertFailure"));
}

export async function runAllExperts(input: AIAnalysisInput, providerResults?: AIProviderResult[]): Promise<ExpertOpinionResult[]> {
  const tasks: ExpertTask[] = [
    { expertType: "MARKET", run: () => analyzeMarketExpert(input, providerResults) },
    { expertType: "MOMENTUM", run: () => analyzeMomentumExpert(input, providerResults) },
    { expertType: "VOLUME", run: () => analyzeVolumeExpert(input) },
    { expertType: "LIQUIDITY", run: () => analyzeLiquidityExpert(input) },
    { expertType: "RISK", run: () => analyzeRiskExpert(input, providerResults) },
    { expertType: "NEWS", run: () => analyzeNewsExpert(input) },
    { expertType: "EXECUTION", run: () => analyzeExecutionExpert(input) },
    { expertType: "LEARNING", run: () => analyzeLearningExpert(input) },
  ];

  return Promise.all(tasks.map((task) => withTimeout(task.expertType, task.run)));
}
