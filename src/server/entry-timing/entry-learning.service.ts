import { prisma } from "@/src/server/db/prisma";
import { upsertEntryPattern } from "@/src/server/entry-timing/entry-timing.repository";
import { emitEntryTimingEvent, ENTRY_TIMING_EVENT } from "@/src/server/entry-timing/entry-timing.events";
import type { SpotEntryType } from "@prisma/client";

export async function learnEntryPatterns() {
  const analyses = await prisma.entryAnalysis.findMany({
    orderBy: { analyzedAt: "desc" },
    take: 200,
    include: { replays: true, qualities: true },
  });

  const buckets = new Map<string, {
    patternType: SpotEntryType;
    hourOfDay: number;
    regime: string;
    structure: string;
    count: number;
    successSum: number;
    profitSum: number;
    qualitySum: number;
  }>();

  for (const a of analyses) {
    if (!a.entryType) continue;
    const hour = a.analyzedAt.getUTCHours();
    const regime = a.regimeScore && a.regimeScore > 60 ? "TREND" : "RANGE";
    const structure = String((a.microStructure as Record<string, unknown> | null)?.microTrend ?? "NEUTRAL");
    const key = `${a.entryType}_${hour}_${regime}_${structure}`;

    const replay = a.replays[0];
    const quality = a.qualities[0];
    const success = replay?.wasOptimal ? 100 : replay?.replayVerdict === "POOR" ? 0 : 50;
    const profit = replay?.profitDifferencePct != null ? Math.max(0, 100 - Math.abs(replay.profitDifferencePct) * 10) : 50;
    const qScore = quality?.qualityScore ?? a.entryScore;

    const bucket = buckets.get(key) ?? {
      patternType: a.entryType, hourOfDay: hour, regime, structure,
      count: 0, successSum: 0, profitSum: 0, qualitySum: 0,
    };
    bucket.count += 1;
    bucket.successSum += success;
    bucket.profitSum += profit;
    bucket.qualitySum += qScore;
    buckets.set(key, bucket);
  }

  const patterns = [];
  for (const bucket of buckets.values()) {
    if (bucket.count < 2) continue;
    const pattern = await upsertEntryPattern({
      patternType: bucket.patternType,
      hourOfDay: bucket.hourOfDay,
      regime: bucket.regime,
      structure: bucket.structure,
      successRate: bucket.successSum / bucket.count,
      avgProfitPct: bucket.profitSum / bucket.count,
      avgQualityScore: bucket.qualitySum / bucket.count,
      isWorst: bucket.qualitySum / bucket.count < 40,
    });
    patterns.push(pattern);
    emitEntryTimingEvent(ENTRY_TIMING_EVENT.PATTERN_LEARNED, { patternKey: pattern.patternKey });
  }

  return { learned: patterns.length, patterns };
}

export async function getBestAndWorstPatterns() {
  const [best, worst] = await Promise.all([
    prisma.entryPattern.findMany({ where: { isWorst: false }, orderBy: { successRate: "desc" }, take: 10 }),
    prisma.entryPattern.findMany({ where: { isWorst: true }, orderBy: { avgQualityScore: "asc" }, take: 10 }),
  ]);
  return { best, worst };
}
