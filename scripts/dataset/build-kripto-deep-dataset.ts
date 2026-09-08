/**
 * KRIPTO Deep Historical Dataset Builder
 * Usage: npx tsx scripts/dataset/build-kripto-deep-dataset.ts
 *
 * Sources (free/public only):
 * - data.binance.vision: futures UM metrics (OI 5m), funding, premiumIndexKlines, klines
 * - api.binance.me: Binance TR TRY spot 1m klines
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { execSync } from "node:child_process";
import AdmZip from "adm-zip";

const MS_DAY = 24 * 3_600_000;
const VISION = "https://data.binance.vision/data/futures/um";
const BINANCE_TR = "https://api.binance.me/api/v1";

const PERIOD_START = Date.parse("2025-09-01T00:00:00.000Z");
const PERIOD_END = Date.parse("2026-08-31T23:59:59.999Z");
const PERIOD_DAYS = Math.round((PERIOD_END - PERIOD_START + 1) / MS_DAY);

const ROOT = path.join(process.cwd(), "KRIPTO_DEEP_DATASET");
const DEEP_OI_DIR = path.join(ROOT, "deep-oi-data");
const PARQUET_DIR = path.join(ROOT, "parquet");
const CONTEXT_DIR = path.join(ROOT, "market-context");

type AssetMapping = {
  baseAsset: string;
  externalSymbol: string;
  externalVenue: "BINANCE_USDT_PERPETUAL";
  executionSymbol: string;
  executionVenue: "BINANCE_TR";
  executionQuote: "TRY";
};

const CANDIDATES: AssetMapping[] = [
  { baseAsset: "BTC", externalSymbol: "BTCUSDT", externalVenue: "BINANCE_USDT_PERPETUAL", executionSymbol: "BTCTRY", executionVenue: "BINANCE_TR", executionQuote: "TRY" },
  { baseAsset: "ETH", externalSymbol: "ETHUSDT", externalVenue: "BINANCE_USDT_PERPETUAL", executionSymbol: "ETHTRY", executionVenue: "BINANCE_TR", executionQuote: "TRY" },
  { baseAsset: "SOL", externalSymbol: "SOLUSDT", externalVenue: "BINANCE_USDT_PERPETUAL", executionSymbol: "SOLTRY", executionVenue: "BINANCE_TR", executionQuote: "TRY" },
  { baseAsset: "BNB", externalSymbol: "BNBUSDT", externalVenue: "BINANCE_USDT_PERPETUAL", executionSymbol: "BNBTRY", executionVenue: "BINANCE_TR", executionQuote: "TRY" },
  { baseAsset: "XRP", externalSymbol: "XRPUSDT", externalVenue: "BINANCE_USDT_PERPETUAL", executionSymbol: "XRPTRY", executionVenue: "BINANCE_TR", executionQuote: "TRY" },
  { baseAsset: "DOGE", externalSymbol: "DOGEUSDT", externalVenue: "BINANCE_USDT_PERPETUAL", executionSymbol: "DOGETRY", executionVenue: "BINANCE_TR", executionQuote: "TRY" },
  { baseAsset: "ADA", externalSymbol: "ADAUSDT", externalVenue: "BINANCE_USDT_PERPETUAL", executionSymbol: "ADATRY", executionVenue: "BINANCE_TR", executionQuote: "TRY" },
  { baseAsset: "AVAX", externalSymbol: "AVAXUSDT", externalVenue: "BINANCE_USDT_PERPETUAL", executionSymbol: "AVAXTRY", executionVenue: "BINANCE_TR", executionQuote: "TRY" },
  { baseAsset: "LINK", externalSymbol: "LINKUSDT", externalVenue: "BINANCE_USDT_PERPETUAL", executionSymbol: "LINKTRY", executionVenue: "BINANCE_TR", executionQuote: "TRY" },
  { baseAsset: "SUI", externalSymbol: "SUIUSDT", externalVenue: "BINANCE_USDT_PERPETUAL", executionSymbol: "SUITRY", executionVenue: "BINANCE_TR", executionQuote: "TRY" },
];

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

type OiPoint = { timestamp: number; openInterest: number };
type FundingPoint = { fundingTime: number; fundingRate: number };
type BasisPoint = { closeTime: number; premium: number };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function monthKeys(start: number, end: number) {
  const keys = new Set<string>();
  const cur = new Date(start);
  cur.setUTCDate(1);
  while (cur.getTime() <= end) {
    keys.add(`${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}`);
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return [...keys];
}

function dayKeys(start: number, end: number) {
  const keys: string[] = [];
  let t = start;
  while (t <= end) {
    keys.push(fmtDate(new Date(t)));
    t += MS_DAY;
  }
  return keys;
}

async function fetchBuffer(url: string, retries = 3): Promise<Buffer | null> {
  for (let i = 0; i < retries; i += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch {
      await sleep(500 * (i + 1));
    }
  }
  return null;
}

function parseCsv(text: string) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0]?.split(",") ?? [];
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = line.split(",");
    const row: Record<string, string> = {};
    header.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return row;
  });
}

function extractZipCsv(buf: Buffer): string {
  const zip = new AdmZip(buf);
  const entry = zip.getEntries().find((e) => e.entryName.endsWith(".csv"));
  if (!entry) throw new Error("No CSV in zip");
  return entry.getData().toString("utf8");
}

async function downloadVisionZipCsv(url: string): Promise<Record<string, string>[] | null> {
  const buf = await fetchBuffer(url);
  if (!buf) return null;
  return parseCsv(extractZipCsv(buf));
}

async function poolMap<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx;
      idx += 1;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

async function downloadOiMetrics(symbol: string, days: string[]) {
  const rows: OiPoint[] = [];
  let missing = 0;
  await poolMap(days, 10, async (day) => {
    const url = `${VISION}/daily/metrics/${symbol}/${symbol}-metrics-${day}.zip`;
    const parsed = await downloadVisionZipCsv(url);
    if (!parsed) {
      missing += 1;
      return;
    }
    for (const r of parsed) {
      const ts = Date.parse(r.create_time.replace(" ", "T") + "Z");
      if (ts < PERIOD_START || ts > PERIOD_END) continue;
      rows.push({ timestamp: ts, openInterest: Number(r.sum_open_interest) });
    }
  });
  const dedup = new Map(rows.map((r) => [r.timestamp, r]));
  return { openInterest: [...dedup.values()].sort((a, b) => a.timestamp - b.timestamp), missingDays: missing };
}

async function downloadMonthlyFunding(symbol: string, months: string[]) {
  const rows: FundingPoint[] = [];
  for (const m of months) {
    const url = `${VISION}/monthly/fundingRate/${symbol}/${symbol}-fundingRate-${m}.zip`;
    const parsed = await downloadVisionZipCsv(url);
    if (!parsed) continue;
    for (const r of parsed) {
      const ts = Number(r.calc_time);
      if (ts < PERIOD_START || ts > PERIOD_END) continue;
      rows.push({ fundingTime: ts, fundingRate: Number(r.last_funding_rate) });
    }
    await sleep(50);
  }
  const dedup = new Map(rows.map((r) => [r.fundingTime, r]));
  return [...dedup.values()].sort((a, b) => a.fundingTime - b.fundingTime);
}

async function downloadMonthlyPremium(symbol: string, months: string[]) {
  const rows: BasisPoint[] = [];
  for (const m of months) {
    const url = `${VISION}/monthly/premiumIndexKlines/${symbol}/1h/${symbol}-1h-${m}.zip`;
    const parsed = await downloadVisionZipCsv(url);
    if (!parsed) continue;
    for (const r of parsed) {
      const openTime = Number(r.open_time ?? r.openTime);
      const closeTime = Number(r.close_time ?? r.closeTime);
      if (closeTime < PERIOD_START || openTime > PERIOD_END) continue;
      rows.push({ closeTime, premium: Number(r.close) });
    }
    await sleep(50);
  }
  const dedup = new Map(rows.map((r) => [r.closeTime, r]));
  return [...dedup.values()].sort((a, b) => a.closeTime - b.closeTime);
}

async function downloadMonthlyKlines(symbol: string, months: string[]) {
  const rows: Bar[] = [];
  for (const m of months) {
    const url = `${VISION}/monthly/klines/${symbol}/1h/${symbol}-1h-${m}.zip`;
    const parsed = await downloadVisionZipCsv(url);
    if (!parsed) continue;
    for (const r of parsed) {
      const openTime = Number(r.open_time ?? r.openTime);
      const closeTime = Number(r.close_time ?? r.closeTime);
      if (closeTime < PERIOD_START || openTime > PERIOD_END) continue;
      rows.push({
        openTime,
        closeTime,
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume),
        quoteVolume: Number(r.quote_volume ?? r.quoteVolume),
        takerBuyQuote: Number(r.taker_buy_quote_volume ?? r.takerBuyQuote ?? 0),
      });
    }
    await sleep(50);
  }
  const dedup = new Map(rows.map((r) => [r.openTime, r]));
  return [...dedup.values()].sort((a, b) => a.openTime - b.openTime);
}

async function downloadTryKlines(symbol: string) {
  const bars: Bar[] = [];
  let cursor = PERIOD_START;
  let pages = 0;
  while (cursor < PERIOD_END) {
    const url = `${BINANCE_TR}/klines?symbol=${symbol}&interval=1m&startTime=${cursor}&endTime=${PERIOD_END}&limit=1000`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Binance TR klines HTTP ${res.status} ${symbol}`);
    const raw = (await res.json()) as unknown[];
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
    if (lastOpen >= PERIOD_END - 60_000) break;
    cursor = lastOpen + 60_000;
    pages += 1;
    if (pages % 50 === 0) console.log(`  ${symbol} TRY pages=${pages} bars=${bars.length}`);
    await sleep(120);
  }
  const dedup = new Map(bars.map((b) => [b.openTime, b]));
  return [...dedup.values()].sort((a, b) => a.openTime - b.openTime);
}

function writeCsvGz(filePath: string, header: string, rows: string[]) {
  const body = [header, ...rows].join("\n");
  fs.writeFileSync(filePath, zlib.gzipSync(body));
}

function barsToCsvRows(bars: Bar[]) {
  return bars.map(
    (b) =>
      `${b.openTime},${b.closeTime},${b.open},${b.high},${b.low},${b.close},${b.volume},${b.quoteVolume},${b.takerBuyQuote}`,
  );
}

function coveragePct(actual: number, expected: number) {
  if (expected <= 0) return 0;
  return Math.min(100, (actual / expected) * 100);
}

function qaSymbol(input: {
  symbol: string;
  bars: Bar[];
  executionBars: Bar[];
  openInterest: OiPoint[];
  funding: FundingPoint[];
  missingOiDays: number;
}) {
  const expectedOi = (PERIOD_DAYS - input.missingOiDays) * 288;
  const expectedBars = PERIOD_DAYS * 24;
  const expectedTry = PERIOD_DAYS * 24 * 60;
  const expectedFunding = PERIOD_DAYS * 3;
  const oiCov = coveragePct(input.openInterest.length, expectedOi);
  const barCov = coveragePct(input.bars.length, expectedBars);
  const tryCov = coveragePct(input.executionBars.length, expectedTry);
  const fundCov = coveragePct(input.funding.length, expectedFunding);
  const dupOi = input.openInterest.length - new Set(input.openInterest.map((o) => o.timestamp)).size;
  const invalidOi = input.openInterest.filter((o) => !Number.isFinite(o.openInterest) || o.openInterest <= 0).length;
  const pass = oiCov >= 90 && barCov >= 98 && tryCov >= 98 && fundCov >= 95 && dupOi === 0 && invalidOi === 0;
  const grade = pass ? (oiCov >= 95 && tryCov >= 99 ? "A" : "B") : oiCov >= 80 ? "C" : "FAIL";
  return { oiCov, barCov, tryCov, fundCov, dupOi, invalidOi, pass, grade };
}

function oiStateCounts(bars: Bar[], oi: OiPoint[]) {
  const counts = { PRICE_UP_OI_UP: 0, PRICE_UP_OI_DOWN: 0, PRICE_DOWN_OI_UP: 0, PRICE_DOWN_OI_DOWN: 0 };
  const oiMap = new Map(oi.map((o) => [o.timestamp, o.openInterest]));
  for (let i = 24; i < bars.length; i += 4) {
    const b = bars[i];
    const prev = bars[i - 4];
    if (!b || !prev) continue;
    const priceRet = ((b.close - prev.close) / prev.close) * 100;
    const oiNow = [...oiMap.keys()].filter((t) => t <= b.closeTime).at(-1);
    const oiPrev = [...oiMap.keys()].filter((t) => t <= prev.closeTime).at(-1);
    if (oiNow === undefined || oiPrev === undefined) continue;
    const oiRet = ((oiMap.get(oiNow)! - oiMap.get(oiPrev)!) / oiMap.get(oiPrev)!) * 100;
    if (Math.abs(priceRet) < 0.05 || Math.abs(oiRet) < 0.05) continue;
    if (priceRet > 0 && oiRet > 0) counts.PRICE_UP_OI_UP += 1;
    else if (priceRet > 0) counts.PRICE_UP_OI_DOWN += 1;
    else if (oiRet > 0) counts.PRICE_DOWN_OI_UP += 1;
    else counts.PRICE_DOWN_OI_DOWN += 1;
  }
  return counts;
}

async function verifyTryPair(symbol: string) {
  const r = await fetch(`${BINANCE_TR}/klines?symbol=${symbol}&interval=1m&startTime=${PERIOD_START}&limit=1`);
  const j = (await r.json()) as unknown[];
  return Array.isArray(j) && j.length > 0;
}

async function main() {
  console.log(`Building KRIPTO deep dataset ${fmtDate(new Date(PERIOD_START))} → ${fmtDate(new Date(PERIOD_END))} (${PERIOD_DAYS}d)`);
  fs.mkdirSync(DEEP_OI_DIR, { recursive: true });
  fs.mkdirSync(PARQUET_DIR, { recursive: true });
  fs.mkdirSync(CONTEXT_DIR, { recursive: true });

  const months = monthKeys(PERIOD_START, PERIOD_END);
  const days = dayKeys(PERIOD_START, PERIOD_END);

  const mapping: AssetMapping[] = [];
  for (const c of CANDIDATES) {
    const ok = await verifyTryPair(c.executionSymbol);
    if (ok) mapping.push(c);
    else console.warn(`SKIP ${c.baseAsset}: ${c.executionSymbol} not executable on Binance TR`);
    await sleep(50);
  }
  fs.writeFileSync(path.join(ROOT, "asset-mapping.json"), JSON.stringify(mapping, null, 2));

  const sources: Record<string, unknown> = {
    "openInterest": { source: "data.binance.vision", url: `${VISION}/daily/metrics/`, license: "Binance public data", interval: "5m", unit: "CONTRACTS", retrievedAt: new Date().toISOString() },
    "funding": { source: "data.binance.vision", url: `${VISION}/monthly/fundingRate/`, license: "Binance public data", rateUnit: "fraction", retrievedAt: new Date().toISOString() },
    "basis": { source: "data.binance.vision", url: `${VISION}/monthly/premiumIndexKlines/1h/`, license: "Binance public data", note: "premium index close", retrievedAt: new Date().toISOString() },
    "externalBars": { source: "data.binance.vision", url: `${VISION}/monthly/klines/1h/`, license: "Binance public data", interval: "1h", retrievedAt: new Date().toISOString() },
    "executionBarsTRY": { source: "api.binance.me", url: `${BINANCE_TR}/klines`, license: "Binance TR public API", interval: "1m", retrievedAt: new Date().toISOString() },
    "aggTrades": { status: "UNAVAILABLE", reason: "365d aggTrades per symbol exceeds practical free download size (multi-GB per symbol on data.binance.vision)" },
    "liquidations": { status: "UNAVAILABLE", reason: "Binance UM liquidationSnapshot discontinued after 2024-03-31; no public historical source for Sep2025-Aug2026" },
    "orderBook": { status: "UNAVAILABLE", reason: "No free public historical L2 archive for Binance UM futures" },
  };

  const qaReport: Record<string, unknown> = {};
  const symbolSummaries: Array<Record<string, unknown>> = [];

  for (const asset of mapping) {
    console.log(`\n=== ${asset.baseAsset} (${asset.externalSymbol} / ${asset.executionSymbol}) ===`);
    const [openInterestPack, funding, basis, bars, executionBars] = await Promise.all([
      downloadOiMetrics(asset.externalSymbol, days),
      downloadMonthlyFunding(asset.externalSymbol, months),
      downloadMonthlyPremium(asset.externalSymbol, months),
      downloadMonthlyKlines(asset.externalSymbol, months),
      downloadTryKlines(asset.executionSymbol),
    ]);

    const qa = qaSymbol({
      symbol: asset.externalSymbol,
      bars,
      executionBars,
      openInterest: openInterestPack.openInterest,
      funding,
      missingOiDays: openInterestPack.missingDays,
    });
    qaReport[asset.externalSymbol] = qa;

    const tryFile = `${asset.executionSymbol}-bars-1m.csv.gz`;
    const extBarsFile = `${asset.externalSymbol}-bars-1h.csv.gz`;
    const oiFile = `${asset.externalSymbol}-oi-5m.csv.gz`;
    const fundFile = `${asset.externalSymbol}-funding.csv.gz`;

    writeCsvGz(
      path.join(PARQUET_DIR, tryFile),
      "openTime,closeTime,open,high,low,close,volume,quoteVolume,takerBuyQuote",
      barsToCsvRows(executionBars),
    );
    writeCsvGz(path.join(PARQUET_DIR, extBarsFile), "openTime,closeTime,open,high,low,close,volume,quoteVolume,takerBuyQuote", barsToCsvRows(bars));
    writeCsvGz(
      path.join(PARQUET_DIR, oiFile),
      "timestamp,openInterest",
      openInterestPack.openInterest.map((o) => `${o.timestamp},${o.openInterest}`),
    );
    writeCsvGz(
      path.join(PARQUET_DIR, fundFile),
      "fundingTime,fundingRate",
      funding.map((f) => `${f.fundingTime},${f.fundingRate}`),
    );

    const panel = {
      schemaVersion: "1.0",
      symbol: asset.externalSymbol,
      baseAsset: asset.baseAsset,
      external: { symbol: asset.externalSymbol, venue: asset.externalVenue },
      execution: { symbol: asset.executionSymbol, venue: asset.executionVenue, quoteAsset: asset.executionQuote },
      coverage: { start: new Date(PERIOD_START).toISOString(), end: new Date(PERIOD_END).toISOString(), days: PERIOD_DAYS },
      bars,
      executionBarsTRY: [],
      funding,
      basis,
      openInterest: openInterestPack.openInterest,
      aggTrades: [],
      liquidations: [],
      files: {
        externalBars: `parquet/${extBarsFile}`,
        executionBarsTRY: `parquet/${tryFile}`,
        openInterest: `parquet/${oiFile}`,
        funding: `parquet/${fundFile}`,
      },
      metadata: {
        oiInterval: "5m",
        oiUnit: "CONTRACTS",
        externalBarInterval: "1h",
        executionBarInterval: "1m",
        fundingRateUnit: "fraction",
        aggTrades: "UNAVAILABLE",
        liquidations: "UNAVAILABLE",
        orderBook: "UNAVAILABLE",
        missingOiDays: openInterestPack.missingDays,
        qa,
        oiStateCounts: oiStateCounts(bars, openInterestPack.openInterest),
      },
    };

    fs.writeFileSync(path.join(DEEP_OI_DIR, `${asset.externalSymbol}.json`), JSON.stringify(panel));
    symbolSummaries.push({
      baseAsset: asset.baseAsset,
      externalSymbol: asset.externalSymbol,
      executionSymbol: asset.executionSymbol,
      qa,
      records: {
        bars: bars.length,
        executionBarsTRY: executionBars.length,
        openInterest: openInterestPack.openInterest.length,
        funding: funding.length,
        basis: basis.length,
      },
    });
    console.log(`QA ${asset.externalSymbol}: grade=${qa.grade} OI=${qa.oiCov.toFixed(1)}% TRY=${qa.tryCov.toFixed(1)}%`);
  }

  console.log("\n=== Market context: USDTTRY ===");
  const usdtTry = await downloadTryKlines("USDTTRY");
  writeCsvGz(
    path.join(CONTEXT_DIR, "USDTTRY-bars-1m.csv.gz"),
    "openTime,closeTime,open,high,low,close,volume,quoteVolume,takerBuyQuote",
    barsToCsvRows(usdtTry),
  );
  fs.writeFileSync(
    path.join(CONTEXT_DIR, "USDTTRY.json"),
    JSON.stringify({
      symbol: "USDTTRY",
      venue: "BINANCE_TR",
      coverage: { start: new Date(PERIOD_START).toISOString(), end: new Date(PERIOD_END).toISOString(), days: PERIOD_DAYS },
      files: { bars: "USDTTRY-bars-1m.csv.gz" },
      barCount: usdtTry.length,
    }),
  );

  const allPass = Object.values(qaReport).every((q) => (q as { pass: boolean }).pass);
  const manifest = {
    datasetName: "KRIPTO_DEEP_OI_DATASET",
    schemaVersion: "1.0",
    start: new Date(PERIOD_START).toISOString(),
    end: new Date(PERIOD_END).toISOString(),
    days: PERIOD_DAYS,
    symbols: mapping.map((m) => m.externalSymbol),
    executionVenue: "BINANCE_TR",
    executionQuote: "TRY",
    externalVenue: "BINANCE_USDT_PERPETUAL",
    sources,
    coverage: qaReport,
    datasetGate: allPass && PERIOD_DAYS >= 120 ? "PASS" : PERIOD_DAYS >= 120 ? "PARTIAL" : "FAIL",
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(ROOT, "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(ROOT, "sources.json"), JSON.stringify(sources, null, 2));
  fs.writeFileSync(path.join(ROOT, "data-quality.json"), JSON.stringify({ symbols: qaReport, summaries: symbolSummaries }, null, 2));

  const report = buildDatasetReport(manifest, symbolSummaries, mapping);
  fs.writeFileSync(path.join(ROOT, "DATASET_REPORT.md"), report);

  const checksums: string[] = [];
  function walk(dir: string) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else {
        const hash = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
        checksums.push(`${hash}  ${path.relative(ROOT, p).replace(/\\/g, "/")}`);
      }
    }
  }
  walk(ROOT);
  fs.writeFileSync(path.join(ROOT, "checksums.sha256"), checksums.sort().join("\n") + "\n");

  const zipPath = path.join(process.cwd(), "KRIPTO_DEEP_OI_DATASET.zip");
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  execSync(`powershell -Command "Compress-Archive -Path '${ROOT}\\*' -DestinationPath '${zipPath}' -Force"`, { stdio: "inherit" });

  const zipSize = fs.statSync(zipPath).size;
  let uncompressed = 0;
  function sizeWalk(d: string) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) sizeWalk(p);
      else uncompressed += fs.statSync(p).size;
    }
  }
  sizeWalk(ROOT);

  console.log("\n=== DONE ===");
  console.log(JSON.stringify({ datasetGate: manifest.datasetGate, days: PERIOD_DAYS, symbols: mapping.length, zipPath, zipSizeMB: (zipSize / 1e6).toFixed(2), uncompressedMB: (uncompressed / 1e6).toFixed(2) }, null, 2));
}

function buildDatasetReport(manifest: Record<string, unknown>, summaries: Array<Record<string, unknown>>, mapping: AssetMapping[]) {
  return `# KRIPTO Deep Historical Dataset Report

## Period
- Start: ${manifest.start}
- End: ${manifest.end}
- Days: ${manifest.days}
- Gate: **${manifest.datasetGate}**

## Architecture
- External signal: Binance USDT Perpetual (OI, funding, basis, 1h OHLCV)
- Execution replay: Binance TR TRY spot 1m OHLCV
- **EXTERNAL_DATA_VENUE != EXECUTION_VENUE**

## Symbols (${mapping.length})
${mapping.map((m) => `- ${m.baseAsset}: ${m.externalSymbol} → ${m.executionSymbol}`).join("\n")}

## Sources
| Field | Source | Interval | Notes |
|-------|--------|----------|-------|
| Open Interest | data.binance.vision daily metrics | 5m | CONTRACTS unit |
| Funding | data.binance.vision monthly fundingRate | event | fraction |
| Basis/Premium | data.binance.vision premiumIndexKlines | 1h | official premium index |
| External bars | data.binance.vision futures klines | 1h | signal context |
| TRY execution | api.binance.me klines | 1m | **profitability replay** |
| AggTrades | UNAVAILABLE | — | multi-GB per symbol |
| Liquidations | UNAVAILABLE | — | UM snapshots discontinued |
| Order book | UNAVAILABLE | — | no free L2 archive |

## Per-symbol QA
${summaries.map((s) => `- **${s.externalSymbol}** grade=${(s.qa as { grade: string }).grade} OI=${(s.qa as { oiCov: number }).oiCov.toFixed(1)}% TRY=${(s.qa as { tryCov: number }).tryCov.toFixed(1)}% records=${JSON.stringify(s.records)}`).join("\n")}

## Known limitations
- AggTrades, liquidations, order book not included (no free complete public history for this period).
- Large TRY 1m series stored as \`parquet/*.csv.gz\` (gzip CSV); referenced from symbol JSON \`files\` field.
- Importer-compatible \`deep-oi-data/*.json\` includes inline OI/funding/basis + \`symbol\` root field.

## License / access
All sources are Binance public data archives and Binance TR public REST API. No paid API keys used.

---
Generated: ${new Date().toISOString()}
`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
