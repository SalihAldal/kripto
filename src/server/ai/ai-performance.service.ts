import { prisma } from "@/src/server/db/prisma";
import { logger } from "@/lib/logger";
import { isTransientPrismaConnectivityError } from "@/src/server/db/transient-prisma-error";
import {
  addAiPerformanceMemory,
  listPendingAiPerformance,
  listRecentAiPerformance,
  updateAiPerformanceMemory,
} from "@/src/server/repositories/ai-performance.repository";
import type { AIProviderResult } from "@/src/types/ai";

const evaluatorTimers = new Map<string, ReturnType<typeof setInterval>>();
const weightCache = new Map<string, { weights: Record<string, number>; updatedAt: number }>();
const DB_READ_RETRY_LIMIT = 2;

async function withTransientReadFallback<T>(label: string, fallback: T, work: () => Promise<T>): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < DB_READ_RETRY_LIMIT; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      if (!isTransientPrismaConnectivityError(error) || attempt + 1 >= DB_READ_RETRY_LIMIT) break;
      await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
    }
  }
  if (lastError && isTransientPrismaConnectivityError(lastError)) {
    logger.warn({ label, error: (lastError as Error).message }, "AI performance DB read degraded to fallback");
    return fallback;
  }
  if (lastError) throw lastError;
  return fallback;
}

