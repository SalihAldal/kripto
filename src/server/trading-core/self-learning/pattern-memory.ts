import type { IndicatorImpact, LearnedPattern, TradeLearningInput } from "@/src/server/trading-core/self-learning/self-learning-types";
import { isSuccessfulNetExit } from "@/src/server/execution/profit-thresholds";

export type PatternMemorySnapshot = {
  patterns: Array<LearnedPattern & { totalReturn: number; weightedWins?: number; weightedLosses?: number; weightedTotalReturn?: number; totalLearningWeight?: number }>;
  indicatorStats: Array<[string, { wins: number; losses: number; totalReturn: number; weightedWins?: number; weightedLosses?: number; weightedTotalReturn?: number; totalLearningWeight?: number }]>;
};

function avg(total: number, count: number) {
  return count > 0 ? total / count : 0;
}

function indicatorTags(input: TradeLearningInput) {
  const indicators = input.indicators;
  return [
    indicators?.rsi !== undefined && indicators.rsi < 35 ? "RSI_OVERSOLD" : null,
    indicators?.rsi !== undefined && indicators.rsi > 65 ? "RSI_OVERBOUGHT" : null,
    indicators?.macd?.histogram !== undefined && indicators.macd.histogram > 0 ? "MACD_BULLISH" : null,
    indicators?.macd?.histogram !== undefined && indicators.macd.histogram < 0 ? "MACD_BEARISH" : null,
    indicators?.emaFast && indicators.emaSlow && indicators.emaFast > indicators.emaSlow ? "EMA_BULLISH" : null,
    indicators?.emaFast && indicators.emaSlow && indicators.emaFast < indicators.emaSlow ? "EMA_BEARISH" : null,
    indicators?.volumeSpike?.isSpike ? "VOLUME_SPIKE" : null,
    input.regimeCompatibility?.status ? `REGIME_${input.regimeCompatibility.status}` : null,
    input.regimeCompatibility?.strategyFamily ? `STRATEGY_${input.regimeCompatibility.strategyFamily}` : null,
    ...(input.edgeConditions?.map((condition) => condition.type) ?? []),
  ].filter((item): item is string => Boolean(item));
}

export class PatternMemory {
  private readonly patterns = new Map<string, LearnedPattern & { totalReturn: number; weightedWins: number; weightedLosses: number; weightedTotalReturn: number; totalLearningWeight: number }>();
  private readonly indicatorStats = new Map<string, { wins: number; losses: number; totalReturn: number; weightedWins: number; weightedLosses: number; weightedTotalReturn: number; totalLearningWeight: number }>();

  record(input: TradeLearningInput): LearnedPattern {
    const tags = indicatorTags(input);
    const patternKey = [input.strategy, input.marketRegime ?? "UNKNOWN", ...tags.sort()].join(":");
    const learningWeight = Math.max(0.12, Math.min(2.25, Number(input.learningWeight ?? input.learningWeightProfile?.weight ?? 1)));
    const current = this.patterns.get(patternKey) ?? {
      patternKey,
      strategy: input.strategy,
      marketRegime: input.marketRegime,
      indicatorTags: tags,
      trades: 0,
      wins: 0,
      losses: 0,
      winrate: 0,
      averageReturnPercent: 0,
      totalReturn: 0,
      weightedWins: 0,
      weightedLosses: 0,
      weightedTotalReturn: 0,
      totalLearningWeight: 0,
      weightedSampleCount: 0,
      weightedWinrate: 0,
      weightedAverageReturnPercent: 0,
      averageLearningWeight: 1,
      lastLearningWeight: learningWeight,
      regimeCompatibility: input.regimeCompatibility,
      score: 50,
      status: "NEUTRAL" as const,
      lastSeenAt: new Date().toISOString(),
    };
    const won = isSuccessfulNetExit(input.returnPercent);
    current.trades += 1;
    current.wins += won ? 1 : 0;
    current.losses += !won ? 1 : 0;
    current.totalReturn += input.returnPercent;
    current.weightedWins += won ? learningWeight : 0;
    current.weightedLosses += !won ? learningWeight : 0;
    current.weightedTotalReturn += input.returnPercent * learningWeight;
    current.totalLearningWeight += learningWeight;
    current.winrate = Number((current.wins / Math.max(1, current.trades) * 100).toFixed(2));
    current.averageReturnPercent = Number(avg(current.totalReturn, current.trades).toFixed(4));
    current.weightedSampleCount = Number(current.totalLearningWeight.toFixed(4));
    current.weightedWinrate = Number((current.weightedWins / Math.max(0.0001, current.totalLearningWeight) * 100).toFixed(2));
    current.weightedAverageReturnPercent = Number(avg(current.weightedTotalReturn, current.totalLearningWeight).toFixed(4));
    current.averageLearningWeight = Number((current.totalLearningWeight / Math.max(1, current.trades)).toFixed(4));
    current.lastLearningWeight = Number(learningWeight.toFixed(4));
    current.regimeCompatibility = input.regimeCompatibility ?? current.regimeCompatibility;
    const effectiveReturn = current.weightedAverageReturnPercent ?? current.averageReturnPercent;
    const effectiveWinrate = current.weightedWinrate ?? current.winrate;
    current.score = Number(Math.max(0, Math.min(100, 50 + effectiveReturn * 12 + (effectiveWinrate - 50) * 0.6)).toFixed(2));
    current.status = current.trades >= 4 && current.score >= 68 ? "BOOSTED" : current.trades >= 4 && current.score <= 35 ? "BLACKLISTED" : "NEUTRAL";
    current.lastSeenAt = new Date().toISOString();
    this.patterns.set(patternKey, current);

