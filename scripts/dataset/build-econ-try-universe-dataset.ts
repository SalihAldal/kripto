/**
 * Binance TR tradeable TRY universe — survivorship-aware minute dataset for econ research.
 * Does NOT use post-hoc top-gainer lists for strategy selection.
 *
 * Usage: npx tsx scripts/dataset/build-econ-try-universe-dataset.ts [--days=120] [--maxSymbols=40]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";

const BINANCE_TR = "https://api.binance.me/api/v1";
const SYMBOLS_URL = "https://www.binance.tr/open/v1/common/symbols";
const ROOT = path.join(process.cwd(), "KRIPTO_ECON_TRY_DATASET");
const MS_DAY = 86400000;

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, ...rest] = a.slice(2).split("=");
      return [k, rest.join("=") || "true"];
    }),
);
const DAYS = Number(args.days ?? 120);
const MAX_SYMBOLS = Number(args.maxSymbols ?? 40);
const END = Date.parse("2026-08-31T23:59:59.999Z");
const START = END + 1 - DAYS * MS_DAY;

type Bar = {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  takerBuyQuote: number;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getJson(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

function resampleHourly(minute: Bar[]): Bar[] {
  const buckets = new Map<number, Bar[]>();
  for (const b of minute) {
    const hourOpen = Math.floor(b.openTime / 3600000) * 3600000;
    const list = buckets.get(hourOpen) ?? [];
    list.push(b);
    buckets.set(hourOpen, list);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hourOpen, rows]) => {
      const open = rows[0].open;
      const close = rows[rows.length - 1].close;
      const high = Math.max(...rows.map((r) => r.high));
      const low = Math.min(...rows.map((r) => r.low));
      const volume = rows.reduce((s, r) => s + r.volume, 0);
      const quoteVolume = rows.reduce((s, r) => s + r.quoteVolume, 0);
      const takerBuyQuote = rows.reduce((s, r) => s + r.takerBuyQuote, 0);
      return {
        openTime: hourOpen,
        closeTime: hourOpen + 3600000 - 1,
        open,
        high,
        low,
        close,
        volume,
        quoteVolume,
        takerBuyQuote,
      };
    });
}

async function fetchTryMinutes(symbol: string) {
  const bars: Bar[] = [];
  let cursor = START;
  while (cursor < END) {
    const url = `${BINANCE_TR}/klines?symbol=${symbol}&interval=1m&startTime=${cursor}&endTime=${END}&limit=1000`;
    const raw = (await getJson(url)) as unknown[];
    if (!Array.isArray(raw) || raw.length === 0) break;
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
    const lastOpen = Number((raw.at(-1) as unknown[])?.[0] ?? cursor);
    if (lastOpen >= END - 60_000) break;
    cursor = lastOpen + 60_000;
    await sleep(150);
  }
  const dedup = new Map(bars.map((b) => [b.openTime, b]));
  return [...dedup.values()].sort((a, b) => a.openTime - b.openTime);
}

function writeCsvGz(filePath: string, bars: Bar[]) {
  const header = "openTime,closeTime,open,high,low,close,volume,quoteVolume,takerBuyQuote";
  const rows = bars.map(
    (b) => `${b.openTime},${b.closeTime},${b.open},${b.high},${b.low},${b.close},${b.volume},${b.quoteVolume},${b.takerBuyQuote}`,
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, zlib.gzipSync([header, ...rows].join("\n")));
}

async function screenLiquidity(trySymbol: string) {
  const url = `${BINANCE_TR}/klines?symbol=${trySymbol}&interval=1d&startTime=${END - 30 * MS_DAY}&endTime=${END}&limit=30`;
  try {
    const rows = (await getJson(url)) as unknown[];
    if (!Array.isArray(rows) || rows.length < 20) return { trySymbol, avgQuoteTry: 0, activeDays: 0 };
    const quotes = rows.map((r) => Number((r as unknown[])[7])).filter((q) => q > 0);
    return { trySymbol, avgQuoteTry: quotes.reduce((a, b) => a + b, 0) / quotes.length, activeDays: quotes.length };
  } catch {
    return { trySymbol, avgQuoteTry: 0, activeDays: 0 };
  }
}

async function main() {
  fs.mkdirSync(ROOT, { recursive: true });
  const symbolsResp = await getJson(SYMBOLS_URL);
  const assets = (symbolsResp?.data?.list ?? []).filter(
    (x: { quoteAsset?: string; type?: number }) => x.quoteAsset === "TRY" && x.type === 1,
  );
  if (!assets.length) throw new Error("EMPTY_TR_UNIVERSE");

  const screened = [];
  for (const asset of assets) {
    const trySymbol = String(asset.symbol).replace("_", "");
    screened.push(await screenLiquidity(trySymbol));
    await sleep(80);
  }
  screened.sort((a, b) => b.avgQuoteTry - a.avgQuoteTry);
  const selected = screened.filter((s) => s.activeDays >= 20 && s.avgQuoteTry >= 100_000).slice(0, MAX_SYMBOLS);
  console.log(`SCREENED ${screened.length} pairs; building ${selected.length}`);

  const mapping: Array<{ baseAsset: string; externalSymbol: string; executionSymbol: string }> = [];
  const survivorship: Array<Record<string, unknown>> = [];

  for (const row of selected) {
    const trySymbol = row.trySymbol;
    const base = trySymbol.replace("TRY", "");
    const externalSymbol = `${base}USDT`;
    console.log(`FETCH ${trySymbol}...`);
    const minutes = await fetchTryMinutes(trySymbol);
    const hourly = resampleHourly(minutes);
    const expectedMinutes = DAYS * 24 * 60;
    const coveragePct = (minutes.length / expectedMinutes) * 100;
    const firstBar = minutes[0]?.openTime ?? null;
    const listingBias = firstBar && firstBar > START + 7 * MS_DAY ? "LATE_LISTING_IN_WINDOW" : "FULL_WINDOW_ASSUMED";
    survivorship.push({
      trySymbol,
      baseAsset: base,
      coveragePct,
      minuteBars: minutes.length,
      hourlyBars: hourly.length,
      firstBarAt: firstBar,
      listingBias,
      avgDailyQuoteTry: row.avgQuoteTry,
      missingMinuteEstimate: Math.max(0, expectedMinutes - minutes.length),
    });
    if (coveragePct < 85) {
      console.log(`SKIP ${trySymbol} coverage=${coveragePct.toFixed(1)}%`);
      continue;
    }

    const panelDir = path.join(ROOT, "deep-oi-data");
    const parquetDir = path.join(ROOT, "parquet");
    fs.mkdirSync(panelDir, { recursive: true });
    fs.mkdirSync(parquetDir, { recursive: true });
    const gzRel = `parquet/${externalSymbol}-try-1m.csv.gz`;
    writeCsvGz(path.join(ROOT, gzRel), minutes);
    const panel = {
      symbol: externalSymbol,
      baseAsset: base,
      execution: { symbol: trySymbol, venue: "BINANCE_TR", quote: "TRY" },
      bars: hourly.map((b) => ({
        openTime: b.openTime,
        closeTime: b.closeTime,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
        quoteVolume: b.quoteVolume,
      })),
      openInterest: [],
      funding: [],
      files: { executionBarsTRY: gzRel },
      dataSource: "TRY_ONLY_NO_UM_OI",
    };
    fs.writeFileSync(path.join(panelDir, `${externalSymbol}.json`), JSON.stringify(panel));
    mapping.push({ baseAsset: base, externalSymbol, executionSymbol: trySymbol });
  }

  const manifest = {
    datasetName: "KRIPTO_ECON_TRY_DATASET",
    schemaVersion: "1.0",
    start: new Date(START).toISOString(),
    end: new Date(END).toISOString(),
    days: DAYS,
    symbols: mapping.map((m) => m.externalSymbol),
    executionVenue: "BINANCE_TR",
    executionQuote: "TRY",
    externalVenue: "TRY_HOURLY_RESAMPLED",
    survivorshipWarnings: [
      "CURRENT_TR_LISTING_NOT_POINT_IN_TIME",
      "DELISTED_PAIRS_EXCLUDED",
      "LIQUIDITY_SCREEN_USES_RECENT_30D_ONLY",
    ],
    sources: {
      klines: { source: "api.binance.me", interval: "1m", license: "Binance public API" },
      symbols: { source: "www.binance.tr/open/v1/common/symbols" },
    },
    survivorship,
    builtAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(ROOT, "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(ROOT, "asset-mapping.json"), JSON.stringify(mapping, null, 2));
  const checksum = crypto.createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  fs.writeFileSync(path.join(ROOT, "checksum.json"), JSON.stringify({ manifest: checksum, files: mapping.length }, null, 2));
  console.log(`DONE ${ROOT} symbols=${mapping.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
