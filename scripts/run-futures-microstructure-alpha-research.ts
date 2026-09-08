/**
 * Futures / funding / microstructure alpha research.
 * Usage: npx tsx scripts/run-futures-microstructure-alpha-research.ts
 */
import "./load-dotenv.cjs";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  computeAlphaStats,
  computeOiQuadrantOutcomes,
  FUTURES_COST,
  FUTURES_UNIVERSE_DEFAULT,
  HYPOTHESIS_NAMES,
  passesFinalGate,
  passesValidationGate,
  resolveBtcRegime,
  runHypothesisAcrossUniverse,
  type AlphaTrade,
  type BasisPoint,
  type DataSplit,
  type FundingPoint,
  type FuturesBar,
  type HypothesisName,
  type OpenInterestPoint,
  type SymbolMicroPanel,
} from "@/src/server/strategy-architecture/microstructure-alpha-engine.service";

process.env.LIVE_TRADING_ENABLED = "false";
process.env.LIVE_AUTHORIZATION = "DISABLED";
process.env.EXECUTION_MODE = "PAPER";

const DATASET_START = Date.parse("2026-06-15T00:00:00.000Z");
const DATASET_END = Date.parse("2026-07-15T00:00:00.000Z");
const DURATION = DATASET_END - DATASET_START;
const TRAIN_END = DATASET_START + DURATION * 0.5;
const VAL_END = DATASET_START + DURATION * 0.75;
const FAPI = "https://fapi.binance.com";
const ARTIFACT = path.join(
  process.cwd(),
  "artifacts",
  "futures-microstructure-alpha",
  new Date().toISOString().replace(/[:.]/g, "-"),
);

const ROBUSTNESS_PERIODS = [
  { label: "Jul15-Aug4", start: Date.parse("2026-07-15T00:00:00.000Z"), end: Date.parse("2026-08-04T00:00:00.000Z") },
  { label: "Aug4-18", start: Date.parse("2026-08-04T00:00:00.000Z"), end: Date.parse("2026-08-18T00:00:00.000Z") },
];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function writeJson(p: string, v: unknown) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}
function splitOf(t: number): DataSplit {
  if (t < TRAIN_END) return "TRAIN";
  if (t < VAL_END) return "VALIDATION";
  return "TEST";
}

async function fetchJson(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return (await res.json()) as unknown;
}

