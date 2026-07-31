import { prisma } from "@/src/server/db/prisma";
import { persistStrategySwitch } from "@/src/server/strategy-selector/strategy-selector.repository";
import { emitStrategySelectorEvent, STRATEGY_SELECTOR_EVENT } from "@/src/server/strategy-selector/strategy-selector.events";
import { scoreAllStrategies } from "@/src/server/strategy-selector/strategy-scoring.service";
import { detectMarketRegime } from "@/src/server/strategy-selector/regime-detection.service";
import { classifyCoin } from "@/src/server/strategy-selector/coin-classification.service";
import type { StrategySelectorType } from "@prisma/client";

export async function checkStrategySwitch(symbol: string) {
  const sym = symbol.toUpperCase();
  const openPosition = await prisma.position.findFirst({
    where: { status: "OPEN", tradingPair: { symbol: sym } },
  });

  const lastSelection = await prisma.adaptiveStrategySelection.findFirst({
    where: { symbol: sym },
    orderBy: { selectedAt: "desc" },
  });
  if (!lastSelection) return { switchNeeded: false };

  const regime = await detectMarketRegime(sym);
  const coinClass = await classifyCoin(sym);
  const rankings = await scoreAllStrategies(sym, regime, coinClass);
  const topStrategy = rankings[0]!.strategyType;

  if (topStrategy === lastSelection.primaryStrategy) {
    return { switchNeeded: false, currentStrategy: lastSelection.primaryStrategy };
  }

  const currentScore = rankings.find((r) => r.strategyType === lastSelection.primaryStrategy)?.totalScore ?? 0;
  const newScore = rankings[0]!.totalScore;
  if (newScore - currentScore < 15) {
    return { switchNeeded: false, currentStrategy: lastSelection.primaryStrategy, delta: newScore - currentScore };
  }

  const positionOpen = Boolean(openPosition);
  const reason = positionOpen
    ? `Strategy ${lastSelection.primaryStrategy} weakening but position open — defer switch until next entry`
    : `Regime shift favors ${topStrategy} over ${lastSelection.primaryStrategy}`;

  const switchRecord = await persistStrategySwitch({
    symbol: sym,
    fromStrategy: lastSelection.primaryStrategy,
    toStrategy: topStrategy,
    reason,
    positionOpen,
  });

  if (!positionOpen) {
    emitStrategySelectorEvent(STRATEGY_SELECTOR_EVENT.STRATEGY_SWITCH_RECOMMENDED, {
      switchKey: switchRecord.switchKey,
      from: lastSelection.primaryStrategy,
      to: topStrategy,
    });
  }

  return { switchNeeded: !positionOpen, switchRecord, positionOpen, from: lastSelection.primaryStrategy, to: topStrategy };
}

export async function scanStrategySwitches(limit = 10) {
  const snapshots = await prisma.marketSnapshot.findMany({ orderBy: { snapshotAt: "desc" }, take: limit, select: { symbol: true } });
  const symbols = [...new Set(snapshots.map((s) => s.symbol).filter(Boolean) as string[])];
  const results = [];
  for (const symbol of symbols) {
    try {
      results.push(await checkStrategySwitch(symbol));
    } catch { /* skip */ }
  }
  return { checked: results.length, results };
}
