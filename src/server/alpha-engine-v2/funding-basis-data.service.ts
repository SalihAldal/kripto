import type { HistoricalBar, SymbolHistoricalPanel } from "./historical-alpha-simulator.service";
import type { DataAvailabilityState } from "./types";

export const FUNDING_BASIS_DATA_VERSION = "v3.0.0";
const FAPI = "https://fapi.binance.com";

export const FUNDING_BASIS_UNIVERSE = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "SUIUSDT",
] as const;

export type FundingBasisPanel = SymbolHistoricalPanel & {
  dataStates: {
    ohlcv: DataAvailabilityState;
    funding: DataAvailabilityState;
    basis: DataAvailabilityState;
  };
  fundingEventCount: number;
};

async function fetchJson(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return (await res.json()) as unknown;
}

function parseKlines(raw: unknown): HistoricalBar[] {
  if (!Array.isArray(raw)) return [];
  const bars: HistoricalBar[] = [];
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
  return bars;
}

export async function fetchPaginatedKlines(symbol: string, start: number, end: number, interval = "1h") {
  const bars: HistoricalBar[] = [];
  let cursor = start;
  for (let page = 0; page < 30; page += 1) {
    const raw = await fetchJson(
      `${FAPI}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${end}&limit=1000`,
    );
    const batch = parseKlines(raw);
    if (!batch.length) break;
    bars.push(...batch);
    const lastOpen = batch.at(-1)?.openTime ?? cursor;
    if (lastOpen >= end - 3_600_000 || batch.length < 1000) break;
    cursor = lastOpen + 1;
  }
  const deduped = new Map<number, HistoricalBar>();
  for (const b of bars) deduped.set(b.openTime, b);
  return [...deduped.values()].sort((a, b) => a.openTime - b.openTime);
}

export async function fetchPaginatedFunding(symbol: string, start: number, end: number) {
  const rows: Array<{ fundingTime: number; fundingRate: number }> = [];
  let cursor = start;
  for (let page = 0; page < 20; page += 1) {
    const raw = (await fetchJson(
      `${FAPI}/fapi/v1/fundingRate?symbol=${symbol}&startTime=${cursor}&endTime=${end}&limit=1000`,
    )) as Array<Record<string, unknown>>;
    if (!Array.isArray(raw) || !raw.length) break;
    for (const r of raw) {
      rows.push({ fundingTime: Number(r.fundingTime), fundingRate: Number(r.fundingRate) });
    }
    const last = rows.at(-1)?.fundingTime ?? cursor;
    if (last >= end || raw.length < 1000) break;
    cursor = last + 1;
  }
  const deduped = new Map<number, { fundingTime: number; fundingRate: number }>();
  for (const r of rows) deduped.set(r.fundingTime, r);
  return [...deduped.values()].sort((a, b) => a.fundingTime - b.fundingTime);
}

export async function fetchPaginatedPremiumKlines(symbol: string, start: number, end: number) {
  const bars: HistoricalBar[] = [];
  let cursor = start;
  for (let page = 0; page < 30; page += 1) {
    const raw = await fetchJson(
      `${FAPI}/fapi/v1/premiumIndexKlines?symbol=${symbol}&interval=1h&startTime=${cursor}&endTime=${end}&limit=1000`,
    );
    const batch = parseKlines(raw);
    if (!batch.length) break;
    bars.push(...batch);
    const lastOpen = batch.at(-1)?.openTime ?? cursor;
    if (lastOpen >= end - 3_600_000 || batch.length < 1000) break;
    cursor = lastOpen + 1;
  }
  const deduped = new Map<number, HistoricalBar>();
  for (const b of bars) deduped.set(b.openTime, b);
  return [...deduped.values()].sort((a, b) => a.openTime - b.openTime);
}

export async function fetchFundingBasisPanel(symbol: string, start: number, end: number): Promise<FundingBasisPanel> {
  const [bars, funding, premiumBars] = await Promise.all([
    fetchPaginatedKlines(symbol, start, end),
    fetchPaginatedFunding(symbol, start, end),
    fetchPaginatedPremiumKlines(symbol, start, end),
  ]);

  const basis = premiumBars.map((b) => ({ closeTime: b.closeTime, premium: b.close }));
  const filteredBars = bars.filter((b) => b.closeTime >= start && b.closeTime <= end + 3_600_000);

  const ohlcv: DataAvailabilityState = filteredBars.length >= 48 ? "AVAILABLE" : "UNAVAILABLE";
  const fundingState: DataAvailabilityState = funding.length >= 3 ? "AVAILABLE" : "UNAVAILABLE";
  const basisState: DataAvailabilityState = basis.length >= 3 ? "AVAILABLE" : "UNAVAILABLE";

  return {
    symbol,
    bars: filteredBars,
    funding,
    basis,
    dataStates: { ohlcv, funding: fundingState, basis: basisState },
    fundingEventCount: funding.length,
  };
}

export async function loadFundingBasisUniverse(start: number, end: number, symbols = FUNDING_BASIS_UNIVERSE) {
  const panels: FundingBasisPanel[] = [];
  for (const symbol of symbols) {
    panels.push(await fetchFundingBasisPanel(symbol, start, end));
  }
  const btc = panels.find((p) => p.symbol === "BTCUSDT")?.bars ?? panels[0]?.bars ?? [];
  const totalFundingEvents = panels.reduce((s, p) => s + p.fundingEventCount, 0);
  return { panels, btc, totalFundingEvents };
}

export function panelDataAvailable(panel: FundingBasisPanel): boolean {
  return panel.dataStates.ohlcv === "AVAILABLE" && panel.dataStates.funding === "AVAILABLE";
}

export function basisDataAvailable(panel: FundingBasisPanel): boolean {
  return panel.dataStates.basis === "AVAILABLE";
}