    for (const tag of tags) {
      const stat = this.indicatorStats.get(tag) ?? { wins: 0, losses: 0, totalReturn: 0, weightedWins: 0, weightedLosses: 0, weightedTotalReturn: 0, totalLearningWeight: 0 };
      stat.wins += won ? 1 : 0;
      stat.losses += !won ? 1 : 0;
      stat.totalReturn += input.returnPercent;
      stat.weightedWins += won ? learningWeight : 0;
      stat.weightedLosses += !won ? learningWeight : 0;
      stat.weightedTotalReturn += input.returnPercent * learningWeight;
      stat.totalLearningWeight += learningWeight;
      this.indicatorStats.set(tag, stat);
    }
    return this.clean(current);
  }

  all() {
    return Array.from(this.patterns.values()).map((pattern) => this.clean(pattern)).sort((a, b) => b.score - a.score);
  }

  indicatorImpact(): IndicatorImpact[] {
    return Array.from(this.indicatorStats.entries())
      .map(([indicator, stat]) => {
        const total = stat.wins + stat.losses;
        const weightedTotal = stat.totalLearningWeight || total;
        const winrate = weightedTotal > 0 ? (stat.weightedWins || stat.wins) / weightedTotal * 100 : 0;
        const averageReturnPercent = avg(stat.weightedTotalReturn || stat.totalReturn, Math.max(1, weightedTotal));
        return {
          indicator,
          wins: stat.wins,
          losses: stat.losses,
          winrate: Number(winrate.toFixed(2)),
          averageReturnPercent: Number(averageReturnPercent.toFixed(4)),
          impactScore: Number(Math.max(0, Math.min(100, 50 + averageReturnPercent * 10 + (winrate - 50) * 0.5)).toFixed(2)),
        };
      })
      .sort((a, b) => b.impactScore - a.impactScore);
  }

  exportSnapshot(): PatternMemorySnapshot {
    return {
      patterns: Array.from(this.patterns.values()).map((pattern) => ({ ...pattern })),
      indicatorStats: Array.from(this.indicatorStats.entries()).map(([key, value]) => [key, { ...value }]),
    };
  }

  importSnapshot(snapshot: PatternMemorySnapshot | null | undefined) {
    if (!snapshot) return;
    this.patterns.clear();
    this.indicatorStats.clear();
    for (const pattern of snapshot.patterns ?? []) {
      if (!pattern.patternKey) continue;
      this.patterns.set(pattern.patternKey, {
        ...pattern,
        totalReturn: Number(pattern.totalReturn ?? pattern.averageReturnPercent * Math.max(1, pattern.trades)),
        weightedWins: Number(pattern.weightedWins ?? 0),
        weightedLosses: Number(pattern.weightedLosses ?? 0),
        weightedTotalReturn: Number(pattern.weightedTotalReturn ?? pattern.totalReturn ?? 0),
        totalLearningWeight: Number(pattern.totalLearningWeight ?? pattern.weightedSampleCount ?? pattern.trades ?? 0),
      });
    }
    for (const [key, value] of snapshot.indicatorStats ?? []) {
      if (!key) continue;
      this.indicatorStats.set(key, {
        wins: Number(value.wins ?? 0),
        losses: Number(value.losses ?? 0),
        totalReturn: Number(value.totalReturn ?? 0),
        weightedWins: Number(value.weightedWins ?? value.wins ?? 0),
        weightedLosses: Number(value.weightedLosses ?? value.losses ?? 0),
        weightedTotalReturn: Number(value.weightedTotalReturn ?? value.totalReturn ?? 0),
        totalLearningWeight: Number(value.totalLearningWeight ?? (Number(value.wins ?? 0) + Number(value.losses ?? 0))),
      });
    }
  }

  private clean(pattern: LearnedPattern & { totalReturn: number }): LearnedPattern {
    return {
      patternKey: pattern.patternKey,
      strategy: pattern.strategy,
      marketRegime: pattern.marketRegime,
      indicatorTags: pattern.indicatorTags,
      trades: pattern.trades,
      wins: pattern.wins,
      losses: pattern.losses,
      winrate: pattern.winrate,
      averageReturnPercent: pattern.averageReturnPercent,
      weightedSampleCount: pattern.weightedSampleCount,
      weightedWinrate: pattern.weightedWinrate,
      weightedAverageReturnPercent: pattern.weightedAverageReturnPercent,
      averageLearningWeight: pattern.averageLearningWeight,
      lastLearningWeight: pattern.lastLearningWeight,
      regimeCompatibility: pattern.regimeCompatibility,
      score: pattern.score,
      status: pattern.status,
      lastSeenAt: pattern.lastSeenAt,
    };
  }
}
