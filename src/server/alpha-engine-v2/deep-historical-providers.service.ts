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
import {
  BinanceFuturesMarketDataProvider,
  buildExternalSymbolPanel,
  importExternalPanelsFromDir,
} from "./external-market-data-provider.service";

export type DeepProviderResolution = {
  provider: HistoricalMarketDataProvider;
  providerName: string;
  source: "file-import" | "tardis" | "coinalyze" | "coinapi" | "binance-fallback";
  credentialPresent: boolean;
  blocker?: string;
};

function envPresent(key: string) {
  const v = process.env[key];
  return Boolean(v && v.trim().length > 0);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

abstract class BaseHttpProvider implements HistoricalMarketDataProvider {
  abstract name: string;
  protected async getJson(url: string, headers: Record<string, string> = {}) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(45_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as unknown;
  }
  abstract getKlines(symbol: string, start: number, end: number): Promise<ExternalSymbolPanel["bars"]>;
  abstract getFunding(symbol: string, start: number, end: number): Promise<Array<{ fundingTime: number; fundingRate: number }>>;
  abstract getBasis(symbol: string, start: number, end: number): Promise<Array<{ closeTime: number; premium: number }>>;
  abstract getOpenInterest(symbol: string, start: number, end: number): Promise<OiPoint[]>;
  async getLiquidations(): Promise<LiquidationEvent[]> {
    return [];
  }
  async getAggTrades(): Promise<AggTradeBucket[]> {
    return [];
  }
  async getLongShortRatio(): Promise<LongShortRatioPoint[]> {
    return [];
  }
  async getOrderBookSnapshots(): Promise<OrderBookSnapshot[]> {
    return [];
  }
}

export class TardisHistoricalProvider extends BaseHttpProvider {
  name = "tardis";
  private apiKey: string;
  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
  }
  async getOpenInterest(symbol: string, start: number, end: number): Promise<OiPoint[]> {
    const exchange = "binance-futures";
    const from = new Date(start).toISOString();
    const to = new Date(end).toISOString();
    const url = `https://api.tardis.dev/v1/data/${exchange}/open_interest/${symbol}?from=${from}&to=${to}`;
    const raw = await this.getJson(url, { Authorization: `Bearer ${this.apiKey}` });
    if (!Array.isArray(raw)) return [];
    return raw
      .map((r: Record<string, unknown>) => ({
        timestamp: Date.parse(String(r.timestamp ?? r.time)),
        openInterest: Number(r.openInterest ?? r.sumOpenInterest ?? r.value),
        openInterestValue: Number(r.openInterestValue ?? 0),
      }))
      .filter((r) => Number.isFinite(r.timestamp) && r.openInterest > 0);
  }
  async getKlines(symbol: string, start: number, end: number) {
    const binance = new BinanceFuturesMarketDataProvider();
    return binance.getKlines(symbol, start, end);
  }
  async getFunding(symbol: string, start: number, end: number) {
    const binance = new BinanceFuturesMarketDataProvider();
    return binance.getFunding(symbol, start, end);
  }
  async getBasis(symbol: string, start: number, end: number) {
    const binance = new BinanceFuturesMarketDataProvider();
    return binance.getBasis(symbol, start, end);
  }
}

export class CoinalyzeHistoricalProvider extends BaseHttpProvider {
  name = "coinalyze";
  private apiKey: string;
  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
  }
  async getOpenInterest(symbol: string, start: number, end: number): Promise<OiPoint[]> {
    const url = `https://api.coinalyze.net/v1/open-interest-history?symbols=${symbol}&interval=1hour&from=${Math.floor(start / 1000)}&to=${Math.floor(end / 1000)}&api_key=${this.apiKey}`;
    const raw = await this.getJson(url);
    if (!Array.isArray(raw)) return [];
    return raw.map((r: Record<string, unknown>) => ({
      timestamp: Number(r.t) * 1000,
      openInterest: Number(r.o ?? r.open_interest),
      openInterestValue: Number(r.v ?? 0),
    }));
  }
  async getKlines(symbol: string, start: number, end: number) {
    return new BinanceFuturesMarketDataProvider().getKlines(symbol, start, end);
  }
  async getFunding(symbol: string, start: number, end: number) {
    return new BinanceFuturesMarketDataProvider().getFunding(symbol, start, end);
  }
  async getBasis(symbol: string, start: number, end: number) {
    return new BinanceFuturesMarketDataProvider().getBasis(symbol, start, end);
  }
}

export class CoinApiHistoricalProvider extends BaseHttpProvider {
  name = "coinapi";
  private apiKey: string;
  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
  }
  async getOpenInterest(symbol: string, start: number, end: number): Promise<OiPoint[]> {
    const url = `https://rest.coinapi.io/v1/metrics/${symbol}/current?time_start=${new Date(start).toISOString()}&time_end=${new Date(end).toISOString()}`;
    const raw = await this.getJson(url, { "X-CoinAPI-Key": this.apiKey });
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((r: Record<string, unknown>) => r.metric_id === "OPEN_INTEREST")
      .map((r: Record<string, unknown>) => ({
        timestamp: Date.parse(String(r.time_period_start)),
        openInterest: Number(r.value),
      }));
  }
  async getKlines(symbol: string, start: number, end: number) {
    return new BinanceFuturesMarketDataProvider().getKlines(symbol, start, end);
  }
  async getFunding(symbol: string, start: number, end: number) {
    return new BinanceFuturesMarketDataProvider().getFunding(symbol, start, end);
  }
  async getBasis(symbol: string, start: number, end: number) {
    return new BinanceFuturesMarketDataProvider().getBasis(symbol, start, end);
  }
}

