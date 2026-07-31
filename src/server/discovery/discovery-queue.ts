import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { DiscoveryJobPayload } from "@/src/server/discovery/discovery.types";
import { runDiscoveryBatch } from "@/src/server/discovery/discovery-pipeline.engine";
import {
  expireStaleOpportunities,
  listScannerUniverse,
  persistDiscoveryBatch,
} from "@/src/server/discovery/discovery.repository";
import { rankDiscoveryProfiles } from "@/src/server/discovery/master-scanner.service";
import { scoreDiscoveryLane } from "@/src/server/discovery/lanes/discovery-lanes.engine";
import { buildMarketContext } from "@/src/server/scanner/market-context-builder";
import { classifyAsset } from "@/src/server/discovery/stages/market-classification.service";
import { syncUniverseDiscovery } from "@/src/server/discovery/stages/universe-discovery.service";
import { buildDiscoveryOutput } from "@/src/server/discovery/opportunity-tier.service";
import { buildScannerProfileDimensions, mergeMasterScannerScore } from "@/src/server/discovery/master-scanner.service";
import { filterHealthyOnly } from "@/src/server/discovery/stages/market-health-filter.service";
import { detectDiscoveryRegime, regimeConfidence } from "@/src/server/discovery/stages/regime-detection.service";

export const discoveryQueue = new TradingJobQueue("discovery-engine", 4, Boolean(env.REDIS_URL));

let handlersRegistered = false;

async function resolveSymbols(limit = 120, explicit?: string[]) {
  if (explicit?.length) return explicit.slice(0, limit);
  const universe = await listScannerUniverse({ limit });
  return universe.map((row) => row.symbol).slice(0, limit);
}

