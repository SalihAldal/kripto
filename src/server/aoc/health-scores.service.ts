import { prisma } from "@/src/server/db/prisma";
import { persistHealthScore } from "@/src/server/aoc/aoc.repository";
import { emitAocEvent, AOC_EVENT } from "@/src/server/aoc/aoc.events";
import { monitorQueues } from "@/src/server/aoc/queue-monitor.service";

export async function calculateHealthScores() {
  const [platform, infrastructure, trading, exchange, aiHealth, queueInfo] = await Promise.all([
    prisma.platformHealth.findFirst({ orderBy: { recordedAt: "desc" } }),
    prisma.infrastructureHealth.findFirst({ orderBy: { recordedAt: "desc" } }),
    prisma.tradingHealth.findFirst({ orderBy: { recordedAt: "desc" } }),
    prisma.exchangeHealthHistory.findFirst({ orderBy: { recordedAt: "desc" } }),
    prisma.aocAiHealth.findFirst({ orderBy: { recordedAt: "desc" } }),
    monitorQueues(),
  ]);

  const infrastructureScore = infrastructure?.overallScore ?? 80;
  const tradingScore = trading?.overallScore ?? 80;
  const aiScore = aiHealth?.overallScore ?? 80;
  const exchangeScore = exchange?.overallScore ?? 80;
  const databaseScore = platform?.databaseScore ?? 80;
  const queueScore = queueInfo.queueScore;

  const platformScore = Number(
    (
      infrastructureScore * 0.2 +
      tradingScore * 0.25 +
      aiScore * 0.15 +
      exchangeScore * 0.2 +
      databaseScore * 0.1 +
      queueScore * 0.1
    ).toFixed(1),
  );

  const score = await persistHealthScore({
    infrastructureScore,
    tradingScore,
    aiScore,
    exchangeScore,
    databaseScore,
    queueScore,
    platformScore,
  });

  emitAocEvent(AOC_EVENT.SCORES_CALCULATED, { scoreKey: score.scoreKey, platformScore });
  return score;
}
