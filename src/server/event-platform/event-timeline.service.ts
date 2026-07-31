import { persistTimeline, searchEvents } from "@/src/server/event-platform/event-platform.repository";
import type { AggregateType } from "@prisma/client";

export async function buildTimeline(timelineType: string, input?: {
  aggregateType?: AggregateType;
  aggregateId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}) {
  const events = await searchEvents({
    aggregateType: input?.aggregateType,
    aggregateId: input?.aggregateId,
    from: input?.from,
    to: input?.to,
    limit: input?.limit ?? 500,
  });

  const entries = events.map((e) => ({
    eventId: e.eventId,
    eventType: e.eventType,
    aggregateId: e.aggregateId,
    aggregateType: e.aggregateType,
    sourceModule: e.sourceModule,
    timestamp: e.publishedAt.toISOString(),
    summary: `${e.eventType} on ${e.aggregateType}:${e.aggregateId}`,
  }));

  return persistTimeline({
    timelineType,
    title: `${timelineType} Timeline`,
    entries,
    aggregateId: input?.aggregateId,
    aggregateType: input?.aggregateType,
    fromTimestamp: input?.from,
    toTimestamp: input?.to,
  });
}

export async function buildPlatformTimeline(from?: Date, to?: Date) {
  return buildTimeline("platform", { from, to, limit: 1000 });
}

export async function buildTradeTimeline(tradeId: string) {
  return buildTimeline("trade", { aggregateType: "TRADE", aggregateId: tradeId });
}

export async function buildDecisionTimeline(decisionId: string) {
  return buildTimeline("decision", { aggregateType: "DECISION", aggregateId: decisionId });
}

export async function buildExecutionTimeline(executionId: string) {
  return buildTimeline("execution", { aggregateType: "EXECUTION", aggregateId: executionId });
}

export async function buildLearningTimeline(learningId: string) {
  return buildTimeline("learning", { aggregateType: "LEARNING", aggregateId: learningId });
}
