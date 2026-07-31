import { prisma } from "@/src/server/db/prisma";
import { persistExitLearning } from "@/src/server/exit-timing/exit-timing.repository";
import { emitExitTimingEvent, EXIT_TIMING_EVENT } from "@/src/server/exit-timing/exit-timing.events";
import type { SpotExitType } from "@prisma/client";

export async function learnExitPatterns() {
  const analyses = await prisma.exitAnalysis.findMany({
    orderBy: { analyzedAt: "desc" },
    take: 200,
    include: { replays: true, qualities: true },
  });

  const buckets = new Map<string, {
    exitType: SpotExitType;
    hourOfDay: number;
    regime: string;
    structure: string;
    count: number;
    successSum: number;
    profitSum: number;
    qualitySum: number;
  }>();

  for (const a of analyses) {
    if (!a.exitType) continue;
    const hour = a.analyzedAt.getUTCHours();
    const regime = a.regimeScore && a.regimeScore > 60 ? "TREND" : "RANGE";
    const structure = a.verdict === "SELL" ? "EXIT" : "HOLD";
    const key = `${a.exitType}_${hour}_${regime}_${structure}`;

    const replay = a.replays[0];
    const quality = a.qualities[0];
    const success = replay?.wasOptimal ? 100 : replay?.replayVerdict === "TOO_EARLY" ? 30 : 60;
    const profit = replay?.actualProfitPct ?? a.currentProfitPct;
    const qScore = quality?.qualityScore ?? a.exitScore;

    const bucket = buckets.get(key) ?? {
      exitType: a.exitType, hourOfDay: hour, regime, structure,
      count: 0, successSum: 0, profitSum: 0, qualitySum: 0,
    };
    bucket.count += 1;
    bucket.successSum += success;
    bucket.profitSum += profit;
    bucket.qualitySum += qScore;
    buckets.set(key, bucket);
  }

  const learnings = [];
  for (const bucket of buckets.values()) {
    if (bucket.count < 2) continue;
    const record = await persistExitLearning({
      exitType: bucket.exitType,
      hourOfDay: bucket.hourOfDay,
      regime: bucket.regime,
      structure: bucket.structure,
      occurrenceCount: bucket.count,
      successRate: bucket.successSum / bucket.count,
      avgProfitPct: bucket.profitSum / bucket.count,
      avgQualityScore: bucket.qualitySum / bucket.count,
      isWorst: bucket.qualitySum / bucket.count < 40,
    });
    learnings.push(record);
    emitExitTimingEvent(EXIT_TIMING_EVENT.LEARNING_UPDATED, { learningKey: record.learningKey });
  }

  return { learned: learnings.length, learnings };
}

export async function getBestAndWorstExits() {
  const [best, worst] = await Promise.all([
    prisma.exitLearning.findMany({ where: { isWorst: false }, orderBy: { successRate: "desc" }, take: 10 }),
    prisma.exitLearning.findMany({ where: { isWorst: true }, orderBy: { avgQualityScore: "asc" }, take: 10 }),
  ]);
  return { best, worst };
}
