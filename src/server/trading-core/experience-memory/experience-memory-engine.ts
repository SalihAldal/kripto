import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";
import { ExperienceSimilarityEngine } from "@/src/server/trading-core/experience-memory/experience-similarity-engine";
import { ExperienceMemoryStore, experienceMemoryStore } from "@/src/server/trading-core/experience-memory/experience-memory-store";
import type { ConfidenceMemoryResult, ExperienceMemoryInput, ExperienceQueryInput, ExperienceRiskFlag } from "@/src/server/trading-core/experience-memory/experience-memory-types";

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export class ExperienceMemoryEngine {
  private readonly similarity = new ExperienceSimilarityEngine();

  constructor(private readonly store: ExperienceMemoryStore = experienceMemoryStore) {}

  remember(input: ExperienceMemoryInput) {
    const record = this.store.remember(input);
    tradingLogger.info({
      category: "BOT",
      source: "trading-core.experience-memory",
      message: `Trade experience remembered: ${record.market.symbol}`,
      status: "SUCCESS",
      symbol: record.market.symbol,
      metricName: "experience_memory.return_percent",
      metricValue: record.returnPercent,
      context: { outcome: record.outcome, riskFlag: record.riskFlag, strategy: record.entry.strategy },
    });
    return record;
  }

  recall(query: ExperienceQueryInput): ConfidenceMemoryResult {
    const matchingTrades = this.similarity.match(query, this.store.all());
    const wins = matchingTrades.filter((match) => match.experience.outcome === "WIN").length;
    const losses = matchingTrades.filter((match) => match.experience.outcome === "LOSS").length;
    const historicalWinrate = matchingTrades.length > 0 ? (wins / matchingTrades.length) * 100 : 50;
    const averageReturnPercent = average(matchingTrades.map((match) => match.experience.returnPercent));
    const riskyPatterns = matchingTrades.filter((match) => match.experience.riskFlag === "RISKY").map((match) => match.experience);
    const rememberedSetups = matchingTrades.filter((match) => match.experience.outcome === "WIN" && match.experience.riskFlag !== "RISKY").map((match) => match.experience);
    const riskPenalty = Math.min(35, riskyPatterns.length * 8 + losses * 3);
    const confidenceScore = Math.max(0, Math.min(100, 50 + (historicalWinrate - 50) * 0.55 + averageReturnPercent * 10 + matchingTrades.length * 1.5 - riskPenalty));
    const riskFlag: ExperienceRiskFlag = confidenceScore >= 68 && riskyPatterns.length === 0 ? "SAFE" : confidenceScore <= 42 || riskyPatterns.length >= 3 ? "RISKY" : "CAUTION";
    return {
      confidenceScore: Number(confidenceScore.toFixed(2)),
      riskFlag,
      similarTrades: matchingTrades.length,
      historicalWinrate: Number(historicalWinrate.toFixed(2)),
      averageReturnPercent: Number(averageReturnPercent.toFixed(4)),
      matchingTrades,
      rememberedSetups: rememberedSetups.slice(0, 10),
      riskyPatterns: riskyPatterns.slice(0, 10),
      reasons: [
        `similarTrades=${matchingTrades.length}`,
        `historicalWinrate=${historicalWinrate.toFixed(2)}%`,
        `avgReturn=${averageReturnPercent.toFixed(4)}%`,
        `riskFlag=${riskFlag}`,
      ],
      generatedAt: new Date().toISOString(),
    };
  }

  snapshot() {
    return this.store.snapshot();
  }
}

const globalMemory = globalThis as typeof globalThis & { __experienceMemoryEngine?: ExperienceMemoryEngine };
export const experienceMemoryEngine = globalMemory.__experienceMemoryEngine ?? new ExperienceMemoryEngine();
globalMemory.__experienceMemoryEngine = experienceMemoryEngine;
