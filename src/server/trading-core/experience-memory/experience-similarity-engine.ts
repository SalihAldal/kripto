import { clamp } from "@/src/server/trading-core/indicators/math";
import type { ExperienceQueryInput, HistoricalTradeMatch, TradeExperienceRecord } from "@/src/server/trading-core/experience-memory/experience-memory-types";

function closeScore(a?: number, b?: number, tolerance = 1) {
  if (a === undefined || b === undefined) return 0.5;
  return clamp(1 - Math.abs(a - b) / Math.max(tolerance, Math.abs(a), Math.abs(b), 1), 0, 1);
}

function indicatorTags(indicators: ExperienceQueryInput["entry"]["indicators"]) {
  return [
    indicators?.rsi !== undefined && indicators.rsi < 35 ? "RSI_OVERSOLD" : null,
    indicators?.rsi !== undefined && indicators.rsi > 65 ? "RSI_OVERBOUGHT" : null,
    indicators?.macd?.histogram !== undefined && indicators.macd.histogram > 0 ? "MACD_BULLISH" : null,
    indicators?.macd?.histogram !== undefined && indicators.macd.histogram < 0 ? "MACD_BEARISH" : null,
    indicators?.emaFast && indicators.emaSlow && indicators.emaFast > indicators.emaSlow ? "EMA_BULLISH" : null,
    indicators?.emaFast && indicators.emaSlow && indicators.emaFast < indicators.emaSlow ? "EMA_BEARISH" : null,
    indicators?.volumeSpike?.isSpike ? "VOLUME_SPIKE" : null,
  ].filter((item): item is string => Boolean(item));
}

export class ExperienceSimilarityEngine {
  match(query: ExperienceQueryInput, experiences: TradeExperienceRecord[]): HistoricalTradeMatch[] {
    return experiences
      .map((experience) => this.score(query, experience))
      .filter((match) => match.similarityScore >= (query.minSimilarityScore ?? 55))
      .sort((a, b) => b.similarityScore - a.similarityScore)
      .slice(0, query.limit ?? 20);
  }

  private score(query: ExperienceQueryInput, experience: TradeExperienceRecord): HistoricalTradeMatch {
    const reasons: string[] = [];
    let score = 0;
    if (query.market.symbol.toUpperCase() === experience.market.symbol.toUpperCase()) {
      score += 14;
      reasons.push("same symbol");
    }
    if (query.entry.strategy === experience.entry.strategy) {
      score += 14;
      reasons.push("same strategy");
    }
    if (query.entry.side === experience.entry.side) {
      score += 8;
      reasons.push("same side");
    }
    if (query.market.marketRegime && query.market.marketRegime === experience.market.marketRegime) {
      score += 16;
      reasons.push("same market regime");
    }
    score += closeScore(query.market.volatilityPercent, experience.market.volatilityPercent, 4) * 10;
    score += closeScore(query.market.fundingRatePercent, experience.market.fundingRatePercent, 0.12) * 8;
    score += closeScore(query.market.volumeRatio, experience.market.volumeRatio, 3) * 8;
    score += closeScore(query.market.orderbookImbalancePercent, experience.market.orderbookImbalancePercent, 40) * 7;
    score += closeScore(query.market.spreadPercent, experience.market.spreadPercent, 1) * 6;
    score += closeScore(query.market.liquidation?.manipulationRiskScore, experience.market.liquidation?.manipulationRiskScore, 100) * 7;
    const queryTags = new Set(indicatorTags(query.entry.indicators));
    const experienceTags = new Set(indicatorTags(experience.entry.indicators));
    const overlap = Array.from(queryTags).filter((tag) => experienceTags.has(tag));
    if (overlap.length > 0) {
      score += Math.min(12, overlap.length * 4);
      reasons.push(`indicator overlap: ${overlap.join(",")}`);
    }
    return {
      experience,
      similarityScore: Number(clamp(score, 0, 100).toFixed(2)),
      matchingReasons: reasons.length > 0 ? reasons : ["weak contextual similarity"],
    };
  }
}
