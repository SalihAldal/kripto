import { randomUUID } from "node:crypto";
import { logger } from "@/lib/logger";
import { getRedis } from "@/lib/redis";

export type QueueJob<T> = {
  id: string;
  type: string;
  payload: T;
  createdAt: string;
  attempts: number;
};

type Handler<T> = (job: QueueJob<T>) => Promise<void>;

export class TradingJobQueue {
  private readonly handlers = new Map<string, Handler<unknown>>();
  private readonly memoryQueue: QueueJob<unknown>[] = [];
  private running = false;

  constructor(
    private readonly name: string,
    private readonly concurrency: number,
    private readonly redisEnabled: boolean,
  ) {}

  register<T>(type: string, handler: Handler<T>) {
    this.handlers.set(type, handler as Handler<unknown>);
  }

  async push<T>(type: string, payload: T) {
    const job: QueueJob<T> = {
      id: randomUUID(),
      type,
      payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
    };
    const redis = this.redisEnabled ? getRedis() : null;
    if (redis) {
      await redis.lpush(this.redisKey, JSON.stringify(job));
      return job;
    }
    this.memoryQueue.push(job as QueueJob<unknown>);
    void this.drainMemory();
    return job;
  }

  async start() {
    this.running = true;
    void this.drainRedis();
    void this.drainMemory();
  }

  stop() {
    this.running = false;
  }

  stats() {
    return {
      name: this.name,
      memoryDepth: this.memoryQueue.length,
      handlers: Array.from(this.handlers.keys()),
      redisEnabled: this.redisEnabled,
    };
  }

  private get redisKey() {
    return `trading-core:${this.name}`;
  }

  private async drainMemory() {
    if (!this.running) return;
    const workers = Array.from({ length: Math.max(1, this.concurrency) }, async () => {
      while (this.running && this.memoryQueue.length > 0) {
        const job = this.memoryQueue.shift();
        if (job) await this.runJob(job);
      }
    });
    await Promise.all(workers);
  }

  private async drainRedis() {
    const redis = this.redisEnabled ? getRedis() : null;
    if (!redis) return;
    while (this.running) {
      try {
        const raw = await redis.rpop(this.redisKey);
        if (!raw) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          continue;
        }
        await this.runJob(JSON.parse(raw) as QueueJob<unknown>);
      } catch (error) {
        logger.warn({ queue: this.name, error: (error as Error).message }, "Trading core queue drain failed");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  private async runJob(job: QueueJob<unknown>) {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      logger.warn({ queue: this.name, type: job.type }, "Trading core queue job has no handler");
      return;
    }
    try {
      await handler({ ...job, attempts: job.attempts + 1 });
    } catch (error) {
      logger.warn({ queue: this.name, jobId: job.id, error: (error as Error).message }, "Trading core queue job failed");
    }
  }
}
