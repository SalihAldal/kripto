import { analyzeExitTiming, scanAllOpenPositions } from "@/src/server/exit-timing/exit-analysis.service";
import { computeProfitProtection } from "@/src/server/exit-timing/profit-protection.service";
import { collectExitContext, discoverOpenPositions } from "@/src/server/exit-timing/exit-context.service";
import { processHoldReevaluations } from "@/src/server/exit-timing/hold-mode.service";
import { scoreExitQuality } from "@/src/server/exit-timing/exit-quality.service";
import { replayRecentExits, replayExit } from "@/src/server/exit-timing/exit-replay.service";
import { learnExitPatterns } from "@/src/server/exit-timing/exit-learning.service";
import { publishExitRecommendation } from "@/src/server/exit-timing/exit-recommendation.service";
import { prisma } from "@/src/server/db/prisma";
import type { ExitTimingJobPayload } from "@/src/server/exit-timing/exit-timing.types";

export async function runExitTimingJob(payload: ExitTimingJobPayload) {
  switch (payload.type) {
    case "ANALYZE_EXIT":
      if (payload.positionId || payload.symbol) return analyzeExitTiming(payload);
      return scanAllOpenPositions();
    case "POSITION_SCAN":
      return scanAllOpenPositions();
    case "PROFIT_PROTECTION": {
      const positions = await discoverOpenPositions(10);
      const pos = payload.positionId
        ? positions.find((p) => p.id === payload.positionId) ?? positions[0]
        : positions[0];
      if (!pos) return { skipped: true };
      const ctx = await collectExitContext(pos);
      if (!ctx) return { skipped: true };
      return computeProfitProtection(ctx);
    }
    case "EXIT_SCORE":
    case "EXIT_QUALITY": {
      if (!payload.analysisId) return { skipped: true };
      const a = await prisma.exitAnalysis.findUnique({ where: { id: payload.analysisId } });
      if (!a) return { skipped: true };
      return scoreExitQuality(a.id, a.symbol, {
        exitScore: a.exitScore, exitConfidence: a.exitConfidence,
        expectedRemainingUpside: a.expectedRemainingUpside, expectedDownside: a.expectedDownside,
        riskScore: a.riskScore, continuationProbability: a.continuationProbability,
        reversalProbability: a.reversalProbability,
      }, a.verdict, 0);
    }
    case "HOLD_REEVALUATE":
      return processHoldReevaluations();
    case "REPLAY_EXIT":
      if (payload.symbol) {
        const closed = await prisma.position.findFirst({
          where: { tradingPair: { symbol: payload.symbol.toUpperCase() }, status: "CLOSED" },
          orderBy: { closedAt: "desc" },
          include: { tradingPair: { select: { symbol: true } } },
        });
        if (!closed?.closePrice || !closed.closedAt) return { skipped: true };
        return replayExit({
          symbol: payload.symbol.toUpperCase(),
          exitPrice: closed.closePrice,
          exitAt: closed.closedAt,
          entryPrice: closed.entryPrice,
        });
      }
      return replayRecentExits(payload.limit ?? 10);
    case "LEARN_EXITS":
      return learnExitPatterns();
    case "RECOMMENDATION": {
      if (!payload.analysisId) return { skipped: true };
      const a = await prisma.exitAnalysis.findUnique({ where: { id: payload.analysisId } });
      if (!a || !a.exitType) return { skipped: true };
      return publishExitRecommendation(a, a.exitType, { verdict: a.verdict, reasons: [] });
    }
    default:
      return { skipped: true };
  }
}