export function registerDiscoveryQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  discoveryQueue.register<Extract<DiscoveryJobPayload, { type: "UNIVERSE_SYNC" }>>("UNIVERSE_SYNC", async (job) => {
    const result = await syncUniverseDiscovery(job.payload.limit ?? 5000);
    await prisma.discoveryJobState.upsert({
      where: { jobType: "UNIVERSE_SYNC" },
      create: { jobType: "UNIVERSE_SYNC", status: "COMPLETED", metadata: result, lastProcessedAt: new Date() },
      update: { status: "COMPLETED", metadata: result, lastProcessedAt: new Date() },
    });
  });

  discoveryQueue.register<Extract<DiscoveryJobPayload, { type: "HEALTH_CHECK" }>>("HEALTH_CHECK", async (job) => {
    const symbols = await resolveSymbols(job.payload.limit ?? 80, job.payload.symbols);
    let healthy = 0;
    for (const symbol of symbols) {
      try {
        const context = await buildMarketContext(symbol, { lite: true });
        const rows = filterHealthyOnly([{ symbol, context }]);
        if (rows.length > 0) healthy += 1;
      } catch {
        // ignore per-symbol failures
      }
    }
    await prisma.discoveryJobState.upsert({
      where: { jobType: "HEALTH_CHECK" },
      create: {
        jobType: "HEALTH_CHECK",
        status: "COMPLETED",
        metadata: { checked: symbols.length, healthy },
        lastProcessedAt: new Date(),
      },
      update: {
        status: "COMPLETED",
        metadata: { checked: symbols.length, healthy },
        lastProcessedAt: new Date(),
      },
    });
  });

  discoveryQueue.register<Extract<DiscoveryJobPayload, { type: "DISCOVERY_CYCLE" }>>("DISCOVERY_CYCLE", async (job) => {
    const symbols = await resolveSymbols(job.payload.limit ?? 120, job.payload.symbols);
    const inputs = [];
    for (const symbol of symbols) {
      try {
        const context = await buildMarketContext(symbol, { lite: true });
        inputs.push({ symbol, context });
      } catch (error) {
        logger.warn({ symbol, error: (error as Error).message }, "Discovery context failed");
      }
    }
    await runDiscoveryBatch(inputs, { persist: true });
    await expireStaleOpportunities();
    await prisma.discoveryJobState.upsert({
      where: { jobType: "DISCOVERY_CYCLE" },
      create: { jobType: "DISCOVERY_CYCLE", status: "COMPLETED", lastProcessedAt: new Date() },
      update: { status: "COMPLETED", lastProcessedAt: new Date() },
    });
  });

  discoveryQueue.register<Extract<DiscoveryJobPayload, { type: "LANE_SCAN" }>>("LANE_SCAN", async (job) => {
    const symbols = await resolveSymbols(job.payload.limit ?? 60, job.payload.symbols);
    const profiles = [];
    for (const symbol of symbols) {
      try {
        const context = await buildMarketContext(symbol, { lite: true });
        const healthyRows = filterHealthyOnly([{ symbol, context }]);
        if (healthyRows.length === 0) continue;
        const assetClass = classifyAsset({ symbol, context });
        const laneScores = [scoreDiscoveryLane(job.payload.lane, { context, assetClass })];
        const dimensions = buildScannerProfileDimensions(laneScores);
        const merged = mergeMasterScannerScore({
          laneScores,
          dimensions,
          healthDataQuality: healthyRows[0].health.dataQualityScore,
        });
        profiles.push(
          buildDiscoveryOutput({
            symbol,
            assetClass,
            regime: detectDiscoveryRegime(context),
            opportunityScore: merged.opportunityScore,
            confidence: regimeConfidence(context, detectDiscoveryRegime(context)),
            positiveFactors: [],
            negativeFactors: [],
            dimensions,
            laneScores,
            profile: { lane: job.payload.lane },
            health: healthyRows[0].health,
          }),
        );
      } catch {
        // ignore
      }
    }
    if (profiles.length > 0) {
      await persistDiscoveryBatch({
        scannedAt: new Date().toISOString(),
        profiles,
        rankings: rankDiscoveryProfiles(profiles),
      });
    }
  });

  discoveryQueue.register<Extract<DiscoveryJobPayload, { type: "RANKING" }>>("RANKING", async (job) => {
    const symbols = await resolveSymbols(job.payload.limit ?? 200);
    const inputs = [];
    for (const symbol of symbols) {
      try {
        const context = await buildMarketContext(symbol, { lite: true });
        inputs.push({ symbol, context });
      } catch {
        // ignore
      }
    }
    await runDiscoveryBatch(inputs, { persist: true });
    await prisma.discoveryJobState.upsert({
      where: { jobType: "RANKING" },
      create: { jobType: "RANKING", status: "COMPLETED", lastProcessedAt: new Date() },
      update: { status: "COMPLETED", lastProcessedAt: new Date() },
    });
  });

  discoveryQueue.register<Extract<DiscoveryJobPayload, { type: "LISTING_WATCH" }>>("LISTING_WATCH", async () => {
    await syncUniverseDiscovery(5000);
    const newListings = await prisma.scannerUniverse.findMany({
      where: { isNewListing: true },
      take: 100,
      orderBy: { syncedAt: "desc" },
    });
    const inputs = [];
    for (const row of newListings) {
      try {
        const context = await buildMarketContext(row.symbol, { lite: true });
        inputs.push({ symbol: row.symbol, context });
      } catch {
        // ignore
      }
    }
    if (inputs.length > 0) await runDiscoveryBatch(inputs, { persist: true });
    await prisma.discoveryJobState.upsert({
      where: { jobType: "LISTING_WATCH" },
      create: { jobType: "LISTING_WATCH", status: "COMPLETED", lastProcessedAt: new Date() },
      update: { status: "COMPLETED", lastProcessedAt: new Date() },
    });
  });
}

export async function enqueueDiscoveryJob(payload: DiscoveryJobPayload) {
  registerDiscoveryQueueHandlers();
  return discoveryQueue.push(payload.type, payload);
}

export function startDiscoveryQueue() {
  registerDiscoveryQueueHandlers();
  void discoveryQueue.start();
  return discoveryQueue.stats();
}
