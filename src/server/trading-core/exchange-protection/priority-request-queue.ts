import { randomUUID } from "node:crypto";
import type {
  ExchangeQueueSnapshot,
  ExchangeRequestPriority,
  ProtectedExchangeRequest,
} from "@/src/server/trading-core/exchange-protection/exchange-protection.types";

type QueuedRequest<T> = {
  request: ProtectedExchangeRequest;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

const priorityRank: Record<ExchangeRequestPriority, number> = {
  CRITICAL: 4,
  HIGH: 3,
  NORMAL: 2,
  LOW: 1,
};

export class PriorityRequestQueue {
  private readonly queue: Array<QueuedRequest<unknown>> = [];
  private running = true;
  private inFlight = 0;
  private processed = 0;
  private failed = 0;

  constructor(
    private readonly concurrency: number,
    private readonly handler: (request: ProtectedExchangeRequest) => Promise<unknown>,
  ) {}

  enqueue<T>(request: ProtectedExchangeRequest): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        request: { ...request, id: request.id ?? randomUUID(), createdAt: request.createdAt ?? new Date().toISOString() },
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.sort();
      void this.drain();
    });
  }

  stop() {
    this.running = false;
  }

  start() {
    this.running = true;
    void this.drain();
  }

  snapshot(): ExchangeQueueSnapshot {
    return {
      depth: this.queue.length,
      running: this.running,
      inFlight: this.inFlight,
      processed: this.processed,
      failed: this.failed,
      byPriority: {
        CRITICAL: this.count("CRITICAL"),
        HIGH: this.count("HIGH"),
        NORMAL: this.count("NORMAL"),
        LOW: this.count("LOW"),
      },
    };
  }

  private async drain() {
    if (!this.running) return;
    while (this.running && this.inFlight < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) return;
      this.inFlight += 1;
      void this.handler(item.request)
        .then((result) => {
          this.processed += 1;
          item.resolve(result);
        })
        .catch((error) => {
          this.failed += 1;
          item.reject(error);
        })
        .finally(() => {
          this.inFlight -= 1;
          void this.drain();
        });
    }
  }

  private sort() {
    this.queue.sort((a, b) => priorityRank[b.request.priority] - priorityRank[a.request.priority]);
  }

  private count(priority: ExchangeRequestPriority) {
    return this.queue.filter((item) => item.request.priority === priority).length;
  }
}
