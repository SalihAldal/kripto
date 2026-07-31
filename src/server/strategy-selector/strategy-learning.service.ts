import { prisma } from "@/src/server/db/prisma";
import { persistStrategyKnowledge, persistStrategyPerformance } from "@/src/server/strategy-selector/strategy-selector.repository";
import { emitStrategySelectorEvent, STRATEGY_SELECTOR_EVENT } from "@/src/server/strategy-selector/strategy-selector.events";
import type { AdaptiveRegimeLabel, StrategySelectorType } from "@prisma/client";

export async function learnStrategyPerformance() {
  const selections = await prisma.adaptiveStrategySelection.findMany({
    orderBy: { selectedAt: "desc" },
    take: 200,
    include: { replays: true, regime: true },
  });

  const buckets = new Map<string, {
    strategyType: StrategySelectorType;
    regimeLabel?: AdaptiveRegimeLabel;
    wins: number;
    total: number;
    profitSum: number;
    qualitySum: number;
    winningMarkets: Set<AdaptiveRegimeLabel>;
    losingMarkets: Set<AdaptiveRegimeLabel>;
    failureReasons: Set<string>;
  }>();

  for (const sel of selections) {
    const replay = sel.replays[0];
    const key = `${sel.primaryStrategy}_${sel.regime?.regimeLabel ?? "UNKNOWN"}`;
    const bucket = buckets.get(key) ?? {
      strategyType: sel.primaryStrategy,
      regimeLabel: sel.regime?.regimeLabel,
      wins: 0, total: 0, profitSum: 0, qualitySum: 0,
      winningMarkets: new Set(), losingMarkets: new Set(), failureReasons: new Set(),
    };
    bucket.total += 1;
    const success = replay?.wasBestStrategy ?? sel.validationPassed;
    if (success) bucket.wins += 1;
    bucket.profitSum += replay?.additionalProfitPct != null ? Math.max(0, 100 - Math.abs(replay.additionalProfitPct)) : 50;
    bucket.qualitySum += sel.strategyConfidence;
    if (sel.regime?.regimeLabel) {
      if (success) bucket.winningMarkets.add(sel.regime.regimeLabel);
      else bucket.losingMarkets.add(sel.regime.regimeLabel);
    }
    if (!sel.validationPassed) bucket.failureReasons.add("Validation failed");
    if (replay?.replayVerdict === "SUBOPTIMAL") bucket.failureReasons.add("Suboptimal strategy choice");
    buckets.set(key, bucket);
  }

  const learnings = [];
  for (const bucket of buckets.values()) {
    if (bucket.total < 2) continue;
    const profile = await prisma.adaptiveStrategyProfile.findUnique({ where: { strategyType: bucket.strategyType } });
    await persistStrategyPerformance({
      profileId: profile?.id,
      strategyType: bucket.strategyType,
      regimeLabel: bucket.regimeLabel,
      winRate: (bucket.wins / bucket.total) * 100,
      profitFactor: 1 + bucket.profitSum / bucket.total / 100,
      accuracy: bucket.qualitySum / bucket.total,
      tradeCount: bucket.total,
      totalProfitPct: bucket.profitSum,
    });
    const knowledge = await persistStrategyKnowledge({
      profileId: profile?.id,
      strategyType: bucket.strategyType,
      winningMarkets: [...bucket.winningMarkets],
      losingMarkets: [...bucket.losingMarkets],
      failureReasons: [...bucket.failureReasons],
      historicalPerformance: { winRate: (bucket.wins / bucket.total) * 100, samples: bucket.total },
      marketCompatibility: { regimes: [...bucket.winningMarkets] },
    });
    learnings.push(knowledge);
  }

  emitStrategySelectorEvent(STRATEGY_SELECTOR_EVENT.KNOWLEDGE_UPDATED, { count: learnings.length });
  return { learned: learnings.length, learnings };
}