export class FileImportHistoricalProvider implements HistoricalMarketDataProvider {
  name = "file-import";
  private panels: Map<string, ExternalSymbolPanel>;
  constructor(dir: string) {
    this.panels = new Map(importExternalPanelsFromDir(dir).map((p) => [p.symbol, p]));
  }
  private panel(symbol: string) {
    const p = this.panels.get(symbol);
    if (!p) throw new Error(`FILE_IMPORT_MISSING_SYMBOL:${symbol}`);
    return p;
  }
  getKlines(symbol: string) {
    return Promise.resolve(this.panel(symbol).bars);
  }
  getFunding(symbol: string) {
    return Promise.resolve(this.panel(symbol).funding);
  }
  getBasis(symbol: string) {
    return Promise.resolve(this.panel(symbol).basis);
  }
  getOpenInterest(symbol: string) {
    return Promise.resolve(this.panel(symbol).openInterest);
  }
  getLiquidations(symbol: string) {
    return Promise.resolve(this.panel(symbol).liquidations);
  }
  getAggTrades(symbol: string) {
    return Promise.resolve(this.panel(symbol).aggTrades);
  }
  getLongShortRatio(symbol: string) {
    return Promise.resolve(this.panel(symbol).longShortRatio);
  }
  getOrderBookSnapshots(symbol: string) {
    return Promise.resolve(this.panel(symbol).orderBook);
  }
}

export function resolveDeepHistoricalProvider(): DeepProviderResolution {
  const dataDir = process.env.DEEP_OI_DATA_DIR ?? path.join(process.cwd(), "artifacts", "deep-oi-data");
  if (fs.existsSync(dataDir) && importExternalPanelsFromDir(dataDir).length > 0) {
    return {
      provider: new FileImportHistoricalProvider(dataDir),
      providerName: "file-import",
      source: "file-import",
      credentialPresent: true,
    };
  }
  if (envPresent("TARDIS_API_KEY")) {
    return {
      provider: new TardisHistoricalProvider(process.env.TARDIS_API_KEY!),
      providerName: "tardis",
      source: "tardis",
      credentialPresent: true,
    };
  }
  if (envPresent("COINALYZE_API_KEY")) {
    return {
      provider: new CoinalyzeHistoricalProvider(process.env.COINALYZE_API_KEY!),
      providerName: "coinalyze",
      source: "coinalyze",
      credentialPresent: true,
    };
  }
  if (envPresent("COINAPI_KEY")) {
    return {
      provider: new CoinApiHistoricalProvider(process.env.COINAPI_KEY!),
      providerName: "coinapi",
      source: "coinapi",
      credentialPresent: true,
    };
  }
  return {
    provider: new BinanceFuturesMarketDataProvider(),
    providerName: "binance-futures",
    source: "binance-fallback",
    credentialPresent: false,
    blocker: "DEEP_HISTORICAL_OI_DATA_REQUIRED",
  };
}

export function measureOiCoverageDays(panels: ExternalSymbolPanel[]) {
  const spans = panels.map((p) => {
    if (p.openInterest.length < 2) return 0;
    const sorted = [...p.openInterest].sort((a, b) => a.timestamp - b.timestamp);
    return (sorted.at(-1)!.timestamp - sorted[0]!.timestamp) / (24 * 3_600_000);
  });
  const avg = spans.length ? spans.reduce((s, v) => s + v, 0) / spans.length : 0;
  const min = spans.length ? Math.min(...spans) : 0;
  return { avgDays: Number(avg.toFixed(2)), minDays: Number(min.toFixed(2)), perSymbol: spans };
}

export async function loadDeepOiPanels(input: {
  provider: HistoricalMarketDataProvider;
  symbols: string[];
  start: number;
  end: number;
  dataDir?: string;
}) {
  const panels: ExternalSymbolPanel[] = [];
  if (input.provider.name === "file-import" && input.dataDir) {
    const imported = importExternalPanelsFromDir(input.dataDir);
    for (const symbol of input.symbols) {
      const panel = imported.find((p) => p.symbol === symbol);
      if (panel) panels.push(panel);
    }
    return panels;
  }
  for (const symbol of input.symbols) {
    const panel = await buildExternalSymbolPanel(input.provider, symbol, input.start, input.end);
    const oiOnly = await input.provider.getOpenInterest(symbol, input.start, input.end).catch(() => panel.openInterest);
    panel.openInterest = oiOnly.length > panel.openInterest.length ? oiOnly : panel.openInterest;
    if (panel.openInterest.length >= 24) panel.availability.OPEN_INTEREST = "AVAILABLE";
    panels.push(panel);
    await sleep(200);
  }
  return panels;
}
