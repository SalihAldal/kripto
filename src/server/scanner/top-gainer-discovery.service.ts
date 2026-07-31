import { env } from "@/lib/config";
import { getExchangeProvider } from "@/src/server/exchange";

export type TopGainerDiscoveryItem = {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  priorityScore: number;
  reason: string;
};

const CACHE_TTL_MS = 45_000;
let cache: { at: number; items: TopGainerDiscoveryItem[] } | null = null;

function isBadLeveragedSymbol(symbol: string) {
  return symbol.includes("UP") || symbol.includes("DOWN") || symbol.includes("BULL") || symbol.includes("BEAR");
}

function normalizeScore(input: { change24h: number; volume24h: number }) {
  const changeScore = Math.max(0, Math.min(120, input.change24h));
  const volumeScore = Math.max(0, Math.min(40, Math.log10(Math.max(input.volume24h, 1)) * 4));
  return Number((changeScore * 0.78 + volumeScore * 0.22).toFixed(2));
}

export async function discoverTopGainerSymbols(limit = 24): Promise<TopGainerDiscoveryItem[]> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.items.slice(0, limit);
  const provider = getExchangeProvider();
  if (!provider.listTickers24h) return [];
  const rows = await provider.listTickers24h();
  const minChange = env.PUMP_DISCOVERY_MIN_CHANGE_24H;
  const minVolume = Math.max(80_000, env.SCANNER_MIN_VOLUME_24H * 0.25);
  const quoteSuffix = env.BINANCE_PLATFORM === "tr" ? "TRY" : "USDT";
  const items = rows
    .filter((row) => row.symbol.endsWith(quoteSuffix))
    .filter((row) => !isBadLeveragedSymbol(row.symbol))
    .filter((row) => row.change24h >= minChange && row.volume24h >= minVolume)
    .map((row) => ({
      ...row,
      priorityScore: normalizeScore(row),
      reason: `top-gainer change=${row.change24h.toFixed(2)}% volume=${row.volume24h.toFixed(0)}`,
    }))
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, Math.max(limit, 36));
  cache = { at: now, items };
  return items.slice(0, limit);
}
