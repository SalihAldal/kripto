import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { importExternalPanelFromJson } from "@/src/server/alpha-engine-v2/external-market-data-provider.service";
import type { ExternalSymbolPanel } from "@/src/server/alpha-engine-v2/external-market-data.types";
import type { TryBar } from "./types";

export type TrySpotPanel = ExternalSymbolPanel & {
  baseAsset: string;
  executionSymbol: string;
  executionBarsTRY: TryBar[];
};

export function resolveDatasetRoot(): string {
  const envDir = process.env.DEEP_OI_DATA_DIR;
  if (envDir) {
    const base = path.basename(envDir);
    if (base === "deep-oi-data") return path.dirname(envDir);
    return envDir;
  }
  for (const candidate of [
    path.join(process.cwd(), "KRIPTO_DEEP_DATASET"),
    path.join(process.cwd(), "artifacts", "KRIPTO_DEEP_DATASET"),
  ]) {
    if (fs.existsSync(path.join(candidate, "manifest.json"))) return candidate;
  }
  throw new Error("KRIPTO_DEEP_DATASET not found; set DEEP_OI_DATA_DIR or extract ZIP");
}

function parseCsvGz(filePath: string): TryBar[] {
  const raw = zlib.gunzipSync(fs.readFileSync(filePath)).toString("utf8");
  const lines = raw.trim().split(/\r?\n/);
  const header = lines[0]?.split(",") ?? [];
  const columns = new Map(header.map((name,i) => [name,i]));
  for(const name of ["openTime","closeTime","open","high","low","close","volume","quoteVolume"]) {
    if(!columns.has(name)) throw new Error(`DATASET_COLUMN_MISSING:${name}:${filePath}`);
  }
  const idx = (name: string) => columns.get(name) ?? -1;
  const bars: TryBar[] = [];
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const cols = line.split(",");
    bars.push({
      openTime: Number(cols[idx("openTime")]),
      closeTime: Number(cols[idx("closeTime")]),
      open: Number(cols[idx("open")]),
      high: Number(cols[idx("high")]),
      low: Number(cols[idx("low")]),
      close: Number(cols[idx("close")]),
      volume: Number(cols[idx("volume")]),
      quoteVolume: Number(cols[idx("quoteVolume")]),
      takerBuyQuote: Number(cols[idx("takerBuyQuote")] ?? 0),
    });
  }
  for(let i=0;i<bars.length;i++) {
    const b=bars[i];
    if(!Object.values(b).every(Number.isFinite) || b.open<=0 || b.close<=0 || b.low<=0 || b.high<Math.max(b.open,b.close) || b.low>Math.min(b.open,b.close) || b.volume<0 || b.quoteVolume<0 || b.closeTime<b.openTime || (i>0 && b.openTime<=bars[i-1].openTime)) throw new Error(`INVALID_TRY_BAR:${filePath}:${i}`);
  }
  return bars;
}

const panelCache = new Map<string, TrySpotPanel>();

export function loadTrySpotPanel(symbol: string, root = resolveDatasetRoot()): TrySpotPanel {
  const key = `${root}:${symbol}`;
  const cached = panelCache.get(key);
  if (cached) return cached;
  const jsonPath = path.join(root, "deep-oi-data", `${symbol}.json`);
  const raw = importExternalPanelFromJson(jsonPath) as TrySpotPanel & {
    files?: { executionBarsTRY?: string };
    execution?: { symbol?: string };
  };
  const panel = raw;
  panel.baseAsset = raw.baseAsset ?? symbol.replace("USDT", "");
  panel.executionSymbol = raw.execution?.symbol ?? `${panel.baseAsset}TRY`;
  if (Array.isArray(raw.executionBarsTRY) && raw.executionBarsTRY.length > 0) {
    panel.executionBarsTRY = raw.executionBarsTRY;
  } else if (raw.files?.executionBarsTRY) {
    const gzPath = path.join(root, raw.files.executionBarsTRY.replace(/^parquet\//, "parquet/"));
    panel.executionBarsTRY = parseCsvGz(gzPath);
  } else {
    throw new Error(`No TRY execution bars for ${symbol}`);
  }
  panelCache.set(key, panel);
  return panel;
}

export function loadTrySpotUniverse(symbols: string[], root = resolveDatasetRoot()) {
  return symbols.map((s) => loadTrySpotPanel(s, root));
}

export function loadAssetMapping(root = resolveDatasetRoot()) {
  const file = path.join(root, "asset-mapping.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as Array<{
    baseAsset: string;
    externalSymbol: string;
    executionSymbol: string;
  }>;
}

export function loadUsdtTryBars(root = resolveDatasetRoot()): TryBar[] {
  const gz = path.join(root, "market-context", "USDTTRY-bars-1m.csv.gz");
  if (!fs.existsSync(gz)) return [];
  return parseCsvGz(gz);
}
