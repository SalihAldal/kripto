import fs from "node:fs";
import path from "node:path";
import {
  ALPHA_SIMULATOR_IDS,
  ALPHA_SIMULATOR_VERSION,
  runHistoricalAlphaSimulation,
  type AlphaSimulatorId,
  type HistoricalBar,
  type SymbolHistoricalPanel,
} from "./historical-alpha-simulator.service";
import { FEATURE_REGISTRY_VERSION } from "./feature-registry.service";
import { COST_MODEL_V2_VERSION } from "./cost-model-v2.service";
import {
  buildScoreboardEntry,
  computeAlphaStats,
  freezeDatasetConfig,
  passesFinalGate,
  passesValidationGate,
} from "./validation-framework.service";
import type { AlphaScoreboardEntry, AlphaTradeRecord } from "./types";

export const DEFAULT_FUTURES_UNIVERSE = [
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
];

export type ExperimentDataset = {
  datasetId: string;
  start: number;
  end: number;
  trainEnd: number;
  valEnd: number;
};

export function createDefaultDataset(startIso = "2026-05-15T00:00:00.000Z", endIso = "2026-06-15T00:00:00.000Z"): ExperimentDataset {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  const duration = end - start;
  return {
    datasetId: `ds-${startIso.slice(0, 10)}_${endIso.slice(0, 10)}`,
    start,
    end,
    trainEnd: start + duration * 0.5,
    valEnd: start + duration * 0.75,
  };
}

export function splitOf(dataset: ExperimentDataset, time: number): AlphaTradeRecord["split"] {
  if (time < dataset.trainEnd) return "TRAIN";
  if (time < dataset.valEnd) return "VALIDATION";
  return "TEST";
}

export async function fetchFuturesPanel(symbol: string, start: number, end: number): Promise<SymbolHistoricalPanel> {
  const FAPI = "https://fapi.binance.com";
  async function fetchJson(url: string) {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as unknown;
  }
  const bars: HistoricalBar[] = [];
  let cursor = start;
  for (let page = 0; page < 20; page += 1) {
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
  }
  const fundingRaw = (await fetchJson(
    `${FAPI}/fapi/v1/fundingRate?symbol=${symbol}&startTime=${start}&endTime=${end}&limit=1000`,
  )) as Array<Record<string, unknown>>;
  const funding = Array.isArray(fundingRaw)
    ? fundingRaw.map((r) => ({ fundingTime: Number(r.fundingTime), fundingRate: Number(r.fundingRate) }))
    : [];
  const basisRaw = (await fetchJson(
    `${FAPI}/fapi/v1/premiumIndexKlines?symbol=${symbol}&interval=1h&startTime=${start}&endTime=${end}&limit=1000`,
  )) as unknown[];
  const basis = Array.isArray(basisRaw)
    ? basisRaw
        .filter((r) => Array.isArray(r))
        .map((r) => ({ closeTime: Number((r as unknown[])[6]), premium: Number((r as unknown[])[4]) }))
    : [];
  return {
    symbol,
    bars: bars.filter((b) => b.closeTime >= start && b.closeTime <= end + 3_600_000),
    funding,
    basis,
  };
}

