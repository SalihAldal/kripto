import type { UniverseSymbol } from "@/src/server/discovery/discovery.types";
import { binanceFuturesUniverseProvider } from "@/src/server/discovery/exchange/binance-futures.provider";
import { binanceSpotUniverseProvider } from "@/src/server/discovery/exchange/binance-spot.provider";
import { getExchangeUniverseRegistry } from "@/src/server/discovery/exchange/exchange-universe.provider";
import { upsertScannerUniverseBatch } from "@/src/server/discovery/discovery.repository";

let providersBootstrapped = false;

function ensureProvidersRegistered() {
  if (providersBootstrapped) return;
  const registry = getExchangeUniverseRegistry();
  registry.register(binanceSpotUniverseProvider);
  registry.register(binanceFuturesUniverseProvider);
  providersBootstrapped = true;
}

function enrichSpecialZones(rows: UniverseSymbol[]): UniverseSymbol[] {
  const now = Date.now();
  return rows.map((row) => {
    const base = row.baseAsset?.toUpperCase() ?? row.symbol.replace(/USDT$/, "");
    const isMemeLike = /(DOGE|SHIB|PEPE|FLOKI|BONK|WIF|MEME)/.test(base);
    const isAiLike = /(AI|FET|AGIX|RNDR|TAO|WLD|ARKM)/.test(base);
    const isRwaLike = /(ONDO|MPL|CFG|POLYX|TRU)/.test(base);
    const isDepinLike = /(FIL|AR|HNT|IO|RNDR|AKT)/.test(base);
    const listedAt = row.listedAt ?? (row.isNewListing ? new Date(now - 7 * 86400000) : undefined);

    let zone: string | undefined;
    let source = row.source;
    if (row.isNewListing) {
      zone = "NEW_LISTING";
      source = "NEW_LISTING";
    } else if (row.isDelistingCandidate) {
      zone = "DELISTING_CANDIDATE";
      source = "DELISTING_CANDIDATE";
    } else if (isMemeLike) {
      zone = "MEME_ZONE";
    } else if (isAiLike) {
      zone = "AI_ZONE";
      source = row.source === "BINANCE_SPOT" ? "BINANCE_ALPHA" : row.source;
    } else if (isRwaLike) {
      zone = "RWA_ZONE";
    } else if (isDepinLike) {
      zone = "DEPIN_ZONE";
    }

    return {
      ...row,
      source,
      zone,
      listedAt,
      metadata: {
        ...row.metadata,
        launchpoolCandidate: Boolean(row.metadata?.launchpoolCandidate),
        megadropCandidate: Boolean(row.metadata?.megadropCandidate),
        innovationZone: zone === "INNOVATION" || Boolean(row.metadata?.innovationZone),
        monitoringZone: Boolean(row.metadata?.monitoringZone),
      },
    };
  });
}

export async function syncUniverseDiscovery(limitPerProvider = 5000) {
  ensureProvidersRegistered();
  const registry = getExchangeUniverseRegistry();
  const discovered = enrichSpecialZones(await registry.discoverAll(limitPerProvider));
  const persisted = await upsertScannerUniverseBatch(discovered);
  return {
    discovered: discovered.length,
    persisted,
    providers: registry.listProviders().map((row) => row.id),
  };
}

export async function loadUniverseSymbols(options?: { limit?: number; source?: string }) {
  ensureProvidersRegistered();
  const { listScannerUniverse } = await import("@/src/server/discovery/discovery.repository");
  const rows = await listScannerUniverse(options);
  if (rows.length > 0) return rows;
  const synced = await syncUniverseDiscovery(options?.limit ?? 5000);
  if (synced.discovered === 0) {
    const { listBinanceSpotSymbolsQuick } = await import("@/src/server/discovery/exchange/binance-spot.provider");
    return listBinanceSpotSymbolsQuick(options?.limit ?? 1200);
  }
  return listScannerUniverse(options);
}
