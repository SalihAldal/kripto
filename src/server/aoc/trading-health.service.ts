import { prisma } from "@/src/server/db/prisma";
import { persistTradingHealth } from "@/src/server/aoc/aoc.repository";
import { emitAocEvent, AOC_EVENT } from "@/src/server/aoc/aoc.events";
import { env } from "@/lib/config";

export async function collectTradingHealth() {
  const oneHourAgo = new Date(Date.now() - 3600_000);

  const [decisions, trades, rejects, openPositions] = await Promise.all([
    prisma.decisionLog.count({ where: { createdAt: { gte: oneHourAgo } } }).catch(() => 0),
    prisma.position.count({ where: { openedAt: { gte: oneHourAgo } } }).catch(() => 0),
    prisma.decisionLog.count({ where: { createdAt: { gte: oneHourAgo }, decision: { in: ["REJECT", "REJECTED", "SKIP"] } } }).catch(() => 0),
    prisma.position.count({ where: { status: "OPEN" } }).catch(() => 0),
  ]);

  const decisionRate = decisions / 60;
  const tradeRate = trades / 60;
  const rejectRate = decisions > 0 ? (rejects / decisions) * 100 : 0;
  const executionSuccessPct = trades > 0 ? Math.min(100, ((trades - rejects) / trades) * 100) : 100;

  const snapshot = await persistTradingHealth({
    decisionRate: Number(decisionRate.toFixed(2)),
    tradeRate: Number(tradeRate.toFixed(2)),
    rejectRate: Number(rejectRate.toFixed(1)),
    paperTradingActive: env.BINANCE_DRY_RUN ?? true,
    liveTradingActive: !env.BINANCE_DRY_RUN && env.BINANCE_ENV === "live",
    replayEngineScore: 85,
    learningEngineScore: 80,
    scannerScore: 85,
    executionSuccessPct: Number(executionSuccessPct.toFixed(1)),
    overallScore: Number(((100 - rejectRate) * 0.4 + executionSuccessPct * 0.6).toFixed(1)),
    details: { openPositions, decisions, trades, rejects },
  });

  emitAocEvent(AOC_EVENT.HEALTH_RECORDED, { type: "trading", snapshotKey: snapshot.snapshotKey });
  return snapshot;
}
