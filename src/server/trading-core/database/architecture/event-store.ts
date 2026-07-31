import { prisma } from "@/src/server/db/prisma";
import type { TradingCoreEvent } from "@/src/server/trading-core/database/architecture/database-types";

export class TradingCoreEventStore {
  async append(event: TradingCoreEvent) {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO trading_core.events (
        aggregate_type,
        aggregate_id,
        event_type,
        payload,
        metadata,
        occurred_at
      )
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
      `,
      event.aggregateType,
      event.aggregateId,
      event.eventType,
      JSON.stringify(event.payload),
      JSON.stringify(event.metadata ?? {}),
      event.occurredAt ?? new Date(),
    );
  }

  async appendMany(events: TradingCoreEvent[]) {
    for (const event of events) {
      await this.append(event);
    }
  }

  async load(aggregateType: string, aggregateId: string, afterId = 0) {
    return prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT id, event_id, event_type, event_version, payload, metadata, occurred_at, recorded_at
      FROM trading_core.events
      WHERE aggregate_type = $1 AND aggregate_id = $2 AND id > $3
      ORDER BY id ASC
      `,
      aggregateType,
      aggregateId,
      afterId,
    );
  }
}