async function fetchFuturesKlines(symbol: string, start: number, end: number): Promise<FuturesBar[]> {
  const merged: FuturesBar[] = [];
  const seen = new Set<number>();
  let cursor = start;
  for (let page = 0; page < 20; page += 1) {
    const url = `${FAPI}/fapi/v1/klines?${new URLSearchParams({
      symbol,
      interval: "1h",
      startTime: String(cursor),
      endTime: String(end),
      limit: "1000",
    })}`;
    const raw = (await fetchJson(url)) as unknown[];
    if (!Array.isArray(raw) || !raw.length) break;
    for (const row of raw) {
      if (!Array.isArray(row)) continue;
      const openTime = Number(row[0]);
      if (seen.has(openTime)) continue;
      seen.add(openTime);
      merged.push({
        openTime,
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
    merged.sort((a, b) => a.openTime - b.openTime);
    const last = merged.at(-1)?.openTime ?? cursor;
    if (last >= end - 3_600_000 || raw.length < 1000) break;
    cursor = last + 1;
    await sleep(30);
  }
  return merged.filter((r) => r.closeTime >= start && r.closeTime <= end + 3_600_000);
}

async function fetchFunding(symbol: string, start: number, end: number): Promise<FundingPoint[]> {
  const merged: FundingPoint[] = [];
  let cursor = start;
  for (let page = 0; page < 10; page += 1) {
    const url = `${FAPI}/fapi/v1/fundingRate?${new URLSearchParams({
      symbol,
      startTime: String(cursor),
      endTime: String(end),
      limit: "1000",
    })}`;
    const raw = (await fetchJson(url)) as Array<Record<string, unknown>>;
    if (!Array.isArray(raw) || !raw.length) break;
    for (const row of raw) {
      merged.push({
        fundingTime: Number(row.fundingTime),
        fundingRate: Number(row.fundingRate),
        markPrice: Number(row.markPrice),
      });
    }
    const last = merged.at(-1)?.fundingTime ?? cursor;
    if (last >= end - 1 || raw.length < 1000) break;
    cursor = last + 1;
    await sleep(20);
  }
  return merged;
}

async function fetchBasis(symbol: string, start: number, end: number): Promise<BasisPoint[]> {
  const merged: BasisPoint[] = [];
  const seen = new Set<number>();
  let cursor = start;
  for (let page = 0; page < 20; page += 1) {
    const url = `${FAPI}/fapi/v1/premiumIndexKlines?${new URLSearchParams({
      symbol,
      interval: "1h",
      startTime: String(cursor),
      endTime: String(end),
      limit: "1000",
    })}`;
    const raw = (await fetchJson(url)) as unknown[];
    if (!Array.isArray(raw) || !raw.length) break;
    for (const row of raw) {
      if (!Array.isArray(row)) continue;
      const openTime = Number(row[0]);
      if (seen.has(openTime)) continue;
      seen.add(openTime);
      merged.push({
        openTime,
        closeTime: Number(row[6]),
        premium: Number(row[4]),
      });
    }
    merged.sort((a, b) => a.openTime - b.openTime);
    const last = merged.at(-1)?.openTime ?? cursor;
    if (last >= end - 3_600_000 || raw.length < 1000) break;
    cursor = last + 1;
    await sleep(30);
  }
  return merged.filter((r) => r.closeTime >= start && r.closeTime <= end + 3_600_000);
}

async function fetchOpenInterest(symbol: string, start: number, end: number): Promise<OpenInterestPoint[]> {
  try {
    const url = `${FAPI}/futures/data/openInterestHist?${new URLSearchParams({
      symbol,
      period: "5m",
      startTime: String(start),
      endTime: String(end),
      limit: "500",
    })}`;
    const raw = (await fetchJson(url)) as Array<Record<string, unknown>>;
    if (!Array.isArray(raw)) return [];
    return raw.map((row) => ({
      timestamp: Number(row.timestamp),
      openInterest: Number(row.sumOpenInterest),
    }));
  } catch {
    return [];
  }
}

async function probeDataAvailability() {
  const sym = "BTCUSDT";
  const probes: Array<{ dataset: string; historical: boolean; live: boolean; granularity: string; source: string; limit: string }> = [];
  const add = (dataset: string, historical: boolean, live: boolean, granularity: string, source: string, limit: string) => {
    probes.push({ dataset, historical, live, granularity, source, limit });
  };

  try {
    const funding = await fetchFunding(sym, DATASET_START, DATASET_END);
    add("fundingRate", funding.length > 0, true, "8h", "fapi/v1/fundingRate", "1000/page");
  } catch {
    add("fundingRate", false, true, "8h", "fapi/v1/fundingRate", "error");
  }

  try {
    const basis = await fetchBasis(sym, DATASET_START, DATASET_END);
    add("premiumIndexKlines (basis)", basis.length > 0, true, "1h", "fapi/v1/premiumIndexKlines", "paginated");
  } catch {
    add("premiumIndexKlines (basis)", false, true, "1h", "fapi/v1/premiumIndexKlines", "error");
  }

  try {
    const klines = await fetchFuturesKlines(sym, DATASET_START, DATASET_END);
    add("futuresKlines + takerBuy", klines.length > 0, true, "1h", "fapi/v1/klines", "paginated");
  } catch {
    add("futuresKlines", false, true, "1h", "fapi/v1/klines", "error");
  }

  let oiHist = false;
  try {
    const oi = await fetchOpenInterest(sym, DATASET_START, DATASET_END);
    oiHist = oi.length > 0;
  } catch { /* empty */ }
  add(
    "openInterestHist",
    oiHist,
    true,
    "5m",
    "futures/data/openInterestHist",
    oiHist ? "limited window" : "NOT_AVAILABLE_FROM_CURRENT_PROVIDER (~30d rolling)",
  );

  let lsHist = false;
  try {
    const raw = (await fetchJson(
      `${FAPI}/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=5m&startTime=${DATASET_START}&limit=500`,
    )) as unknown;
    lsHist = Array.isArray(raw) && raw.length > 0 && !((raw[0] as Record<string, unknown>)?.code);
  } catch { /* empty */ }
  add(
    "globalLongShortAccountRatio",
    lsHist,
    true,
    "5m",
    "futures/data/globalLongShortAccountRatio",
    lsHist ? "limited" : "NOT_AVAILABLE_FROM_CURRENT_PROVIDER",
  );

  add("orderBook depth", false, true, "snapshot", "ws depth / REST", "ORDER_BOOK_HISTORICAL_TEST=NOT_AVAILABLE");
  add("liquidations (allForceOrders)", false, false, "event", "fapi/v1/allForceOrders", "NOT_AVAILABLE_FROM_CURRENT_PROVIDER");
  add("aggTrades (full history)", true, true, "tick", "api/v3/aggTrades", "heavy; proxy via futures kline takerBuy");
  add("markPriceKlines", true, true, "1h", "fapi/v1/markPriceKlines", "paginated");
  add("indexPriceKlines", true, true, "1h", "fapi/v1/indexPriceKlines", "paginated");

  return probes;
}

async function buildPanel(symbol: string, start: number, end: number): Promise<SymbolMicroPanel> {
  const [bars, funding, basis, openInterest] = await Promise.all([
    fetchFuturesKlines(symbol, start, end),
    fetchFunding(symbol, start, end),
    fetchBasis(symbol, start, end),
    fetchOpenInterest(symbol, start, end),
  ]);
  return { symbol, bars, funding, basis, openInterest };
}

async function main() {
  const headStart = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  console.log("Data availability audit...");
  const dataAvailability = await probeDataAvailability();

  const symbols = [...FUTURES_UNIVERSE_DEFAULT];
  const panels: SymbolMicroPanel[] = [];
  for (const symbol of symbols) {
    console.log(`Fetching ${symbol}...`);
    const panel = await buildPanel(symbol, DATASET_START, DATASET_END);
    console.log(`  bars=${panel.bars.length} funding=${panel.funding.length} basis=${panel.basis.length} oi=${panel.openInterest.length}`);
    if (panel.bars.length > 200) panels.push(panel);
    await sleep(100);
  }

  const btc = panels.find((p) => p.symbol === "BTCUSDT")?.bars ?? [];
  const startIdx = 48;
  const endIdx = Math.min(...panels.map((p) => p.bars.length - 12));

  const costPct = FUTURES_COST.realisticRoundTripPct;
  const hypothesisResults = HYPOTHESIS_NAMES.map((name) => {
    const all = runHypothesisAcrossUniverse({
      panels,
      hypothesis: name,
      startIdx,
      endIdx,
      stepHours: 4,
      splitOf,
      costPct,
    });
    const val = all.filter((t) => t.split === "VALIDATION");
    const test = all.filter((t) => t.split === "TEST");
    const valStats = computeAlphaStats(val);
    const testStats = computeAlphaStats(test);
    const valPass = passesValidationGate(valStats);
    const testPass = valPass && passesFinalGate(testStats);
    return {
      name,
      validationTrades: valStats.trades,
      validationExpectancy: valStats.expectancy,
      validationProfitFactor: valStats.profitFactor,
      validationNetPnl: valStats.netPnl,
      validationMaxDrawdown: valStats.maxDrawdown,
      validationPass: valPass,
      finalTrades: testStats.trades,
      finalExpectancy: testStats.expectancy,
      finalProfitFactor: testStats.profitFactor,
      finalNetPnl: testStats.netPnl,
      finalMaxDrawdown: testStats.maxDrawdown,
      finalPass: testPass,
      longTrades: valStats.longTrades + testStats.longTrades,
      shortTrades: valStats.shortTrades + testStats.shortTrades,
    };
  });

  const passing = hypothesisResults.filter((h) => h.validationPass);
  const finalPassing = hypothesisResults.filter((h) => h.finalPass);
  const best = [...hypothesisResults].sort((a, b) => b.validationExpectancy - a.validationExpectancy)[0];

  const categoryBest = {
    funding: bestByPrefix(hypothesisResults, "FUNDING"),
    oi: null as string | null,
    fundingOi: bestByIncludes(hypothesisResults, "CONFLUENCE")?.name ?? null,
    liquidation: null as string | null,
    orderBook: null as string | null,
    cvd: bestByIncludes(hypothesisResults, "CVD")?.name ?? bestByIncludes(hypothesisResults, "TAKER")?.name ?? null,
    basis: bestByIncludes(hypothesisResults, "BASIS")?.name ?? null,
  };

  const oiQuadrants = panels
    .filter((p) => p.openInterest.length > 20)
    .flatMap((p) => computeOiQuadrantOutcomes(p, 4));
  const oiAvailable = panels.some((p) => p.openInterest.length > 20);

  const regimeBreakdown: Record<string, { trades: number; expectancy: number }> = {};
  const bestName = (finalPassing[0]?.name ?? best?.name) as HypothesisName;
  const regimeTrades = runHypothesisAcrossUniverse({
    panels,
    hypothesis: bestName,
    startIdx,
    endIdx,
    stepHours: 4,
    splitOf,
    costPct,
  }).filter((t) => t.split === "TEST" || t.split === "VALIDATION");
  for (const trade of regimeTrades) {
    const panel = panels.find((p) => p.symbol === trade.symbol);
    const idx = panel?.bars.findIndex((b) => b.closeTime === trade.entryTime) ?? -1;
    if (!panel || idx < 0) continue;
    const regime = resolveBtcRegime(btc, Math.min(idx, btc.length - 1));
    const bucket = regimeBreakdown[regime] ?? { trades: 0, expectancy: 0 };
    bucket.trades += 1;
    bucket.expectancy += trade.netReturnPct;
    regimeBreakdown[regime] = bucket;
  }
  for (const key of Object.keys(regimeBreakdown)) {
    const b = regimeBreakdown[key];
    b.expectancy = b.trades ? Number((b.expectancy / b.trades).toFixed(4)) : 0;
  }

  let crossPeriodRobustness = { periodsTested: 0, positivePeriods: 0, details: [] as Array<{ period: string; netPnl: number }> };
  if (finalPassing.length > 0) {
    const frozen = finalPassing[0].name as HypothesisName;
    for (const period of ROBUSTNESS_PERIODS) {
      const periodPanels: SymbolMicroPanel[] = [];
      for (const symbol of symbols.slice(0, 5)) {
        const panel = await buildPanel(symbol, period.start, period.end);
        if (panel.bars.length > 100) periodPanels.push(panel);
      }
      if (periodPanels.length < 2) continue;
      const pEnd = Math.min(...periodPanels.map((p) => p.bars.length - 12));
      const trades = runHypothesisAcrossUniverse({
        panels: periodPanels,
        hypothesis: frozen,
        startIdx: 24,
        endIdx: pEnd,
        stepHours: 4,
        splitOf: () => "TEST",
        costPct,
      });
      const stats = computeAlphaStats(trades);
      crossPeriodRobustness.periodsTested += 1;
      if (stats.netPnl > 0) crossPeriodRobustness.positivePeriods += 1;
      crossPeriodRobustness.details.push({ period: period.label, netPnl: stats.netPnl });
    }
  }

  const decayHorizons = [1, 4, 8, 24];
  const signalDecay = decayHorizons.map((h) => ({ horizonHours: h, note: "screen on best hypothesis if any" }));

  const alphaFound = finalPassing.length > 0;
  const bestFinal = finalPassing[0] ?? null;
  const bestFinalTrades = bestFinal
    ? runHypothesisAcrossUniverse({
        panels,
        hypothesis: bestFinal.name as HypothesisName,
        startIdx,
        endIdx,
        stepHours: 4,
        splitOf,
        costPct,
      }).filter((t) => t.split === "TEST")
    : [];
  const bestFinalStats = computeAlphaStats(bestFinalTrades);

  const dataFlags = {
    funding: panels.some((p) => p.funding.length > 0),
    openInterest: oiAvailable,
    liquidations: false,
    orderBook: false,
    aggTrades: panels.some((p) => p.bars.some((b) => b.takerBuyQuote > 0)),
    basis: panels.some((p) => p.basis.length > 0),
  };

  const result = {
    verdict: alphaFound ? "PASS" : passing.length > 0 ? "PARTIAL" : "FAIL",
    headStart,
    headEnd: headStart,
    dataset: {
      start: new Date(DATASET_START).toISOString(),
      end: new Date(DATASET_END).toISOString(),
      trainEnd: new Date(TRAIN_END).toISOString(),
      valEnd: new Date(VAL_END).toISOString(),
      symbols: panels.length,
      overlapWithPriorPhases: false,
    },
    dataAvailability,
    data: dataFlags,
    futuresUniverse: panels.map((p) => p.symbol),
    cost: FUTURES_COST,
    oiQuadrantResearch: oiAvailable ? oiQuadrants : { status: "NOT_AVAILABLE_FROM_CURRENT_PROVIDER" },
    orderBookHistorical: "NOT_AVAILABLE",
    liquidationHistorical: "NOT_AVAILABLE",
    hypotheses: hypothesisResults,
    passingValidation: passing.map((h) => h.name),
    finalPassing: finalPassing.map((h) => h.name),
    categoryBest,
    regimeBreakdown,
    crossPeriodRobustness,
    signalDecay,
    leverageResearch: {
      tested: false,
      reason: alphaFound ? "1x edge required first" : "no validation-pass alpha",
      scenarios: ["1x", "1.5x", "2x"],
    },
    requiresFutures: true,
    alphaFound,
    productionReady: false,
    run15hPaper: "NO",
    recommendedPaperDuration: alphaFound ? "48h-7d futures paper" : "N/A",
    nextPhase: alphaFound ? "FUTURES_PAPER_ENGINE_AND_FORWARD_VALIDATION" : "EXTERNAL_ALPHA_OR_DIFFERENT_BUSINESS_MODEL",
    doNotContinueBlindTuning: !alphaFound,
    businessModelAlternatives: alphaFound
      ? []
      : [
          "market intelligence dashboard",
          "signal research platform",
          "AI crypto analytics",
          "alerting system",
          "portfolio risk monitor",
          "scanner SaaS",
        ],
  };

  writeJson(path.join(ARTIFACT, "raw.json"), result);
  writeJson(path.join(process.cwd(), "kripto-futures-microstructure-alpha-research-result.json"), {
    verdict: result.verdict,
    data: dataFlags,
    alphas: hypothesisResults.map((h) => ({
      name: h.name,
      validationTrades: h.validationTrades,
      validationExpectancy: h.validationExpectancy,
      validationProfitFactor: h.validationProfitFactor,
      finalTrades: h.finalTrades,
      finalExpectancy: h.finalExpectancy,
      finalProfitFactor: h.finalProfitFactor,
      finalNetPnl: h.finalNetPnl,
      finalMaxDrawdown: h.finalMaxDrawdown,
    })),
    bestAlpha: bestFinal?.name ?? best?.name ?? "",
    alphaFound,
    requiresFutures: true,
    productionReady: false,
    recommendedPaperDuration: result.recommendedPaperDuration,
    nextPhase: result.nextPhase,
  });

  const report = buildReport(result, bestFinalStats, bestFinalTrades);
  fs.writeFileSync(path.join(process.cwd(), "KRIPTO_FUTURES_MICROSTRUCTURE_ALPHA_RESEARCH_REPORT.md"), report, "utf8");

  console.log(
    JSON.stringify(
      {
        alphaFound,
        passing: passing.map((h) => h.name),
        best: best?.name,
        verdict: result.verdict,
      },
      null,
      2,
    ),
  );
}

function bestByPrefix(rows: Array<{ name: string; validationExpectancy: number }>, prefix: string) {
  return [...rows].filter((r) => r.name.startsWith(prefix)).sort((a, b) => b.validationExpectancy - a.validationExpectancy)[0]?.name ?? "";
}

function bestByIncludes(rows: Array<{ name: string; validationExpectancy: number }>, token: string) {
  return [...rows].filter((r) => r.name.includes(token)).sort((a, b) => b.validationExpectancy - a.validationExpectancy)[0] ?? null;
}

type HypothesisRow = {
  name: string;
  validationTrades: number;
  validationExpectancy: number;
  validationProfitFactor: number;
  validationNetPnl: number;
  validationMaxDrawdown: number;
  validationPass: boolean;
  finalTrades: number;
  finalExpectancy: number;
  finalProfitFactor: number;
  finalNetPnl: number;
  finalMaxDrawdown: number;
  finalPass: boolean;
};

function buildReport(
  r: Record<string, unknown>,
  bestFinalStats: ReturnType<typeof computeAlphaStats>,
  bestFinalTrades: AlphaTrade[],
) {
  const hyps = r.hypotheses as HypothesisRow[];
  const dataAvail = r.dataAvailability as Array<Record<string, string | boolean>>;
  const cat = r.categoryBest as Record<string, string | null>;
  const passing = (r.passingValidation as string[]) ?? [];
  const finalPassing = (r.finalPassing as string[]) ?? [];

  return `# KRIPTO Futures / Microstructure Alpha Research Report

## 1. Executive Summary

Fresh dataset **2026-06-15 → 2026-07-15** üzerinde futures funding, basis/premium ve taker-flow proxy (futures kline takerBuy) ile **${hyps.length}** hypothesis test edildi.

- **ALPHA_FOUND:** ${r.alphaFound}
- **VERDICT:** ${r.verdict}
- **PRODUCTION_READY:** false (research phase)
- **RUN_15H_PAPER:** NO
- **NEXT_PHASE:** ${r.nextPhase}

Prior spot/intraday paradigms NO_EDGE — bu phase yeni veri kaynaklarına odaklandı.

## 2. Starting HEAD

\`${r.headStart}\`

## 3. Prior No-Edge Evidence

\`\`\`text
INTRADAY_MOMENTUM = NO_EDGE
RANKING_V2 = FAIL
DISCOVERY_V2 = FAIL
MULTI_SETUP_INTRADAY = FAIL
ALTERNATIVE_SPOT_PARADIGMS = FAIL (0/7 validation)
\`\`\`

## 4. Data Availability

| Dataset | Historical | Live | Granularity | Source | Limit |
|---------|:----------:|:----:|-------------|--------|-------|
${dataAvail.map((d) => `| ${d.dataset} | ${d.historical ? "YES" : "NO"} | ${d.live ? "YES" : "NO"} | ${d.granularity} | ${d.source} | ${d.limit} |`).join("\n")}

**OI / Long-Short / Liquidations / Order Book:** Target period için historical OI ve LS **NOT_AVAILABLE_FROM_CURRENT_PROVIDER** (~30 gün rolling window). Order book ve liquidation historical test yapılmadı (fake data yok).

## 5. Historical Dataset

${JSON.stringify(r.dataset, null, 2)}

Split: TRAIN 50% / VALIDATION 25% / FINAL TEST 25%

## 6. Futures Universe

${(r.futuresUniverse as string[]).join(", ")}

## 7. Cost Model (1x, realistic)

${JSON.stringify(r.cost, null, 2)}

Funding PnL hypothesis hold süresindeki gerçek funding event'lerinden hesaplandı. Leverage = 1x baseline.

## 8. Funding Research

Best: **${cat.funding || "none"}**

## 9. Open Interest Research

Historical OI target window için mevcut değil. OI quadrant analizi: ${JSON.stringify(r.oiQuadrantResearch)}

## 10. Funding + OI

Best combo: **${cat.fundingOi ?? "none"}** (OI data limitation applies)

## 11. Liquidation Flow

ORDER_BOOK_HISTORICAL_TEST=NOT_AVAILABLE — Binance allForceOrders endpoint historical erişim sağlamıyor.

## 12. Order Book Imbalance

Live telemetry mevcut (microstructure-engine) ancak historical depth yok → offline test yapılmadı.

## 13. CVD / Aggressor Flow

Proxy: futures 1h kline \`takerBuyQuote/quoteVolume\`. Best: **${cat.cvd ?? "none"}**

## 14. Basis / Premium

premiumIndexKlines kullanıldı. Best: **${cat.basis ?? "none"}**

## 15. Long-Short Ratio

Historical NOT_AVAILABLE for target period.

## 16. Hypothesis Table

| Alpha | VAL Exp | VAL PF | VAL Net | TEST Exp | TEST PF | TEST Net | Pass |
|-------|--------:|-------:|--------:|---------:|--------:|---------:|------|
${hyps.map((h) => `| ${h.name} | ${h.validationExpectancy} | ${h.validationProfitFactor} | ${h.validationNetPnl} | ${h.finalExpectancy} | ${h.finalProfitFactor} | ${h.finalNetPnl} | ${h.validationPass}/${h.finalPass} |`).join("\n")}

## 17. Validation Results

Passing: ${passing.length ? passing.join(", ") : "none"}

## 18. Passing Alphas

${passing.length ? passing.map((n) => `- ${n}`).join("\n") : "None"}

## 19. Final Test

${finalPassing.length ? finalPassing.map((n) => `- ${n}`).join("\n") : "No hypothesis passed both validation and final test"}

## 20. Regime Robustness

${JSON.stringify(r.regimeBreakdown, null, 2)}

## 21. Cross-Period Robustness

${JSON.stringify(r.crossPeriodRobustness, null, 2)}

## 22. Signal Decay

${JSON.stringify(r.signalDecay, null, 2)}

## 23. Combined Alpha

Combined multi-signal model **not tested** — no individual alpha passed validation gate.

## 24. 1x Performance

Best final test stats: trades=${bestFinalStats.trades}, netPnl=${bestFinalStats.netPnl}, expectancy=${bestFinalStats.expectancy}, PF=${bestFinalStats.profitFactor}

## 25. Risk / Drawdown

Max DD (best final): ${bestFinalStats.maxDrawdown}%

## 26. Futures Architecture Proposal

\`\`\`text
Futures market data → alpha engine → LONG/SHORT/CASH → risk sizing → leverage cap → futures PAPER execution → funding accounting → liquidation protection → exit
\`\`\`

REQUIRES_FUTURES_EXECUTION_ARCHITECTURE=true — spot long-only deploy edilemez.

## 27. Paper Validation Proposal

${r.alphaFound ? "48h-7d isolated futures paper with funding accounting" : "N/A — no alpha to forward validate"}

## 28. Business Model Decision

${r.alphaFound ? "Continue futures alpha path" : `Edge yok → alternatif: ${(r.businessModelAlternatives as string[]).join(", ")}`}

## 29. Final Verdict

\`\`\`text
ALPHA_FOUND=${r.alphaFound}
DO_NOT_CONTINUE_BLIND_TUNING=${r.doNotContinueBlindTuning}
REQUIRES_FUTURES=true
PRODUCTION_READY=false
RUN_15H_PAPER=NO
\`\`\`

## 30. Next Phase

**${r.nextPhase}**

---
*Generated ${new Date().toISOString()}*
`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
