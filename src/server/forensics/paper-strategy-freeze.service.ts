import { createHash } from "node:crypto";
import { tradingConfig } from "@/src/server/trading-core/config";

export type PaperStrategySnapshot = {
  hash: string;
  capturedAt: string;
  strategies: Record<string, { enabled: boolean; minScore: number }>;
  bots: Record<string, { enabled: boolean; minScore: number }>;
};

let frozenSnapshot: PaperStrategySnapshot | null = null;

export function isPaperStrategyMutationBlocked(): boolean {
  return process.env.EXECUTION_MODE === "paper" && process.env.PAPER_STRATEGY_FREEZE_ENABLED !== "false";
}

export function capturePaperStrategySnapshot(): PaperStrategySnapshot {
  const config = tradingConfig.snapshot();
  const strategies = Object.fromEntries(
    Object.entries(config.strategy).map(([name, value]) => [name, { enabled: value.enabled, minScore: value.minScore }]),
  );
  const bots = Object.fromEntries(
    Object.entries(config.bots).map(([name, value]) => [name, { enabled: value.enabled, minScore: value.minScore }]),
  );
  const payload = JSON.stringify({ strategies, bots });
  frozenSnapshot = {
    hash: createHash("sha256").update(payload).digest("hex"),
    capturedAt: new Date().toISOString(),
    strategies,
    bots,
  };
  return frozenSnapshot;
}

export function getPaperStrategySnapshot(): PaperStrategySnapshot | null {
  return frozenSnapshot;
}

/** Learning/memory collection may continue; runtime minScore mutations are blocked during paper freeze. */
export function resolveApplyLearningForPaper(requested: boolean): boolean {
  if (!requested) return false;
  if (isPaperStrategyMutationBlocked()) return false;
  return true;
}

export function guardPaperStrategyMutation(): boolean {
  return !isPaperStrategyMutationBlocked();
}
