import fs from "node:fs";
import path from "node:path";
import type {
  AggTradeBucket,
  ExternalSymbolPanel,
  HistoricalMarketDataProvider,
  LiquidationEvent,
  LongShortRatioPoint,
  OiPoint,
  OrderBookSnapshot,
} from "./external-market-data.types";

const FAPI = "https://fapi.binance.com";

async function fetchJson(url: string, retries = 3) {
  for (let i = 0; i < retries; i += 1) {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (res.status === 429) {
      await sleep(1000 * (i + 1));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as unknown;
  }
  throw new Error(`HTTP 429 rate limited: ${url}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class BinanceFuturesMarketDataProvider implements HistoricalMarketDataProvider {
  name = "binance-futures";

  async getKlines(symbol: string, start: number, end: number) {
    const bars: ExternalSymbolPanel["bars"] = [];
    let cursor = start;
    for (let page = 0; page < 30; page += 1) {
      const raw = (await fetchJson(
        `${FAPI}/fapi/v1/klines?symbol=${symbol}&interval=1h&startTime=${cursor}&endTime=${end}&limit=1000`,
      )) as unknown[];
      if (!Array.isArray(raw) || !raw.length) break;
      for (const row of raw) {
        if (!Array.isArray(row)) continue;
        bars.push({
          openTime: Number(row[0]),
          closeTime: Number(row[6]),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5]),
          quoteVolume: Number(row[7]),
          takerBuyQuote: Number(row[10] ?? 0),
        });
      }
      const last = bars.at(-1)?.openTime ?? cursor;
      if (last >= end - 3_600_000 || raw.length < 1000) break;
      cursor = last + 1;
      await sleep(20);
    }
    const dedup = new Map(bars.map((b) => [b.openTime, b]));
    return [...dedup.values()].sort((a, b) => a.openTime - b.openTime);
  }

  async getFunding(symbol: string, start: number, end: number) {
    const rows: Array<{ fundingTime: number; fundingRate: number }> = [];
    let cursor = start;
    for (let page = 0; page < 20; page += 1) {
      const raw = (await fetchJson(
        `${FAPI}/fapi/v1/fundingRate?symbol=${symbol}&startTime=${cursor}&endTime=${end}&limit=1000`,
      )) as Array<Record<string, unknown>>;
      if (!Array.isArray(raw) || !raw.length) break;
      for (const r of raw) rows.push({ fundingTime: Number(r.fundingTime), fundingRate: Number(r.fundingRate) });
      const last = rows.at(-1)?.fundingTime ?? cursor;
      if (last >= end || raw.length < 1000) break;
      cursor = last + 1;
    }
    return rows;
  }

  async getBasis(symbol: string, start: number, end: number) {
    const rows: Array<{ closeTime: number; premium: number }> = [];
    let cursor = start;
    for (let page = 0; page < 30; page += 1) {
      const raw = (await fetchJson(
        `${FAPI}/fapi/v1/premiumIndexKlines?symbol=${symbol}&interval=1h&startTime=${cursor}&endTime=${end}&limit=1000`,
      )) as unknown[];
      if (!Array.isArray(raw) || !raw.length) break;
      for (const row of raw) {
        if (!Array.isArray(row)) continue;
        rows.push({ closeTime: Number(row[6]), premium: Number(row[4]) });
      }
      const lastOpen = Number((raw.at(-1) as unknown[])?.[0] ?? cursor);
      if (lastOpen >= end - 3_600_000 || raw.length < 1000) break;
      cursor = lastOpen + 1;
      await sleep(20);
    }
    return rows;
  }

  async getOpenInterest(symbol: string, start: number, end: number): Promise<OiPoint[]> {
    const rows: OiPoint[] = [];
    const now = Date.now();
    const effectiveEnd = Math.min(end, now);
    const maxLookbackMs = 29 * 24 * 3_600_000;
    let windowEnd = effectiveEnd;
    let windowStart = Math.max(start, effectiveEnd - maxLookbackMs);

    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (windowStart >= windowEnd) break;
      try {
        const raw = (await fetchJson(
          `${FAPI}/futures/data/openInterestHist?symbol=${symbol}&period=1h&startTime=${windowStart}&endTime=${windowEnd}&limit=500`,
        )) as Array<Record<string, unknown>>;
        if (!Array.isArray(raw) || !raw.length || raw[0]?.code) {
          const fallback = (await fetchJson(
            `${FAPI}/futures/data/openInterestHist?symbol=${symbol}&period=1h&startTime=${windowStart}&limit=500`,
          )) as Array<Record<string, unknown>>;
          if (!Array.isArray(fallback) || !fallback.length || fallback[0]?.code) break;
          for (const r of fallback) {
            rows.push({
              timestamp: Number(r.timestamp),
              openInterest: Number(r.sumOpenInterest),
              openInterestValue: Number(r.sumOpenInterestValue ?? 0),
            });
          }
          break;
        }
        for (const r of raw) {
          rows.push({
            timestamp: Number(r.timestamp),
            openInterest: Number(r.sumOpenInterest),
            openInterestValue: Number(r.sumOpenInterestValue ?? 0),
          });
        }
        const earliest = Math.min(...raw.map((r) => Number(r.timestamp)));
        if (earliest <= start || raw.length < 500) break;
        windowEnd = earliest - 1;
        windowStart = Math.max(start, windowEnd - maxLookbackMs);
      } catch {
        break;
      }
      await sleep(50);
    }
    const dedup = new Map(rows.map((r) => [r.timestamp, r]));
    return [...dedup.values()].sort((a, b) => a.timestamp - b.timestamp);
  }

  async getLiquidations(symbol: string, start: number, end: number): Promise<LiquidationEvent[]> {
    const now = Date.now();
    const effectiveEnd = Math.min(end, now);
    const effectiveStart = Math.max(start, effectiveEnd - 7 * 24 * 3_600_000);
    try {
      const raw = (await fetchJson(
        `${FAPI}/fapi/v1/allForceOrders?symbol=${symbol}&startTime=${effectiveStart}&endTime=${effectiveEnd}&limit=1000`,
      )) as Array<Record<string, unknown>>;
      if (!Array.isArray(raw) || !raw.length || raw[0]?.code) return [];
      return raw.map((r) => ({
        timestamp: Number(r.time),
        side: String(r.side) === "BUY" ? "BUY" : "SELL",
        price: Number(r.price),
        qty: Number(r.origQty),
        notional: Number(r.price) * Number(r.origQty),
      }));
    } catch {
      return [];
    }
  }

  async getAggTrades(symbol: string, start: number, end: number): Promise<AggTradeBucket[]> {
    const buckets = new Map<number, AggTradeBucket>();
    const now = Date.now();
    const maxLookbackMs = 2 * 24 * 3_600_000;
    const effectiveEnd = Math.min(end, now);
    let cursor = Math.max(start, effectiveEnd - maxLookbackMs);
    let pages = 0;
    while (cursor < effectiveEnd && pages < 20) {
      try {
        const raw = (await fetchJson(
          `${FAPI}/fapi/v1/aggTrades?symbol=${symbol}&startTime=${cursor}&endTime=${effectiveEnd}&limit=1000`,
        )) as Array<Record<string, unknown>>;
        if (!Array.isArray(raw) || !raw.length || (raw[0] as Record<string, unknown>)?.code) break;
        for (const t of raw) {
          const ts = Number(t.T ?? t.time);
          const bucket = Math.floor(ts / 3_600_000) * 3_600_000;
          const qty = Number(t.q);
          const price = Number(t.p);
          const notional = qty * price;
          const isBuyerMaker = Boolean(t.m);
          const row = buckets.get(bucket) ?? {
            timestamp: bucket,
            aggressiveBuyVolume: 0,
            aggressiveSellVolume: 0,
            delta: 0,
            tradeCount: 0,
            avgTradeSize: 0,
            largeBuyFlow: 0,
            largeSellFlow: 0,
          };
          if (isBuyerMaker) {
            row.aggressiveSellVolume += notional;
            if (notional > 50_000) row.largeSellFlow += notional;
          } else {
            row.aggressiveBuyVolume += notional;
            if (notional > 50_000) row.largeBuyFlow += notional;
          }
          row.delta = row.aggressiveBuyVolume - row.aggressiveSellVolume;
          row.tradeCount += 1;
          row.avgTradeSize = (row.aggressiveBuyVolume + row.aggressiveSellVolume) / row.tradeCount;
          buckets.set(bucket, row);
        }
        const lastTs = Number((raw.at(-1) as Record<string, unknown>)?.T ?? cursor);
        if (lastTs <= cursor) break;
        cursor = lastTs + 1;
        pages += 1;
        await sleep(30);
      } catch {
        break;
      }
    }
    return [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp);
  }

  async getLongShortRatio(symbol: string, start: number, end: number): Promise<LongShortRatioPoint[]> {
    const rows: LongShortRatioPoint[] = [];
    const now = Date.now();
    const effectiveEnd = Math.min(end, now);
    const maxLookbackMs = 29 * 24 * 3_600_000;
    let windowStart = Math.max(start, effectiveEnd - maxLookbackMs);
    try {
      const raw = (await fetchJson(
        `${FAPI}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&startTime=${windowStart}&limit=500`,
      )) as Array<Record<string, unknown>>;
      if (Array.isArray(raw) && raw.length && !raw[0]?.code) {
        for (const r of raw) {
          const ts = Number(r.timestamp);
          if (ts > effectiveEnd) continue;
          rows.push({
            timestamp: ts,
            longShortRatio: Number(r.longShortRatio),
            longAccount: Number(r.longAccount ?? 0),
            shortAccount: Number(r.shortAccount ?? 0),
          });
        }
      }
    } catch {
      return [];
    }
    return rows;
  }

  async getOrderBookSnapshots(): Promise<OrderBookSnapshot[]> {
    return [];
  }
}

export async function buildExternalSymbolPanel(
  provider: HistoricalMarketDataProvider,
  symbol: string,
  start: number,
  end: number,
): Promise<ExternalSymbolPanel> {
  const bars = await provider.getKlines(symbol, start, end);
  await sleep(120);
  const funding = await provider.getFunding(symbol, start, end);
  await sleep(120);
  const basis = await provider.getBasis(symbol, start, end);
  await sleep(120);
  const openInterest = await provider.getOpenInterest(symbol, start, end);
  await sleep(120);
  const liquidations = await provider.getLiquidations(symbol, start, end);
  await sleep(120);
  const aggTrades = await provider.getAggTrades(symbol, start, end);
  await sleep(120);
  const longShortRatio = await provider.getLongShortRatio(symbol, start, end);
  await sleep(120);
  const orderBook = await provider.getOrderBookSnapshots(symbol, start, end);

  const now = Date.now();
  const provenance = [
    {
      source: provider.name,
      symbol,
      venue: "FUTURES",
      timestamp: start,
      receivedAt: now,
      granularity: "1h",
      quality: (bars.length > 48 ? "HIGH" : "LOW") as "HIGH" | "LOW",
    },
  ];

  const availability: ExternalSymbolPanel["availability"] = {
    OHLCV: bars.length >= 48 ? "AVAILABLE" : "UNAVAILABLE",
    FUNDING: funding.length >= 3 ? "AVAILABLE" : "UNAVAILABLE",
    BASIS: basis.length >= 3 ? "AVAILABLE" : "UNAVAILABLE",
    OPEN_INTEREST: openInterest.length >= 24 ? "AVAILABLE" : openInterest.length >= 3 ? "DEGRADED" : "UNAVAILABLE",
    LIQUIDATION: liquidations.length >= 1 ? "AVAILABLE" : "UNAVAILABLE",
    AGG_TRADES: aggTrades.length >= 12 ? "AVAILABLE" : aggTrades.length >= 1 ? "DEGRADED" : "UNAVAILABLE",
    CVD: aggTrades.length >= 12 ? "AVAILABLE" : "UNAVAILABLE",
    LONG_SHORT_RATIO: longShortRatio.length >= 12 ? "AVAILABLE" : longShortRatio.length >= 1 ? "DEGRADED" : "UNAVAILABLE",
    ORDER_BOOK: orderBook.length >= 1 ? "AVAILABLE" : "UNAVAILABLE",
  };

  const cvd = buildCvdSeries(aggTrades);

  return {
    symbol,
    venue: "FUTURES",
    bars: bars.filter((b) => b.closeTime >= start && b.closeTime <= end + 3_600_000),
    funding,
    basis,
    openInterest,
    liquidations,
    aggTrades,
    cvd,
    longShortRatio,
    orderBook,
    availability,
    provenance,
  };
}

export function buildCvdSeries(aggTrades: AggTradeBucket[]) {
  let cvd = 0;
  const series: Array<{ timestamp: number; cvd: number; slope: number; acceleration: number }> = [];
  for (let i = 0; i < aggTrades.length; i += 1) {
    const row = aggTrades[i];
    cvd += row.delta;
    const prevCvd = series.at(-1)?.cvd ?? 0;
    const slope = cvd - prevCvd;
    const prevSlope = series.at(-1)?.slope ?? 0;
    series.push({ timestamp: row.timestamp, cvd, slope, acceleration: slope - prevSlope });
  }
  return series;
}

export function importExternalPanelFromJson(filePath: string): ExternalSymbolPanel {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as ExternalSymbolPanel & {
    external?: { symbol?: string };
    execution?: { symbol?: string; venue?: string };
    executionBarsTRY?: ExternalSymbolPanel["bars"];
    metadata?: Record<string, unknown>;
  };
  if (!raw.symbol && raw.external?.symbol) raw.symbol = raw.external.symbol;
  if (!raw.symbol || !Array.isArray(raw.bars)) {
    throw new Error(`Invalid external panel schema: ${filePath}`);
  }
  raw.cvd = raw.cvd?.length ? raw.cvd : buildCvdSeries(raw.aggTrades ?? []);
  return raw;
}

export function importExternalPanelsFromDir(dir: string): ExternalSymbolPanel[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => importExternalPanelFromJson(path.join(dir, f)));
}

export async function loadExternalUniverse(
  provider: HistoricalMarketDataProvider,
  symbols: string[],
  start: number,
  end: number,
) {
  const panels: ExternalSymbolPanel[] = [];
  for (const symbol of symbols) {
    panels.push(await buildExternalSymbolPanel(provider, symbol, start, end));
    await sleep(80);
  }
  const btc = panels.find((p) => p.symbol === "BTCUSDT")?.bars ?? panels[0]?.bars ?? [];
  return { panels, btc };
}
