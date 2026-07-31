import { prisma } from "@/src/server/db/prisma";

function getAiPerformanceModel() {
  return (prisma as typeof prisma & { aiPerformanceMemory?: typeof prisma.aiPerformanceMemory }).aiPerformanceMemory;
}

export type AiPerformanceCreateInput = {
  userId: string;
  aiName: string;
  symbol: string;
  predictedDirection: string;
  predictedPercent: number;
  predictedRangeMin?: number | null;
  predictedRangeMax?: number | null;
  confidenceScore: number;
  entryPrice: number;
  horizonMinutes: number;
};

export async function addAiPerformanceMemory(input: AiPerformanceCreateInput) {
  const model = getAiPerformanceModel();
  if (!model) return null;
  return model.create({
    data: {
      userId: input.userId,
      aiName: input.aiName,
      symbol: input.symbol,
      predictedDirection: input.predictedDirection,
      predictedPercent: input.predictedPercent,
      predictedRangeMin: input.predictedRangeMin ?? null,
      predictedRangeMax: input.predictedRangeMax ?? null,
      confidenceScore: input.confidenceScore,
      entryPrice: input.entryPrice,
      horizonMinutes: input.horizonMinutes,
    },
  });
}

export async function listPendingAiPerformance(userId: string, limit = 120) {
  const model = getAiPerformanceModel();
  if (!model) return [];
  return model.findMany({
    where: { userId, evaluatedAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

export async function updateAiPerformanceMemory(input: {
  id: string;
  actualMoveAfterTime: number;
  result: "SUCCESS" | "FAILED" | "PARTIAL";
  errorPercent: number;
}) {
  const model = getAiPerformanceModel();
  if (!model) return null;
  return model.update({
    where: { id: input.id },
    data: {
      actualMoveAfterTime: input.actualMoveAfterTime,
      result: input.result,
      errorPercent: input.errorPercent,
      evaluatedAt: new Date(),
    },
  });
}

export async function listRecentAiPerformance(userId: string, limit = 120) {
  const model = getAiPerformanceModel();
  if (!model) return [];
  return model.findMany({
    where: { userId, result: { not: null } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
