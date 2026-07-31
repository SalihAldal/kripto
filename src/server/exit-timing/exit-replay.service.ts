import { buildPricePath } from "@/src/server/replay/price-path.service";
import { prisma } from "@/src/server/db/prisma";
import { persistExitReplay } from "@/src/server/exit-timing/exit-timing.repository";
import { emitExitTimingEvent, EXIT_TIMING_EVENT } from "@/src/server/exit-timing/exit-timing.events";

export async function replayExit(input: {
  symbol: string;
  exitPrice: number;
  exitAt: Date;
  entryPrice: number;
  analysisId?: string;
}) {
  const pricePath = await buildPricePath({
    symbol: input.symbol,
    decisionTime: input.exitAt,
    fallbackPrice: input.exitPrice,
  });

  const candles = pricePath.candles.filter((c) => c.openTime >= input.exitAt.getTime());
  let bestPossiblePrice = input.exitPrice;
  let bestPossibleAt = input.exitAt;

  if (candles.length > 0) {
    for (const c of candles) {
      if (c.high > bestPossiblePrice) {
        bestPossiblePrice = c.high;
        bestPossibleAt = new Date(c.openTime);
      }
    }
  }

  const actualProfitPct = ((input.exitPrice - input.entryPrice) / input.entryPrice) * 100;
  const bestPossibleProfitPct = ((bestPossiblePrice - input.entryPrice) / input.entryPrice) * 100;
  const profitDifferencePct = bestPossibleProfitPct - actualProfitPct;
  const lostProfitPct = Math.max(0, profitDifferencePct);
  const savedLossPct = actualProfitPct < 0 && bestPossibleProfitPct < actualProfitPct
    ? Math.abs(bestPossibleProfitPct - actualProfitPct)
    : 0;

  const tolerance = input.exitPrice * 0.002;
  const wasOptimal = Math.abs(input.exitPrice - bestPossiblePrice) <= tolerance;
  const couldExitEarlier = bestPossiblePrice > input.exitPrice + tolerance;
  const couldExitLater = bestPossiblePrice < input.exitPrice - tolerance;

  let replayVerdict = "NEUTRAL";
  if (wasOptimal) replayVerdict = "OPTIMAL";
  else if (couldExitEarlier) replayVerdict = "TOO_EARLY";
  else if (couldExitLater) replayVerdict = "TOO_LATE";

  const replay = await persistExitReplay({
    analysisId: input.analysisId,
    symbol: input.symbol.toUpperCase(),
    exitPrice: input.exitPrice,
    exitAt: input.exitAt,
    bestPossiblePrice,
    bestPossibleAt,
    actualProfitPct: Number(actualProfitPct.toFixed(4)),
    bestPossibleProfitPct: Number(bestPossibleProfitPct.toFixed(4)),
    profitDifferencePct: Number(profitDifferencePct.toFixed(4)),
    lostProfitPct: Number(lostProfitPct.toFixed(4)),
    savedLossPct: Number(savedLossPct.toFixed(4)),
    wasOptimal,
    couldExitEarlier,
    couldExitLater,
    replayVerdict,
    replayPayload: { candleCount: candles.length },
  });

  emitExitTimingEvent(EXIT_TIMING_EVENT.REPLAY_COMPLETED, { replayKey: replay.replayKey, wasOptimal });
  return replay;
}

export async function replayRecentExits(limit = 10) {
  const closed = await prisma.position.findMany({
    where: { status: "CLOSED", side: "LONG" },
    orderBy: { closedAt: "desc" },
    take: limit,
    include: { tradingPair: { select: { symbol: true } } },
  }).catch(() => []);

  const replays = [];
  for (const pos of closed) {
    const symbol = pos.tradingPair?.symbol ?? "";
    if (!symbol || !pos.closePrice || !pos.closedAt) continue;
    const analysis = await prisma.exitAnalysis.findFirst({
      where: { positionId: pos.id },
      orderBy: { analyzedAt: "desc" },
    });
    replays.push(await replayExit({
      symbol,
      exitPrice: pos.closePrice,
      exitAt: pos.closedAt,
      entryPrice: pos.entryPrice,
      analysisId: analysis?.id,
    }));
  }
  return { replayed: replays.length, replays };
}
