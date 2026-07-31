import type { BotConfig, BotMemoryState } from "@/src/server/trading-core/bots/bot-types";

function initialState(config: BotConfig): BotMemoryState {
  return {
    botId: config.id,
    status: config.enabled ? "ACTIVE" : "DISABLED",
    openSymbols: [],
    trades: 0,
    wins: 0,
    losses: 0,
    consecutiveLosses: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
    score: 50,
    weight: 1,
    disabledReason: config.enabled ? undefined : "Disabled by config",
  };
}

export class BotStateStore {
  private readonly states = new Map<string, BotMemoryState>();

  ensure(config: BotConfig) {
    const current = this.states.get(config.id);
    if (current) return current;
    const state = initialState(config);
    this.states.set(config.id, state);
    return state;
  }

  get(botId: string) {
    return this.states.get(botId) ?? null;
  }

  update(botId: string, patch: Partial<BotMemoryState>) {
    const current = this.states.get(botId);
    if (!current) return null;
    const next = { ...current, ...patch };
    this.states.set(botId, next);
    return next;
  }

  all() {
    return Array.from(this.states.values());
  }
}
