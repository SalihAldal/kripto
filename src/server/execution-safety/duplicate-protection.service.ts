import { prisma } from "@/src/server/db/prisma";
import { DUPLICATE_WINDOW_MS } from "@/src/server/execution-safety/execution-safety.types";
import type { PreTradeSafetyInput, SafetyValidationStageResult } from "@/src/server/execution-safety/execution-safety.types";

const recentKeys = new Map<string, number>();

function dedupeKey(input: PreTradeSafetyInput) {
  return `${input.userId}:${input.symbol.toUpperCase()}:${input.side}:${input.executionId}`;
}

export async function validateDuplicateSafety(input: PreTradeSafetyInput): Promise<SafetyValidationStageResult> {
  const reasons: string[] = [];
  const key = dedupeKey(input);
  const now = Date.now();

  for (const [existingKey, ts] of recentKeys.entries()) {
    if (now - ts > DUPLICATE_WINDOW_MS) recentKeys.delete(existingKey);
  }

  const priorTs = recentKeys.get(key);
  if (priorTs && now - priorTs < DUPLICATE_WINDOW_MS) {
    reasons.push("Duplicate execution UUID detected");
  }

  const sideKey = `${input.userId}:${input.symbol.toUpperCase()}:${input.side}`;
  for (const [existingKey, ts] of recentKeys.entries()) {
    if (!existingKey.startsWith(sideKey) || existingKey === key) continue;
    if (now - ts < DUPLICATE_WINDOW_MS) {
      reasons.push(`Duplicate ${input.side} order within protection window`);
      break;
    }
  }

  const since = new Date(now - DUPLICATE_WINDOW_MS);
  const recentOrders = await prisma.tradeOrder.findMany({
    where: {
      userId: input.userId,
      side: input.side,
      createdAt: { gte: since },
      tradingPair: { symbol: input.symbol.toUpperCase() },
      status: { in: ["NEW", "PARTIALLY_FILLED", "FILLED"] },
    },
    take: 5,
    orderBy: { createdAt: "desc" },
  });
  if (recentOrders.length >= 2) {
    reasons.push("Repeated retries detected");
  }

  if (reasons.length === 0) {
    recentKeys.set(key, now);
  }

  return {
    stage: "DUPLICATE",
    passed: reasons.length === 0,
    reasons,
    metadata: { windowMs: DUPLICATE_WINDOW_MS, recentOrderCount: recentOrders.length },
  };
}

export function clearDuplicateCache(userId?: string) {
  if (!userId) {
    recentKeys.clear();
    return;
  }
  for (const key of recentKeys.keys()) {
    if (key.startsWith(`${userId}:`)) recentKeys.delete(key);
  }
}
