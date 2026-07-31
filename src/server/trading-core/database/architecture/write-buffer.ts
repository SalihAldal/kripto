import { logger } from "@/lib/logger";
import { prisma } from "@/src/server/db/prisma";
import type { WriteBufferItem } from "@/src/server/trading-core/database/architecture/database-types";

export class HighFrequencyWriteBuffer {
  private readonly items: WriteBufferItem[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly flushEveryMs = 500,
    private readonly maxBatchSize = 250,
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.flush().catch((error) => logger.warn({ error }, "Trading core write buffer flush failed"));
    }, this.flushEveryMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  push(item: WriteBufferItem) {
    this.items.push(item);
    if (this.items.length >= this.maxBatchSize) {
      void this.flush();
    }
  }

  async flush() {
    const batch = this.items.splice(0, this.maxBatchSize);
    if (batch.length === 0) return;
    for (const item of batch) {
      await this.upsertJsonPayload(item);
    }
  }

  stats() {
    return {
      depth: this.items.length,
      flushEveryMs: this.flushEveryMs,
      maxBatchSize: this.maxBatchSize,
    };
  }

  private async upsertJsonPayload(item: WriteBufferItem) {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO trading_core.events (
        aggregate_type,
        aggregate_id,
        event_type,
        payload,
        metadata
      )
      VALUES ($1, $2, 'buffered_write', $3::jsonb, '{"source":"write-buffer"}'::jsonb)
      `,
      item.table,
      item.key,
      JSON.stringify(item.payload),
    );
  }
}
