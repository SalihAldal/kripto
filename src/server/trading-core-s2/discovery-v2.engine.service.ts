import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { listScannerUniverse } from "@/src/server/discovery/discovery.repository";
import { buildMarketContext } from "@/src/server/scanner/market-context-builder";
import {
  assignReportCategories,
  buildDiscoveryReport,
  scoreDiscoverySymbol,
} from "@/src/server/trading-core-s2/discovery-v2.scoring.service";
import {
  persistDiscoveryV2Batch,
} from "@/src/server/trading-core-s2/trading-core-s2.repository";
import {
  setCachedDiscoveryResult,
  getCachedMarketRegime,
  getCachedDiscoveryTopSymbols,
} from "@/src/server/trading-core-s2/trading-core-s2.cache";
import { emitTradingCoreS2Event, TRADING_CORE_S2_EVENT } from "@/src/server/trading-core-s2/trading-core-s2.events";
import type { DiscoveryV2ScoreBreakdown } from "@/src/server/trading-core-s2/trading-core-s2.types";

async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T) => Promise<R | null>,
  concurrency: number,
) {
  const results: R[] = [];
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      try {
        const value = await worker(items[current]);
        if (value != null) results.push(value);
      } catch (error) {
        logger.debug({ error: (error as Error).message }, "Discovery v2 symbol worker failed");
      }
    }
  });
  await Promise.all(runners);
  return results;
}

export async function runDiscoveryV2Scan(limit = env.DISCOVERY_V2_CYCLE_LIMIT) {
  const regime = getCachedMarketRegime();
  if (!regime) {
    throw new Error("Market regime not initialized — run REGIME_REFRESH first");
  }

  const universe = await listScannerUniverse({
    limit,
    source: "BINANCE_SPOT",
  });
  const usdtSymbols = universe
    .filter((row) => row.quoteAsset === "USDT" && row.marketType === "SPOT" && row.status === "TRADING")
    .map((row) => row.symbol);

  const btcContext = await buildMarketContext("BTCUSDT", { lite: true }).catch(() => null);
  const ethContext = await buildMarketContext("ETHUSDT", { lite: true }).catch(() => null);
  const btcChange24h = btcContext?.change24h ?? regime.btcTrend;
  const ethChange24h = ethContext?.change24h ?? regime.ethTrend;

  const scored = await runWithConcurrency(
    usdtSymbols,
    async (symbol) => {
      const context = await buildMarketContext(symbol, { lite: true });
      return scoreDiscoverySymbol({
        symbol,
        context,
        btcChange24h,
        ethChange24h,
        globalMarketRegime: regime.regime,
      });
    },
    env.DISCOVERY_V2_BATCH_CONCURRENCY,
  );

  const eligible = scored.filter((row) => !row.rejected);
  const ranked = [...eligible].sort((a, b) => b.discoveryScore - a.discoveryScore);
  const topN = ranked.slice(0, env.DISCOVERY_V2_TOP_N);
  const report = buildDiscoveryReport(scored);
  const categorizedTop = assignReportCategories(topN, report);

  const snapshot = await persistDiscoveryV2Batch({
    totalSymbols: usdtSymbols.length,
    rankedSymbols: categorizedTop.length,
    marketRegime: regime.regime,
    report,
    scores: scored,
    topCandidates: categorizedTop,
  });

  setCachedDiscoveryResult({
    snapshotId: snapshot.id,
    topSymbols: categorizedTop.map((row) => row.symbol),
    scoreMap: Object.fromEntries(
      scored.map((row) => [row.symbol.toUpperCase(), row.discoveryScore]),
    ),
    report,
    scannedAt: snapshot.scannedAt.toISOString(),
  });

  emitTradingCoreS2Event(TRADING_CORE_S2_EVENT.DISCOVERY_COMPLETED, {
    snapshotId: snapshot.id,
    totalSymbols: usdtSymbols.length,
    topN: categorizedTop.length,
  });

  return {
    snapshotId: snapshot.id,
    scannedAt: snapshot.scannedAt.toISOString(),
    totalSymbols: usdtSymbols.length,
    scoredSymbols: scored.length,
    eligibleSymbols: eligible.length,
    topCandidates: categorizedTop,
    report,
    marketRegime: regime.regime,
  };
}

export function getDiscoveryV2TopSymbolSet() {
  return new Set(getCachedDiscoveryTopSymbols().map((s) => s.toUpperCase()));
}
