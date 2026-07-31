import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { captureMarketSnapshotFromSymbol } from "@/src/server/market-intelligence/market-intelligence.engine";
import { deleteSnapshotsBefore } from "@/src/server/market-intelligence/market-intelligence.repository";
import { RETENTION_DAYS, type MarketIntelJobPayload } from "@/src/server/market-intelligence/market-intelligence.types";
import { prisma } from "@/src/server/db/prisma";
import type { SnapshotInterval } from "@prisma/client";

export const marketIntelQueue = new TradingJobQueue("market-intelligence", 3, Boolean(env.REDIS_URL));

let handlersRegistered = false;

export function registerMarketIntelQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  marketIntelQueue.register<Extract<MarketIntelJobPayload, { type: "CAPTURE_SYMBOL" }>>("CAPTURE_SYMBOL", async (job) => {
    await captureMarketSnapshotFromSymbol({
      symbol: job.payload.symbol,
      interval: job.payload.interval,
      context: job.payload.captureInput?.context,
      klines: job.payload.captureInput?.klines,
      orderBook: job.payload.captureInput?.orderBook,
      recentTrades: job.payload.captureInput?.recentTrades,
    });
  });

  marketIntelQueue.register<Extract<MarketIntelJobPayload, { type: "CAPTURE_BATCH" }>>("CAPTURE_BATCH", async (job) => {
    const symbols =
      job.payload.symbols ??
      (
        await prisma.decisionLog.findMany({
          distinct: ["symbol"],
          select: { symbol: true },
          orderBy: { createdAt: "desc" },
          take: job.payload.limit ?? 30,
        })
      ).map((row) => row.symbol);
    for (const symbol of symbols) {
      try {
        await captureMarketSnapshotFromSymbol({ symbol, interval: "M1" });
      } catch (error) {
        logger.warn({ symbol, error: (error as Error).message }, "Batch snapshot capture failed");
      }
    }
  });

  marketIntelQueue.register<Extract<MarketIntelJobPayload, { type: "VALIDATE_SNAPSHOTS" }>>("VALIDATE_SNAPSHOTS", async (job) => {
    const rows = await prisma.marketSnapshot.findMany({
      orderBy: { createdAt: "desc" },
      take: job.payload.limit ?? 100,
      select: { id: true, lastPrice: true, healthScore: true, dataQualityScore: true },
    });
    const invalid = rows.filter((row) => !row.lastPrice || row.lastPrice <= 0 || (row.healthScore ?? 0) <= 0);
    await prisma.marketIntelJobState.upsert({
      where: { jobType: "VALIDATE_SNAPSHOTS" },
      create: {
        jobType: "VALIDATE_SNAPSHOTS",
        status: "COMPLETED",
        lastProcessedAt: new Date(),
        metadata: { checked: rows.length, invalid: invalid.length },
      },
      update: {
        status: "COMPLETED",
        lastProcessedAt: new Date(),
        metadata: { checked: rows.length, invalid: invalid.length },
      },
    });
  });

  marketIntelQueue.register("CLEANUP_RETENTION", async () => {
    let deleted = 0;
    for (const [interval, days] of Object.entries(RETENTION_DAYS)) {
      if (days == null) continue;
      const before = new Date(Date.now() - days * 24 * 60 * 60_000);
      deleted += await deleteSnapshotsBefore(interval as SnapshotInterval, before);
    }
    await prisma.marketIntelJobState.upsert({
      where: { jobType: "CLEANUP_RETENTION" },
      create: { jobType: "CLEANUP_RETENTION", status: "COMPLETED", lastProcessedAt: new Date(), metadata: { deleted } },
      update: { status: "COMPLETED", lastProcessedAt: new Date(), metadata: { deleted } },
    });
  });

  marketIntelQueue.register<Extract<MarketIntelJobPayload, { type: "COMPRESS_SNAPSHOTS" }>>("COMPRESS_SNAPSHOTS", async (job) => {
    const { Prisma } = await import("@prisma/client");
    const rows = await prisma.marketSnapshot.findMany({
      where: { compressedPayload: { equals: Prisma.DbNull } },
      orderBy: { createdAt: "desc" },
      take: job.payload.limit ?? 50,
    });
    const { gzipSync } = await import("node:zlib");
    for (const row of rows) {
      const compressed = gzipSync(Buffer.from(JSON.stringify(row), "utf8")).toString("base64");
      await prisma.marketSnapshot.update({
        where: { id: row.id },
        data: { compressedPayload: { compressed, ratio: compressed.length } },
      });
    }
  });

  marketIntelQueue.register<Extract<MarketIntelJobPayload, { type: "AGGREGATE_HISTORICAL" }>>("AGGREGATE_HISTORICAL", async (job) => {
    const intervals: SnapshotInterval[] = ["M5", "M15", "H1", "H4", "D1"];
    for (const interval of intervals) {
      if (job.payload.interval && job.payload.interval !== interval) continue;
      const symbols = await prisma.marketSnapshot.findMany({
        where: { interval: "M1" },
        distinct: ["symbol"],
        select: { symbol: true },
        take: 20,
      });
      for (const row of symbols) {
        if (!row.symbol) continue;
        await captureMarketSnapshotFromSymbol({ symbol: row.symbol, interval }).catch(() => null);
      }
    }
  });
}

export async function enqueueMarketIntelJob(payload: MarketIntelJobPayload) {
  registerMarketIntelQueueHandlers();
  return marketIntelQueue.push(payload.type, payload);
}

export function startMarketIntelQueue() {
  registerMarketIntelQueueHandlers();
  void marketIntelQueue.start();
  return marketIntelQueue.stats();
}
