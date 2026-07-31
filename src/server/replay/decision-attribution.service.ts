import type { Prisma } from "@prisma/client";
import type { ReplayMetrics } from "@/src/server/replay/replay.types";

export type AttributionFactor = {
  factorType: string;
  factorName: string;
  contributionWeight: number;
  impactDirection: "positive" | "negative" | "neutral";
  description: string;
};

export function buildDecisionAttribution(input: {
  decisionId: string;
  verdict: string;
  rejectReasons: Array<{ reason: string; category: string; weight: number; rank?: number | null }>;
  featureSnapshot?: Record<string, unknown> | null;
  scores?: Record<string, number | null | undefined>;
  metadata?: Record<string, unknown> | null;
  metrics: ReplayMetrics;
}): AttributionFactor[] {
  const factors: AttributionFactor[] = [];
  const wrongVerdicts = new Set([
    "WRONG",
    "MISSED_WINNER",
    "MISSED_BREAKOUT",
    "MISSED_PUMP",
    "FALSE_BUY",
    "FALSE_SELL",
    "EARLY_ENTRY",
    "LATE_ENTRY",
  ]);
  const isWrong = wrongVerdicts.has(input.verdict);

  for (const reason of input.rejectReasons) {
    factors.push({
      factorType: "filter",
      factorName: reason.category,
      contributionWeight: reason.weight,
      impactDirection: isWrong ? "negative" : "positive",
      description: reason.reason,
    });
  }

  const scoreEntries: Array<[string, number | null | undefined]> = [
    ["liquidityScore", input.scores?.liquidityScore],
    ["momentumScore", input.scores?.momentumScore],
    ["volumeScore", input.scores?.volumeScore],
    ["trendScore", input.scores?.trendScore],
    ["regimeScore", input.scores?.regimeScore],
    ["riskScore", input.scores?.riskScore],
    ["newsScore", input.scores?.newsScore],
    ["confidence", input.scores?.confidence],
    ["scannerScore", input.scores?.scannerScore],
  ];

  for (const [name, value] of scoreEntries) {
    if (value == null || !Number.isFinite(value)) continue;
    factors.push({
      factorType: "score",
      factorName: name,
      contributionWeight: Number((value / 100).toFixed(4)),
      impactDirection: value >= 70 ? "positive" : value <= 40 ? "negative" : "neutral",
      description: `${name}=${value.toFixed(2)} at decision time`,
    });
  }

  const features = input.featureSnapshot ?? {};
  for (const [bucket, payload] of Object.entries(features)) {
    if (!payload || typeof payload !== "object") continue;
    factors.push({
      factorType: "feature",
      factorName: bucket,
      contributionWeight: 0.35,
      impactDirection: isWrong ? "negative" : "neutral",
      description: `Feature bucket ${bucket} captured at decision`,
    });
  }

  const roleScores = Array.isArray((input.metadata as Record<string, unknown> | null)?.roleScores)
    ? ((input.metadata as Record<string, unknown>).roleScores as Array<{ role?: string; score?: number }>)
    : [];
  for (const row of roleScores) {
    if (!row.role) continue;
    factors.push({
      factorType: "model",
      factorName: row.role,
      contributionWeight: Number(((row.score ?? 0) / 100).toFixed(4)),
      impactDirection: (row.score ?? 0) >= 65 ? "positive" : "negative",
      description: `Model ${row.role} score=${row.score ?? 0}`,
    });
  }

  if (input.metrics.peakProfitPct >= 5 && isWrong) {
    factors.push({
      factorType: "outcome",
      factorName: "missed_move",
      contributionWeight: Math.min(1, input.metrics.peakProfitPct / 100),
      impactDirection: "negative",
      description: `Missed +${input.metrics.peakProfitPct.toFixed(2)}% move after rejection`,
    });
  }

  return factors
    .sort((a, b) => b.contributionWeight - a.contributionWeight)
    .slice(0, 15)
    .map((factor, index) => ({ ...factor, rank: index + 1 }));
}

export function toAttributionRows(
  replayId: string,
  decisionId: string,
  factors: Array<AttributionFactor & { rank?: number }>,
): Prisma.DecisionAttributionCreateManyInput[] {
  return factors.map((factor) => ({
    replayId,
    decisionId,
    factorType: factor.factorType,
    factorName: factor.factorName,
    contributionWeight: factor.contributionWeight,
    rank: factor.rank ?? null,
    impactDirection: factor.impactDirection,
    description: factor.description,
  }));
}