function clamp(min: number, value: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function resolvePredictedRange(input: {
  predictedPercent: number;
  predictedRangeMin?: number | null;
  predictedRangeMax?: number | null;
}) {
  const fallbackMin = Math.max(0.2, input.predictedPercent * 0.6);
  const fallbackMax = Math.max(fallbackMin + 0.2, input.predictedPercent * 1.35);
  return {
    min: Number.isFinite(input.predictedRangeMin ?? NaN) ? Number(input.predictedRangeMin) : fallbackMin,
    max: Number.isFinite(input.predictedRangeMax ?? NaN) ? Number(input.predictedRangeMax) : fallbackMax,
  };
}

function evaluatePrediction(input: {
  direction: string;
  predictedMin: number;
  predictedMax: number;
  actualMove: number;
}) {
  const min = Math.max(0.1, Math.abs(input.predictedMin));
  const max = Math.max(min, Math.abs(input.predictedMax));
  if (input.direction === "SELL") {
    if (input.actualMove <= -min) return "SUCCESS";
    if (input.actualMove < 0) return "PARTIAL";
    return "FAILED";
  }
  if (input.direction === "BUY") {
    if (input.actualMove >= min) return "SUCCESS";
    if (input.actualMove > 0) return "PARTIAL";
    return "FAILED";
  }
  if (Math.abs(input.actualMove) <= max * 0.4) return "SUCCESS";
  if (Math.abs(input.actualMove) <= max) return "PARTIAL";
  return "FAILED";
}

async function getSnapshotPrice(symbol: string, targetAt: Date) {
  const tradingPair = await withTransientReadFallback("tradingPair.findFirst", null, () => prisma.tradingPair.findFirst({
    where: { symbol: symbol.toUpperCase() },
    select: { id: true },
  }));
  if (!tradingPair) return null;
  const windowStart = new Date(targetAt.getTime() - 10 * 60 * 1000);
  const windowEnd = new Date(targetAt.getTime() + 10 * 60 * 1000);
  const snapshot = await withTransientReadFallback("marketSnapshot.findFirst", null, () => prisma.marketSnapshot.findFirst({
    where: {
      tradingPairId: tradingPair.id,
      snapshotAt: { gte: windowStart, lte: windowEnd },
    },
    orderBy: { snapshotAt: "asc" },
  }));
  if (!snapshot) return null;
  return Number(snapshot.lastPrice ?? snapshot.bidPrice ?? snapshot.askPrice ?? 0);
}

export async function recordAiPerformancePrediction(input: {
  userId: string;
  symbol: string;
  entryPrice: number;
  outputs: AIProviderResult[];
}) {
  const now = new Date();
  const records = input.outputs
    .filter((row) => row.ok && row.output)
    .map((row) => {
      const meta = row.output?.metadata as Record<string, unknown> | undefined;
      const predictedPercent = Number(meta?.expectedMovePercent ?? 0);
      const predictedRange = meta?.expectedMoveRange as { min?: number; max?: number } | undefined;
      const horizonMinutesRaw = Number(meta?.timeHorizonMinutes ?? (row.output?.estimatedDurationSec ?? 180) / 60);
      const horizonMinutes = Math.max(5, Math.min(240, Math.round(horizonMinutesRaw)));
      const direction =
        row.output?.decision === "BUY" || row.output?.decision === "SELL" ? row.output.decision : "WAIT";
      const resolvedRange = resolvePredictedRange({
        predictedPercent,
        predictedRangeMin: predictedRange?.min ?? null,
        predictedRangeMax: predictedRange?.max ?? null,
      });
      return {
        userId: input.userId,
        aiName: row.providerName,
        symbol: input.symbol.toUpperCase(),
        predictedDirection: direction,
        predictedPercent: Number.isFinite(predictedPercent) ? predictedPercent : 0,
        predictedRangeMin: resolvedRange.min,
        predictedRangeMax: resolvedRange.max,
        confidenceScore: row.output?.confidence ?? 0,
        entryPrice: input.entryPrice,
        horizonMinutes,
        createdAt: now,
      };
    });
  if (records.length === 0) return;
  await Promise.all(
    records.map((record) =>
      addAiPerformanceMemory({
        userId: record.userId,
        aiName: record.aiName,
        symbol: record.symbol,
        predictedDirection: record.predictedDirection,
        predictedPercent: record.predictedPercent,
        predictedRangeMin: record.predictedRangeMin,
        predictedRangeMax: record.predictedRangeMax,
        confidenceScore: record.confidenceScore,
        entryPrice: record.entryPrice,
        horizonMinutes: record.horizonMinutes,
      }),
    ),
  );
}

export async function evaluateAiPerformanceMemory(userId: string) {
  try {
  const pending = await withTransientReadFallback("listPendingAiPerformance", [] as Awaited<ReturnType<typeof listPendingAiPerformance>>, () =>
    listPendingAiPerformance(userId),
  );
  if (pending.length === 0) return;
  const now = Date.now();
  for (const record of pending) {
    try {
    const dueAt = record.createdAt.getTime() + record.horizonMinutes * 60 * 1000;
    if (dueAt > now) continue;
    const price = await getSnapshotPrice(record.symbol, new Date(dueAt));
    if (!price || !Number.isFinite(price) || record.entryPrice <= 0) continue;
    const actualMove = ((price - record.entryPrice) / record.entryPrice) * 100;
    const resolvedRange = resolvePredictedRange({
      predictedPercent: record.predictedPercent,
      predictedRangeMin: record.predictedRangeMin,
      predictedRangeMax: record.predictedRangeMax,
    });
    const result = evaluatePrediction({
      direction: record.predictedDirection,
      predictedMin: resolvedRange.min,
      predictedMax: resolvedRange.max,
      actualMove,
    });
    const errorPercent = Math.abs(Math.abs(actualMove) - Math.abs(record.predictedPercent));
    await updateAiPerformanceMemory({
      id: record.id,
      actualMoveAfterTime: Number(actualMove.toFixed(4)),
      result,
      errorPercent: Number(errorPercent.toFixed(4)),
    });
    } catch (error) {
      if (!isTransientPrismaConnectivityError(error)) {
        logger.warn({ userId, recordId: record.id, error: (error as Error).message }, "AI performance row skipped");
      }
    }
  }
  } catch (error) {
    if (!isTransientPrismaConnectivityError(error)) {
      logger.error({ userId, error: (error as Error).message }, "AI performance evaluator failed");
    }
  }
}

export async function getAiProviderWeights(userId: string) {
  const cached = weightCache.get(userId);
  if (cached && Date.now() - cached.updatedAt < 5 * 60 * 1000) {
    return cached.weights;
  }
  const rows = await withTransientReadFallback("listRecentAiPerformance", [] as Awaited<ReturnType<typeof listRecentAiPerformance>>, () =>
    listRecentAiPerformance(userId, 180),
  );
  const now = Date.now();
  const halfLifeHours = 72;
  const shortWindowHours = 48;
  const longWindowHours = 24 * 14;

  function scoreResult(result: string | null) {
    if (result === "SUCCESS") return 1;
    if (result === "PARTIAL") return 0.5;
    return 0;
  }

  function weightedRate(windowHours: number) {
    const byAi = new Map<string, { weightSum: number; scoreSum: number }>();
    for (const row of rows) {
      const ageHours = (now - row.createdAt.getTime()) / 3600_000;
      if (ageHours > windowHours) continue;
      const weight = Math.exp(-ageHours / halfLifeHours);
      const cur = byAi.get(row.aiName) ?? { weightSum: 0, scoreSum: 0 };
      cur.weightSum += weight;
      cur.scoreSum += scoreResult(row.result) * weight;
      byAi.set(row.aiName, cur);
    }
    const rates = new Map<string, number>();
    for (const [name, stats] of byAi.entries()) {
      const rate = stats.weightSum > 0 ? stats.scoreSum / stats.weightSum : 0.5;
      rates.set(name, rate);
    }
    return rates;
  }

  const shortRates = weightedRate(shortWindowHours);
  const longRates = weightedRate(longWindowHours);
  const weights: Record<string, number> = {};
  const allAiNames = new Set([...shortRates.keys(), ...longRates.keys()]);
  for (const name of allAiNames) {
    const shortRate = shortRates.get(name);
    const longRate = longRates.get(name);
    const combined =
      shortRate !== undefined && longRate !== undefined
        ? shortRate * 0.6 + longRate * 0.4
        : shortRate ?? longRate ?? 0.5;
    weights[name] = Number(clamp(0.7, 0.9 + combined * 0.8, 1.3).toFixed(2));
  }
  weightCache.set(userId, { weights, updatedAt: Date.now() });
  return weights;
}

export async function applyAiPerformanceWeights(userId: string, outputs: AIProviderResult[]) {
  const weights: Record<string, number> = await getAiProviderWeights(userId).catch(() => ({}));
  for (const row of outputs) {
    const weight = weights[row.providerName];
    if (weight !== undefined) {
      row.weight = weight;
    }
  }
  return outputs;
}

export function ensureAiPerformanceEvaluator(userId: string) {
  if (evaluatorTimers.has(userId)) return;
  const timer = setInterval(() => {
    void evaluateAiPerformanceMemory(userId);
  }, 60_000);
  evaluatorTimers.set(userId, timer);
}
