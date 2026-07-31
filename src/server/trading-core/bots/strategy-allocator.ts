import type { BotAllocation, BotConfig, BotMemoryState } from "@/src/server/trading-core/bots/bot-types";
import type { SignalDecision, StrategySignal } from "@/src/server/trading-core/core/types";

type AllocationInput = {
  signal: SignalDecision;
  candidates: Array<{ config: BotConfig; state: BotMemoryState; strategySignal: StrategySignal }>;
};

export class StrategyAllocator {
  allocate(input: AllocationInput): BotAllocation | null {
    const ranked = input.candidates
      .map((candidate) => {
        const allocationScore =
          candidate.strategySignal.score * 0.45 +
          candidate.config.priority * 0.25 +
          candidate.state.score * 0.2 +
          candidate.state.weight * 10;
        return { ...candidate, allocationScore };
      })
      .sort((a, b) => b.allocationScore - a.allocationScore);

    const selected = ranked[0];
    if (!selected) return null;
    return {
      botId: selected.config.id,
      botName: selected.config.name,
      strategy: selected.config.strategy,
      priority: selected.config.priority,
      weight: selected.state.weight,
      score: Number(selected.allocationScore.toFixed(2)),
      reason: `Allocated by priority/performance/strategy score for ${input.signal.symbol}`,
    };
  }
}
