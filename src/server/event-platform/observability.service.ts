import { prisma } from "@/src/server/db/prisma";
import { persistObservabilitySnapshot } from "@/src/server/event-platform/event-platform.repository";
import { getActiveBroker } from "@/src/server/event-platform/message-broker.service";
import { TOPICS } from "@/src/server/event-platform/message-broker.service";

export async function captureObservabilitySnapshot() {
  const oneHourAgo = new Date(Date.now() - 3600_000);
  const [eventCount, failureCount, checkpoints, replays] = await Promise.all([
    prisma.eventStore.count({ where: { publishedAt: { gte: oneHourAgo } } }),
    prisma.deadLetterEvent.count({ where: { createdAt: { gte: oneHourAgo }, resolved: false } }),
    prisma.consumerCheckpoint.findMany(),
    prisma.eventReplay.findMany({ where: { status: "COMPLETED" }, orderBy: { completedAt: "desc" }, take: 1 }),
  ]);

  const broker = getActiveBroker();
  const queueLength = await broker.getQueueLength(TOPICS.DOMAIN);
  const consumerLag = checkpoints.reduce((s, c) => s + c.lag, 0);
  const avgProcessingMs = checkpoints.length > 0 ? consumerLag * 10 : 0;
  const eventRate = eventCount / 3600;
  const replaySpeed = replays[0]?.speed ?? undefined;
  const workerHealth = failureCount > 10 ? 60 : failureCount > 0 ? 80 : 100;

  return persistObservabilitySnapshot({
    eventRate,
    consumerLag,
    queueLength,
    avgProcessingMs,
    failureCount,
    replaySpeed,
    workerHealth,
    brokerType: broker.brokerType,
  });
}

export async function getConsumerLag() {
  return prisma.consumerCheckpoint.findMany({ orderBy: { lag: "desc" } });
}
