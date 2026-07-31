import { analyzeEntryTiming, analyzeMultipleSymbols } from "@/src/server/entry-timing/entry-analysis.service";
import { processWaitReevaluations } from "@/src/server/entry-timing/wait-mode.service";
import { scoreEntryQuality } from "@/src/server/entry-timing/entry-quality.service";
import { replayRecentBuys, replayEntry } from "@/src/server/entry-timing/entry-replay.service";
import { learnEntryPatterns } from "@/src/server/entry-timing/entry-learning.service";
import { generateEntryHeatmap } from "@/src/server/entry-timing/entry-heatmap.service";
import { prisma } from "@/src/server/db/prisma";
import type { EntryTimingJobPayload } from "@/src/server/entry-timing/entry-timing.types";

export async function runEntryTimingJob(payload: EntryTimingJobPayload) {
  switch (payload.type) {
    case "ANALYZE_ENTRY":
      if (payload.symbol) return analyzeEntryTiming(payload.symbol, payload.price);
      return analyzeMultipleSymbols(8);
    case "CONFIRM_ENTRY":
    case "FILTER_CHECK": {
      if (!payload.analysisId) return { skipped: true };
      const analysis = await prisma.entryAnalysis.findUnique({ where: { id: payload.analysisId } });
      if (!analysis) return { skipped: true };
      return analyzeEntryTiming(analysis.symbol, analysis.priceAtAnalysis);
    }
    case "WAIT_REEVALUATE":
      return processWaitReevaluations();
    case "QUALITY_SCORE": {
      if (!payload.analysisId) return { skipped: true };
      const a = await prisma.entryAnalysis.findUnique({ where: { id: payload.analysisId } });
      if (!a) return { skipped: true };
      return scoreEntryQuality(a.id, a.symbol, {
        entryScore: a.entryScore, entryConfidence: a.entryConfidence, entryRisk: a.entryRisk,
        breakoutProbability: a.breakoutProbability, continuationProbability: a.continuationProbability,
        pullbackProbability: a.pullbackProbability, fakeBreakoutProbability: a.fakeBreakoutProbability,
        reversalProbability: a.reversalProbability,
      }, a.verdict);
    }
    case "REPLAY_ENTRY":
      if (payload.symbol && payload.limit === 1) {
        const a = await prisma.entryAnalysis.findFirst({ where: { symbol: payload.symbol.toUpperCase() }, orderBy: { analyzedAt: "desc" } });
        if (!a) return { skipped: true };
        return replayEntry({ symbol: a.symbol, entryPrice: a.priceAtAnalysis, entryAt: a.analyzedAt, analysisId: a.id });
      }
      return replayRecentBuys(payload.limit ?? 10);
    case "LEARN_PATTERNS":
      return learnEntryPatterns();
    case "HEATMAP_BUILD":
      return generateEntryHeatmap();
    case "RECOMMENDATION":
      if (payload.analysisId) {
        const a = await prisma.entryAnalysis.findUnique({ where: { id: payload.analysisId }, include: { qualities: true } });
        if (!a) return { skipped: true };
        const { publishEntryRecommendation } = await import("@/src/server/entry-timing/entry-recommendation.service");
        return publishEntryRecommendation(a, a.entryType ?? "MOMENTUM", {
          qualityScore: a.qualities[0]?.qualityScore ?? a.entryScore,
          expectedRr: a.qualities[0]?.expectedRr ?? 1.5,
          expectedSuccess: a.qualities[0]?.expectedSuccess ?? 50,
          expectedHoldMinutes: a.qualities[0]?.expectedHoldMinutes ?? 30,
          expectedVolatility: a.qualities[0]?.expectedVolatility ?? 30,
        }, { verdict: a.verdict, reasons: [] });
      }
      if (payload.symbol) return analyzeEntryTiming(payload.symbol);
      return { skipped: true };
    default:
      return { skipped: true };
  }
}
