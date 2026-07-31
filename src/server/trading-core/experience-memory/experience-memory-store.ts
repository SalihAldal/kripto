import { randomUUID } from "node:crypto";
import type { ExperienceMemoryInput, ExperienceMemorySnapshot, ExperienceRiskFlag, TradeExperienceRecord } from "@/src/server/trading-core/experience-memory/experience-memory-types";
import { classifyNetExitOutcome } from "@/src/server/execution/profit-thresholds";

const MAX_EXPERIENCES = 5000;

function riskFlag(input: ExperienceMemoryInput): ExperienceRiskFlag {
  if (input.pnlResult < 0 || input.returnPercent < -0.35 || (input.market.liquidation?.manipulationRiskScore ?? 0) >= 70) return "RISKY";
  if (input.returnPercent < 0.15 || (input.market.spreadPercent ?? 0) >= 0.45 || (input.market.volatilityPercent ?? 0) >= 4) return "CAUTION";
  return "SAFE";
}

export class ExperienceMemoryStore {
  private readonly experiences: TradeExperienceRecord[] = [];

  remember(input: ExperienceMemoryInput): TradeExperienceRecord {
    const record: TradeExperienceRecord = {
      ...input,
      experienceId: randomUUID(),
      outcome: classifyNetExitOutcome(input.returnPercent),
      riskFlag: riskFlag(input),
      createdAt: new Date().toISOString(),
    };
    this.experiences.unshift(record);
    if (this.experiences.length > MAX_EXPERIENCES) this.experiences.length = MAX_EXPERIENCES;
    return record;
  }

  all() {
    return [...this.experiences];
  }

  snapshot(): ExperienceMemorySnapshot {
    return {
      totalExperiences: this.experiences.length,
      successfulSetups: this.experiences.filter((item) => item.outcome === "WIN" && item.riskFlag !== "RISKY").slice(0, 50),
      failedSetups: this.experiences.filter((item) => item.outcome === "LOSS").slice(0, 50),
      riskyPatterns: this.experiences.filter((item) => item.riskFlag === "RISKY").slice(0, 50),
      updatedAt: new Date().toISOString(),
    };
  }
}

const globalStore = globalThis as typeof globalThis & { __experienceMemoryStore?: ExperienceMemoryStore };
export const experienceMemoryStore = globalStore.__experienceMemoryStore ?? new ExperienceMemoryStore();
globalStore.__experienceMemoryStore = experienceMemoryStore;
