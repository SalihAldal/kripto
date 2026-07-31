import { getTimelineEntry } from "@/src/server/intelligence-fusion/intelligence-fusion.repository";
import { compareTimelineEntries } from "@/src/server/intelligence-fusion/fusion-timeline.service";
import { prisma } from "@/src/server/db/prisma";
import type { CanonicalScores } from "@/src/server/intelligence-fusion/intelligence-fusion.types";

export async function replayFusionTimeline(timelineKey?: string, limit = 10) {
  if (timelineKey) {
    const entry = await getTimelineEntry(timelineKey);
    if (!entry) return { replayed: false, reason: "Timeline entry not found" };
    return {
      replayed: true,
      timelineKey,
      scores: entry.scores as unknown as CanonicalScores,
      snapshotAt: entry.snapshotAt,
      context: entry.intelligence?.fusion?.marketContext,
      intelligence: entry.intelligence,
    };
  }

  const entries = await prisma.fusionTimeline.findMany({
    where: { replayable: true },
    orderBy: { snapshotAt: "desc" },
    take: limit,
    include: { intelligence: { include: { fusion: { include: { marketContext: true } } } } },
  });

  return { replayed: true, entries, count: entries.length };
}

export async function replayAndCompare(limit = 5) {
  const entries = await prisma.fusionTimeline.findMany({
    where: { replayable: true },
    orderBy: { snapshotAt: "desc" },
    take: limit,
  });

  if (entries.length < 2) return { comparable: false, entries };

  const comparison = await compareTimelineEntries(entries[1].timelineKey, entries[0].timelineKey);
  return { comparable: true, comparison, entries };
}
