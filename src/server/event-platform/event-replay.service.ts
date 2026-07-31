import type { ReplayScope } from "@prisma/client";
import { createReplay, updateReplayProgress, searchEvents } from "@/src/server/event-platform/event-platform.repository";
import { replayEventsFromStore } from "@/src/server/event-platform/event-bus.service";
import type { AggregateType } from "@prisma/client";

function scopeToFilter(scope: ReplayScope, criteria?: Record<string, unknown>) {
  const now = new Date();
  let from: Date | undefined;
  if (scope === "DAY") from = new Date(now.getTime() - 86400_000);
  else if (scope === "WEEK") from = new Date(now.getTime() - 7 * 86400_000);
  else if (scope === "MONTH") from = new Date(now.getTime() - 30 * 86400_000);

  const filter: {
    from?: Date;
    to?: Date;
    aggregateType?: AggregateType;
    aggregateId?: string;
    eventType?: string;
    limit?: number;
  } = { from, to: now, limit: 10000 };

  if (scope === "COIN" && criteria?.symbol) {
    filter.aggregateId = String(criteria.symbol);
    filter.aggregateType = "MARKET";
  } else if (scope === "TRADE" && criteria?.tradeId) {
    filter.aggregateId = String(criteria.tradeId);
    filter.aggregateType = "TRADE";
  } else if (scope === "DECISION" && criteria?.decisionId) {
    filter.aggregateId = String(criteria.decisionId);
    filter.aggregateType = "DECISION";
  } else if (scope === "PORTFOLIO" && criteria?.portfolioId) {
    filter.aggregateId = String(criteria.portfolioId);
    filter.aggregateType = "PORTFOLIO";
  }

  return filter;
}

export async function startReplay(scope: ReplayScope = "DAY", filterCriteria?: Record<string, unknown>) {
  const replay = await createReplay(scope, filterCriteria);
  await updateReplayProgress(replay.id, 0, 0, "RUNNING");

  const start = Date.now();
  const filter = scopeToFilter(scope, filterCriteria);
  const result = await replayEventsFromStore(filter);
  const elapsed = Date.now() - start;
  const speed = elapsed > 0 ? result.replayed / (elapsed / 1000) : 0;

  await updateReplayProgress(replay.id, result.replayed, result.replayed, "COMPLETED", speed);
  return { replayKey: replay.replayKey, ...result, speed };
}

export async function replayByCorrelation(correlationId: string) {
  return replayEventsFromStore({ correlationId, limit: 5000 });
}
