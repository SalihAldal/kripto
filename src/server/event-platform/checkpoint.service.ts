import { upsertCheckpoint } from "@/src/server/event-platform/event-platform.repository";
import { emitPlatformEvent, PLATFORM_EVENT } from "@/src/server/event-platform/event-platform.events";
import { prisma } from "@/src/server/db/prisma";
import type { PlatformModuleType } from "@prisma/client";

export async function syncCheckpoints() {
  const plugins = await prisma.modulePluginRegistration.findMany({ where: { enabled: true } });
  const results = [];

  for (const plugin of plugins) {
    const consumerId = plugin.consumerId ?? `${plugin.moduleType.toLowerCase()}-consumer`;
    const lastEvent = await prisma.eventStore.findFirst({
      where: { sourceModule: plugin.moduleType },
      orderBy: { publishedAt: "desc" },
    });

    const totalEvents = await prisma.eventStore.count({ where: { sourceModule: plugin.moduleType } });
    const processed = lastEvent ? await prisma.eventStore.count({
      where: { sourceModule: plugin.moduleType, publishedAt: { lte: lastEvent.publishedAt } },
    }) : 0;
    const lag = Math.max(0, totalEvents - processed);

    const checkpoint = await upsertCheckpoint(
      consumerId,
      plugin.moduleType,
      lastEvent?.eventId ?? "",
      lastEvent?.sequenceNumber ?? BigInt(0),
      lag,
    );
    results.push(checkpoint);
    emitPlatformEvent(PLATFORM_EVENT.CHECKPOINT_UPDATED, { consumerId, moduleType: plugin.moduleType, lag });
  }

  return results;
}

export async function getCheckpointStatus() {
  return prisma.consumerCheckpoint.findMany({ orderBy: { lag: "desc" } });
}
