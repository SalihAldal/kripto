import { prisma } from "@/src/server/db/prisma";

export async function cleanupOldEvents(retentionDays = 365) {
  // Event store is immutable — never delete persisted events by default
  void retentionDays;
  return { deleted: 0, note: "EventStore retention disabled — all events persisted forever" };
}

export async function cleanupResolvedDeadLetters(daysOld = 30) {
  const cutoff = new Date(Date.now() - daysOld * 86400_000);
  const deleted = await prisma.deadLetterEvent.deleteMany({
    where: { resolved: true, resolvedAt: { lt: cutoff } },
  });
  return { deleted: deleted.count };
}