export async function runAlphaExperimentBatch(input: {
  dataset?: ExperimentDataset;
  alphaIds?: AlphaSimulatorId[];
  symbols?: string[];
  artifactDir?: string;
}) {
  const dataset = input.dataset ?? createDefaultDataset();
  const alphaIds = input.alphaIds ?? ALPHA_SIMULATOR_IDS;
  const symbols = input.symbols ?? DEFAULT_FUTURES_UNIVERSE;
  const frozen = freezeDatasetConfig({
    datasetId: dataset.datasetId,
    start: new Date(dataset.start).toISOString(),
    end: new Date(dataset.end).toISOString(),
    trainEnd: new Date(dataset.trainEnd).toISOString(),
    valEnd: new Date(dataset.valEnd).toISOString(),
    symbols,
    costModelVersion: COST_MODEL_V2_VERSION,
    featureVersion: FEATURE_REGISTRY_VERSION,
    alphaVersion: ALPHA_SIMULATOR_VERSION,
  });

  const panels: SymbolHistoricalPanel[] = [];
  for (const symbol of symbols) {
    panels.push(await fetchFuturesPanel(symbol, dataset.start, dataset.end));
  }
  const btc = panels.find((p) => p.symbol === "BTCUSDT")?.bars ?? panels[0]?.bars ?? [];
  const startIdx = 48;
  const endIdx = Math.min(...panels.map((p) => p.bars.length - 24));

  const scoreboard: AlphaScoreboardEntry[] = [];
  const details: Array<Record<string, unknown>> = [];

  for (const alphaId of alphaIds) {
    const all = runHistoricalAlphaSimulation({
      alphaId,
      panels,
      btc,
      startIdx,
      endIdx,
      stepHours: 4,
      splitOf: (t) => splitOf(dataset, t),
      venue: "FUTURES",
      costScenario: "REALISTIC",
    });
    const val = all.filter((t) => t.split === "VALIDATION");
    const test = all.filter((t) => t.split === "TEST");
    const valStats = computeAlphaStats(val);
    const testStats = computeAlphaStats(test);
    const validationPass = passesValidationGate(valStats);
    let robustnessPassed = false;
    const robustnessDetails: Array<{ period: string; netPnl: number }> = [];

    if (validationPass && passesFinalGate(testStats)) {
      const periods = [
        { label: "Jun15-Jul15", start: Date.parse("2026-06-15T00:00:00.000Z"), end: Date.parse("2026-07-15T00:00:00.000Z") },
        { label: "Jul15-Aug4", start: Date.parse("2026-07-15T00:00:00.000Z"), end: Date.parse("2026-08-04T00:00:00.000Z") },
      ];
      let positive = 0;
      for (const period of periods) {
        const periodPanels: SymbolHistoricalPanel[] = [];
        for (const symbol of symbols.slice(0, 5)) {
          periodPanels.push(await fetchFuturesPanel(symbol, period.start, period.end));
        }
        const pBtc = periodPanels.find((p) => p.symbol === "BTCUSDT")?.bars ?? periodPanels[0]?.bars ?? [];
        const pEnd = Math.min(...periodPanels.map((p) => p.bars.length - 24));
        const trades = runHistoricalAlphaSimulation({
          alphaId,
          panels: periodPanels,
          btc: pBtc,
          startIdx: 24,
          endIdx: pEnd,
          stepHours: 4,
          splitOf: () => "TEST",
          venue: "FUTURES",
        });
        const stats = computeAlphaStats(trades);
        if (stats.netPnl > 0 && stats.expectancy > 0) positive += 1;
        robustnessDetails.push({ period: period.label, netPnl: stats.netPnl });
      }
      robustnessPassed = positive >= 1 && robustnessDetails.every((r) => r.netPnl >= -50);
    }

    const entry = buildScoreboardEntry({
      alphaId,
      version: ALPHA_SIMULATOR_VERSION,
      datasetId: dataset.datasetId,
      configHash: frozen.configHash,
      featureVersion: FEATURE_REGISTRY_VERSION,
      costModelVersion: COST_MODEL_V2_VERSION,
      valStats,
      testStats,
      robustnessPassed,
    });
    scoreboard.push(entry);
    details.push({
      alphaId,
      validationPass,
      finalPass: validationPass && passesFinalGate(testStats),
      robustnessPassed,
      robustnessDetails,
      valStats,
      testStats,
    });
  }

  const artifactDir = input.artifactDir ?? path.join(process.cwd(), "artifacts", "alpha-research");
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, "alpha-scoreboard.json"), JSON.stringify(scoreboard, null, 2));

  const best = [...scoreboard]
    .filter((s) => s.status === "ROBUSTNESS_PASS")
    .sort((a, b) => (b.testExpectancy ?? 0) - (a.testExpectancy ?? 0))[0];

  return {
    frozen,
    scoreboard,
    details,
    bestAlpha: best ?? null,
    paperReady: Boolean(best),
    panelsLoaded: panels.length,
    barsPerSymbol: panels[0]?.bars.length ?? 0,
  };
}
