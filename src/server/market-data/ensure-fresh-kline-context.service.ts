import { marketDataGateway } from "@/src/server/market-data/market-data-gateway";
import { getMarketDataDaemon } from "@/src/server/market-data/spine/market-data-daemon";
import { putMarketSnapshot, getMarketSnapshot } from "@/src/server/scanner/market-snapshot-cache";
import {
  assessKlineInput,
  AI_KLINE_MIN_COUNT,
  type KlineStaleReasonCode,
} from "@/src/server/market-data/kline-input-contract.service";
import type { KlineItem } from "@/src/types/exchange";

export type FreshKlineContextResult = {
  symbol: string;
  interval: string;
  klines: KlineItem[];
  source: "existing" | "snapshot_cache" | "daemon" | "rest_recovery" | "none";
  count: number;
  lastOpenTime: number | null;
  lastCloseTime: number | null;
  ageSec: number | null;
  fresh: boolean;
  refreshed: boolean;
  reasonCode: KlineStaleReasonCode | null;
  refreshAttempted: boolean;
  refreshSucceeded: boolean;
};

const inflight = new Map<string, Promise<FreshKlineContextResult>>();

function mergeSnapshot(symbol: string, klines: KlineItem[]) {
  const cached = getMarketSnapshot(symbol);
  putMarketSnapshot(symbol, {
    klines,
    orderBook: cached?.orderBook ?? { lastUpdateId: 0, bids: [], asks: [] },
    recentTrades: cached?.recentTrades ?? [],
  });
}

async function loadKlinesFromSources(input: {
  symbol: string;
  interval: string;
  limit: number;
  existingKlines?: KlineItem[];
}): Promise<{ klines: KlineItem[]; source: FreshKlineContextResult["source"]; refreshAttempted: boolean; refreshSucceeded: boolean }> {
  const symbol = input.symbol.toUpperCase();
  const daemon = getMarketDataDaemon();
  daemon.subscribeDeep(symbol, "ensure-fresh-kline");

  let klines = input.existingKlines ?? [];
  let source: FreshKlineContextResult["source"] = klines.length ? "existing" : "none";
  let refreshAttempted = false;
  let refreshSucceeded = false;

  const snapshot = getMarketSnapshot(symbol);
  if (snapshot?.klines?.length) {
    klines = snapshot.klines;
    source = "snapshot_cache";
  }

  let assessment = assessKlineInput({ klines, nowMs: Date.now() });
  if (assessment.fresh) {
    return { klines, source, refreshAttempted, refreshSucceeded };
  }

  try {
    const daemonRows = await marketDataGateway.getKlines(symbol, input.interval, input.limit);
    if (daemonRows.length >= klines.length) {
      klines = daemonRows;
      source = "daemon";
      mergeSnapshot(symbol, klines);
    }
  } catch {
    /* daemon not ready — fall through to REST */
  }

  assessment = assessKlineInput({ klines, nowMs: Date.now() });
  if (assessment.fresh) {
    return { klines, source, refreshAttempted, refreshSucceeded };
  }

  refreshAttempted = true;
  try {
    const recoveryRows = await marketDataGateway.getKlines(symbol, input.interval, input.limit, {
      recovery: true,
      priority: "high",
    });
    if (recoveryRows.length >= AI_KLINE_MIN_COUNT) {
      klines = recoveryRows;
      source = "rest_recovery";
      refreshSucceeded = true;
      mergeSnapshot(symbol, klines);
    }
  } catch {
    refreshSucceeded = false;
  }

  return { klines, source, refreshAttempted, refreshSucceeded };
}

export async function ensureFreshKlineContext(input: {
  symbol: string;
  interval?: string;
  limit?: number;
  existingKlines?: KlineItem[];
}): Promise<FreshKlineContextResult> {
  const symbol = input.symbol.toUpperCase();
  const interval = input.interval ?? "1m";
  const limit = input.limit ?? 80;
  const key = `${symbol}:${interval}:${limit}`;

  const pending = inflight.get(key);
  if (pending) return pending;

  const task = (async () => {
    const loaded = await loadKlinesFromSources({ symbol, interval, limit, existingKlines: input.existingKlines });
    const assessment = assessKlineInput({ klines: loaded.klines, nowMs: Date.now() });
    return {
      symbol,
      interval,
      klines: loaded.klines,
      source: loaded.source,
      count: assessment.count,
      lastOpenTime: assessment.lastOpenTime,
      lastCloseTime: assessment.lastCloseTime,
      ageSec: assessment.ageSec,
      fresh: assessment.fresh,
      refreshed: loaded.source === "rest_recovery",
      reasonCode: assessment.reasonCode,
      refreshAttempted: loaded.refreshAttempted,
      refreshSucceeded: loaded.refreshSucceeded,
    } satisfies FreshKlineContextResult;
  })();

  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

export function resetEnsureFreshKlineInflightForTests() {
  inflight.clear();
}
