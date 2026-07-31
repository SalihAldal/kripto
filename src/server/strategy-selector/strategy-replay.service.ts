import { prisma } from "@/src/server/db/prisma";
import { buildPricePath } from "@/src/server/replay/price-path.service";
import { persistStrategyReplay } from "@/src/server/strategy-selector/strategy-selector.repository";
import { getAllStrategyProfiles } from "@/src/server/strategy-selector/strategy-library.service";
import { emitStrategySelectorEvent, STRATEGY_SELECTOR_EVENT } from "@/src/server/strategy-selector/strategy-selector.events";
import type { StrategySelectorType } from "@prisma/client";

export async function replayStrategySelection(selectionId: string) {
  const selection = await prisma.adaptiveStrategySelection.findUnique({ where: { id: selectionId } });
  if (!selection) throw new Error("Selection not found");

  const position = await prisma.position.findFirst({
    where: { tradingPair: { symbol: selection.symbol }, openedAt: { lte: selection.selectedAt } },
    orderBy: { openedAt: "desc" },
  });

  const entryPrice = position?.entryPrice ?? 0;
  const entryAt = position?.openedAt ?? selection.selectedAt;
  if (entryPrice <= 0) throw new Error("No entry price for replay");

  const pricePath = await buildPricePath({ symbol: selection.symbol, decisionTime: entryAt, fallbackPrice: entryPrice });
  const candles = pricePath.candles.filter((c) => c.openTime >= selection.selectedAt.getTime());

  let bestProfit = ((selection.selectedAt.getTime() > 0 ? entryPrice : entryPrice) - entryPrice) / entryPrice * 100;
  let bestStrategy: StrategySelectorType = selection.primaryStrategy;

  for (const profile of getAllStrategyProfiles()) {
    const holdMinutes = profile.strategyType === "SCALP" ? 30 : profile.strategyType === "SWING" ? 1440 : 120;
    const endMs = selection.selectedAt.getTime() + holdMinutes * 60_000;
    const window = candles.filter((c) => c.openTime <= endMs);
    const exitPrice = window.at(-1)?.close ?? entryPrice;
    const profit = ((exitPrice - entryPrice) / entryPrice) * 100;
    if (profit > bestProfit) {
      bestProfit = profit;
      bestStrategy = profile.strategyType;
    }
  }

  const actualExit = position?.closePrice ?? candles.at(-1)?.close ?? entryPrice;
  const actualProfit = ((actualExit - entryPrice) / entryPrice) * 100;
  const wasBestStrategy = bestStrategy === selection.primaryStrategy;
  const additionalProfitPct = bestProfit - actualProfit;

  const replay = await persistStrategyReplay({
    selectionId,
    symbol: selection.symbol,
    selectedStrategy: selection.primaryStrategy,
    alternativeStrategy: wasBestStrategy ? selection.secondaryStrategy : bestStrategy,
    wasBestStrategy,
    additionalProfitPct: Number(additionalProfitPct.toFixed(4)),
    replayVerdict: wasBestStrategy ? "OPTIMAL" : "SUBOPTIMAL",
    replayPayload: { actualProfit, bestProfit, bestStrategy },
  });

  emitStrategySelectorEvent(STRATEGY_SELECTOR_EVENT.REPLAY_COMPLETED, { replayKey: replay.replayKey, wasBestStrategy });
  return replay;
}

export async function replayRecentSelections(limit = 10) {
  const selections = await prisma.adaptiveStrategySelection.findMany({ orderBy: { selectedAt: "desc" }, take: limit });
  const replays = [];
  for (const sel of selections) {
    try {
      replays.push(await replayStrategySelection(sel.id));
    } catch { /* skip */ }
  }
  return { replayed: replays.length, replays };
}
