import type { SignalDecision } from "@/src/server/trading-core/core/types";

export class SignalStore {
  private readonly decisions: SignalDecision[] = [];

  save(decision: SignalDecision) {
    this.decisions.push(decision);
    if (this.decisions.length > 500) this.decisions.shift();
    return decision;
  }

  latest(symbol?: string) {
    const rows = symbol
      ? this.decisions.filter((decision) => decision.symbol === symbol.toUpperCase())
      : this.decisions;
    return rows[rows.length - 1] ?? null;
  }
}
