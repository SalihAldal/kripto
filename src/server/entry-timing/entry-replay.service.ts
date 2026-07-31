import { prisma } from "@/src/server/db/prisma";
import { buildPricePath } from "@/src/server/replay/price-path.service";
import { persistEntryReplay } from "@/src/server/entry-timing/entry-timing.repository";
import { emitEntryTimingEvent, ENTRY_TIMING_EVENT } from "@/src/server/entry-timing/entry-timing.events";

export async function replayEntry(input: {
  symbol: string;
  entryPrice: number;
  entryAt: Date;
  analysisId?: string;
}) {
  const pricePath = await buildPricePath({
    symbol: input.symbol,
    decisionTime: input.entryAt,
    fallbackPrice: input.entryPrice,
  });

  const candles = pricePath.candles.filter((c) => c.openTime >= input.entryAt.getTime());
  let optimalPrice = input.entryPrice;
  let optimalAt = input.entryAt;
  let mfePct = 0;
  let maePct = 0;

  if (candles.length > 0) {
    let lowest = input.entryPrice;
    let highest = input.entryPrice;
    for (const c of candles) {
      if (c.low < lowest) {
        lowest = c.low;
        optimalPrice = c.low;
        optimalAt = new Date(c.openTime);
      }
      highest = Math.max(highest, c.high);
    }
    mfePct = ((highest - input.entryPrice) / input.entryPrice) * 100;
    maePct = ((lowest - input.entryPrice) / input.entryPrice) * 100;
  }

  const endPrice = candles.at(-1)?.close ?? input.entryPrice;
  const actualProfitPct = ((endPrice - input.entryPrice) / input.entryPrice) * 100;
  const optimalProfitPct = ((endPrice - optimalPrice) / optimalPrice) * 100;
  const profitDifferencePct = optimalProfitPct - actualProfitPct;

  const priceTolerance = input.entryPrice * 0.002;
  const wasOptimal = Math.abs(input.entryPrice - optimalPrice) <= priceTolerance;
  const couldEnterEarlier = optimalPrice < input.entryPrice - priceTolerance;
  const couldEnterLater = optimalPrice > input.entryPrice + priceTolerance;

  let replayVerdict = "NEUTRAL";
  if (wasOptimal) replayVerdict = "OPTIMAL";
  else if (couldEnterEarlier) replayVerdict = "TOO_LATE";
  else if (couldEnterLater) replayVerdict = "TOO_EARLY";
  else if (actualProfitPct < -0.5) replayVerdict = "POOR";

  const replay = await persistEntryReplay({
    analysisId: input.analysisId,
    symbol: input.symbol.toUpperCase(),
    entryPrice: input.entryPrice,
    entryAt: input.entryAt,
    optimalPrice,
    optimalAt,
    wasOptimal,
    couldEnterEarlier,
    couldEnterLater,
    profitDifferencePct: Number(profitDifferencePct.toFixed(4)),
    mfePct: Number(mfePct.toFixed(4)),
    maePct: Number(maePct.toFixed(4)),
    replayVerdict,
    replayPayload: { actualProfitPct, optimalProfitPct, candleCount: candles.length },
  });

  emitEntryTimingEvent(ENTRY_TIMING_EVENT.REPLAY_COMPLETED, { replayKey: replay.replayKey, wasOptimal });
  return replay;
}

export async function replayRecentBuys(limit = 10) {
  const positions = await prisma.position.findMany({
    where: { side: "LONG" },
    orderBy: { openedAt: "desc" },
    take: limit,
    include: { tradingPair: { select: { symbol: true } } },
  }).catch(() => []);

  const decisions = await prisma.decisionLog.findMany({
    where: { decision: { in: ["BUY", "EXECUTE", "LONG"] } },
    orderBy: { createdAt: "desc" },
    take: limit,
  }).catch(() => []);

  const replays = [];

  for (const pos of positions) {
    const symbol = pos.tradingPair?.symbol ?? "";
    if (!symbol) continue;
    replays.push(await replayEntry({ symbol, entryPrice: pos.entryPrice, entryAt: pos.openedAt }));
  }

  for (const dec of decisions) {
    if (replays.length >= limit) break;
    const analysis = await prisma.entryAnalysis.findFirst({
      where: { symbol: dec.symbol.toUpperCase() },
      orderBy: { analyzedAt: "desc" },
    });
    const price = analysis?.priceAtAnalysis ?? 0;
    if (price <= 0) continue;
    replays.push(await replayEntry({
      symbol: dec.symbol,
      entryPrice: price,
      entryAt: dec.createdAt,
      analysisId: analysis?.id,
    }));
  }

  return { replayed: replays.length, replays };
}
