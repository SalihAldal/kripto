/**
 * Alternative market paradigm research on fresh historical dataset.
 * Usage: npx tsx scripts/run-alternative-market-paradigm.ts
 */
import "./load-dotenv.cjs";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { env } from "@/lib/config";
import {
  computeParadigmStats,
  PARADIGM_COST,
  PARADIGM_NAMES,
  passesFinalGate,
  passesValidationGate,
  simulateBasketRotation,
  simulateBtcRegimeRotation,
  simulateCrossSectionalMeanReversion,
  simulateCrossSectionalRS,
  simulateMultiDaySwing,
  simulatePairRelativeValue,
  simulateVolatilityBreakoutSwing,
  type ParadigmName,
  type ParadigmTrade,
  type SymbolPanel,
} from "@/src/server/strategy-architecture/alternative-paradigm-engine.service";
import { filterTradeableUniverse, resolveQuoteAssets } from "@/src/server/market-data/spine/universe";
import type { KlineItem } from "@/src/types/exchange";

process.env.LIVE_TRADING_ENABLED = "false";
process.env.LIVE_AUTHORIZATION = "DISABLED";
process.env.EXECUTION_MODE = "PAPER";

const DATASET_START = Date.parse("2026-07-15T00:00:00.000Z");
const DATASET_END = Date.parse("2026-08-04T00:00:00.000Z");
const DURATION = DATASET_END - DATASET_START;
const TRAIN_END = DATASET_START + DURATION * 0.5;
const VAL_END = DATASET_START + DURATION * 0.75;
const MAX_SYMBOLS = 24;
const ARTIFACT = path.join(process.cwd(), "artifacts", "alternative-paradigm", new Date().toISOString().replace(/[:.]/g, "-"));

const ROBUSTNESS_PERIODS = [
  { label: "Aug4-18", start: Date.parse("2026-08-04T00:00:00.000Z"), end: Date.parse("2026-08-18T00:00:00.000Z") },
  { label: "Aug18-28", start: Date.parse("2026-08-18T00:00:00.000Z"), end: Date.parse("2026-08-28T00:00:00.000Z") },
  { label: "Aug28-Sep4", start: Date.parse("2026-08-28T00:00:00.000Z"), end: Date.parse("2026-09-04T00:00:00.000Z") },
  { label: "Sep4-7", start: Date.parse("2026-09-04T22:38:00.000Z"), end: Date.parse("2026-09-07T21:37:59.999Z") },
];

type Split = "TRAIN" | "VALIDATION" | "TEST";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function writeJson(p: string, v: unknown) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}
function splitOf(t: number): Split {
  if (t < TRAIN_END) return "TRAIN";
  if (t < VAL_END) return "VALIDATION";
  return "TEST";
}

async function fetchKlines(symbol: string, start: number, end: number): Promise<KlineItem[]> {
  let cursorEnd = end + 60_000;
  const merged: KlineItem[] = [];
  const seen = new Set<number>();
  const base = (env.BINANCE_PUBLIC_HTTP_BASES ?? "https://api.binance.me").split(",")[0]?.trim() || "https://api.binance.me";
  for (let page = 0; page < 20; page += 1) {
    const res = await fetch(`${base}/api/v3/klines?${new URLSearchParams({ symbol, interval: "1m", limit: "1000", endTime: String(cursorEnd) })}`);
    const raw = (await res.json()) as unknown[];
    if (!Array.isArray(raw)) break;
    const batch = raw.filter((r) => Array.isArray(r)).map((r) => {
      const row = r as unknown[];
      return {
        openTime: Number(row[0]),
        closeTime: Number(row[6] ?? row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
      };
    });
    if (!batch.length) break;
    for (const row of batch) {
      if (!seen.has(row.openTime)) {
        seen.add(row.openTime);
        merged.push(row);
      }
    }
    merged.sort((a, b) => a.openTime - b.openTime);
    const oldest = merged[0]?.openTime ?? cursorEnd;
    if (oldest <= start - 72 * 3600_000) break;
    cursorEnd = oldest - 1;
    if (batch.length < 1000) break;
    await sleep(20);
  }
  return merged.filter((r) => r.closeTime >= start - 3600_000 && r.closeTime <= end + 60_000);
}

async function resolveSymbols() {
  const { getExchangeProvider } = await import("@/src/server/exchange");
  const provider = getExchangeProvider();
  const quotes = resolveQuoteAssets(env.BINANCE_PLATFORM, env.MARKET_DATA_QUOTE_ASSETS);
  const info = await provider.getExchangeInfo();
  const tradeable = filterTradeableUniverse(info.symbols ?? [], { quoteAssets: quotes });
  const tickers = (await provider.listTickers24h?.().catch(() => [])) ?? [];
  const vol = new Map(tickers.map((t) => [t.symbol, t.volume24h]));
  const tryS = tradeable.filter((s) => s.quoteAsset === "TRY").sort((a, b) => (vol.get(b.symbol) ?? 0) - (vol.get(a.symbol) ?? 0));
  const usdt = tradeable.filter((s) => s.quoteAsset === "USDT").sort((a, b) => (vol.get(b.symbol) ?? 0) - (vol.get(a.symbol) ?? 0));
  const half = Math.ceil(MAX_SYMBOLS / 2);
  return [...tryS.slice(0, half), ...usdt.slice(0, MAX_SYMBOLS - half)].map((s) => s.symbol.toUpperCase()).slice(0, MAX_SYMBOLS);
}

function runParadigm(
  name: ParadigmName,
  panel: SymbolPanel[],
  btc: KlineItem[],
  rebalanceMin: number,
  holdMin: number,
  startIdx: number,
  endIdx: number,
  costPct: number,
): ParadigmTrade[] {
  const trades: ParadigmTrade[] = [];
  for (let idx = startIdx; idx < endIdx; idx += rebalanceMin) {
    const t = panel[0]?.klines[idx]?.closeTime ?? 0;
    if (t < DATASET_START || t > DATASET_END) continue;
    const split = splitOf(t);
    let trade: ParadigmTrade | null = null;
    switch (name) {
      case "CROSS_SECTIONAL_RELATIVE_STRENGTH":
        trade = simulateCrossSectionalRS({ panel, idx, split, holdMin, topN: 3, lookbackMin: 24 * 60, costPct });
        break;
      case "BTC_REGIME_CONDITIONED_ROTATION":
        trade = simulateBtcRegimeRotation({ panel, btc, idx, split, holdMin, costPct });
        break;
      case "MULTI_DAY_SWING_MOMENTUM":
        trade = simulateMultiDaySwing({ panel, idx, split, holdMin, costPct });
        break;
      case "CROSS_SECTIONAL_MEAN_REVERSION":
        trade = simulateCrossSectionalMeanReversion({ panel, idx, split, holdMin, costPct });
        break;
      case "VOLATILITY_BREAKOUT_SWING":
        trade = simulateVolatilityBreakoutSwing({ panel, idx, split, holdMin, costPct });
        break;
      case "RELATIVE_STRENGTH_ROTATION_BASKET":
        trade = simulateBasketRotation({ panel, idx, split, holdMin, topN: 5, costPct });
        break;
      case "PAIR_RELATIVE_VALUE":
        trade = simulatePairRelativeValue({ panel, idx, split, holdMin, costPct });
        break;
    }
    if (trade) trades.push(trade);
  }
  return trades;
}

const PARADIGM_CONFIG: Record<ParadigmName, { rebalanceMin: number; holdMin: number }> = {
  CROSS_SECTIONAL_RELATIVE_STRENGTH: { rebalanceMin: 8 * 60, holdMin: 8 * 60 },
  BTC_REGIME_CONDITIONED_ROTATION: { rebalanceMin: 8 * 60, holdMin: 8 * 60 },
  MULTI_DAY_SWING_MOMENTUM: { rebalanceMin: 24 * 60, holdMin: 24 * 60 },
  CROSS_SECTIONAL_MEAN_REVERSION: { rebalanceMin: 8 * 60, holdMin: 8 * 60 },
  VOLATILITY_BREAKOUT_SWING: { rebalanceMin: 12 * 60, holdMin: 12 * 60 },
  RELATIVE_STRENGTH_ROTATION_BASKET: { rebalanceMin: 12 * 60, holdMin: 12 * 60 },
  PAIR_RELATIVE_VALUE: { rebalanceMin: 8 * 60, holdMin: 8 * 60 },
};

async function main() {
  const headStart = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const symbols = await resolveSymbols();
  const marketData: SymbolPanel[] = [];
  for (const symbol of symbols) {
    const klines = await fetchKlines(symbol, DATASET_START, DATASET_END);
    console.log(`${symbol}: ${klines.length}`);
    if (klines.length > 500) {
      marketData.push({
        symbol,
        klines,
        quoteAsset: symbol.endsWith("TRY") ? "TRY" : symbol.endsWith("USDT") ? "USDT" : "OTHER",
      });
    }
  }

  const btc = marketData.find((m) => m.symbol === "BTCTRY" || m.symbol === "BTCUSDT")?.klines ?? marketData[0]?.klines ?? [];
  const startIdx = 24 * 60;
  const endIdx = Math.min(...marketData.map((m) => m.klines.length - 48 * 60));

  const paradigmResults = PARADIGM_NAMES.map((name) => {
    const cfg = PARADIGM_CONFIG[name];
    const all = runParadigm(name, marketData, btc, cfg.rebalanceMin, cfg.holdMin, startIdx, endIdx, PARADIGM_COST.realisticRoundTripPct);
    const val = all.filter((t) => t.split === "VALIDATION");
    const test = all.filter((t) => t.split === "TEST");
    const valStats = computeParadigmStats(val);
    const testStats = computeParadigmStats(test);
    const valPass = passesValidationGate(valStats);
    const testPass = valPass && passesFinalGate(testStats);
    return {
      name,
      validationTrades: valStats.trades,
      validationNetPnl: valStats.netPnl,
      validationExpectancy: valStats.expectancy,
      validationProfitFactor: valStats.profitFactor,
      validationPass: valPass,
      finalTrades: testStats.trades,
      finalNetPnl: testStats.netPnl,
      finalExpectancy: testStats.expectancy,
      finalProfitFactor: testStats.profitFactor,
      finalMaxDrawdown: testStats.maxDrawdown,
      finalPass: testPass,
      turnover: valStats.turnover + testStats.turnover,
      deployable: name !== "PAIR_RELATIVE_VALUE",
    };
  });

  const passing = paradigmResults.filter((p) => p.validationPass);
  const best = [...paradigmResults]
    .filter((p) => p.deployable)
    .sort((a, b) => b.validationExpectancy - a.validationExpectancy)[0];

  let robustness = { periodsTested: 0, positivePeriods: 0, negativePeriods: 0, details: [] as Array<{ period: string; netPnl: number }> };
  const finalPassing = paradigmResults.filter((p) => p.finalPass && p.deployable);

  if (finalPassing.length > 0) {
    const bestName = finalPassing[0].name;
    const cfg = PARADIGM_CONFIG[bestName as ParadigmName];
    for (const period of ROBUSTNESS_PERIODS) {
      const periodData: SymbolPanel[] = [];
      for (const symbol of symbols.slice(0, marketData.length)) {
        const klines = await fetchKlines(symbol, period.start, period.end);
        if (klines.length > 300) {
          periodData.push({ symbol, klines, quoteAsset: symbol.endsWith("TRY") ? "TRY" : "USDT" });
        }
      }
      if (periodData.length < 3) continue;
      const pBtc = periodData.find((m) => m.symbol === "BTCTRY" || m.symbol === "BTCUSDT")?.klines ?? periodData[0].klines;
      const pStart = 24 * 60;
      const pEnd = Math.min(...periodData.map((m) => m.klines.length - cfg.holdMin - 60));
      const trades: ParadigmTrade[] = [];
      for (let idx = pStart; idx < pEnd; idx += cfg.rebalanceMin) {
        const t = periodData[0]?.klines[idx]?.closeTime ?? 0;
        if (t < period.start || t > period.end) continue;
        let trade: ParadigmTrade | null = null;
        const split = "TEST" as Split;
        switch (bestName) {
          case "CROSS_SECTIONAL_RELATIVE_STRENGTH":
            trade = simulateCrossSectionalRS({ panel: periodData, idx, split, holdMin: cfg.holdMin, topN: 3, lookbackMin: 24 * 60, costPct: PARADIGM_COST.realisticRoundTripPct });
            break;
          case "BTC_REGIME_CONDITIONED_ROTATION":
            trade = simulateBtcRegimeRotation({ panel: periodData, btc: pBtc, idx, split, holdMin: cfg.holdMin, costPct: PARADIGM_COST.realisticRoundTripPct });
            break;
          default:
            trade = simulateBasketRotation({ panel: periodData, idx, split, holdMin: cfg.holdMin, topN: 5, costPct: PARADIGM_COST.realisticRoundTripPct });
        }
        if (trade) trades.push(trade);
      }
      const stats = computeParadigmStats(trades);
      robustness.periodsTested += 1;
      if (stats.netPnl > 0) robustness.positivePeriods += 1;
      else robustness.negativePeriods += 1;
      robustness.details.push({ period: period.label, netPnl: stats.netPnl });
    }
  }

  const bestFinal = paradigmResults.find((p) => p.finalPass && p.deployable);
  const strategyVerdict = bestFinal
    ? bestFinal.name.replace(/_/g, "_").includes("CROSS_SECTIONAL")
      ? "CROSS_SECTIONAL_RS_EDGE"
      : bestFinal.name.includes("BTC")
        ? "BTC_ROTATION_EDGE"
        : bestFinal.name.includes("SWING")
          ? "SWING_MOMENTUM_EDGE"
          : bestFinal.name.includes("BASKET")
            ? "BASKET_ROTATION_EDGE"
            : "PARTIAL_ALTERNATIVE_EDGE"
    : "NO_ALTERNATIVE_EDGE";

  const result = {
    verdict: bestFinal ? "PASS" : passing.length > 0 ? "PARTIAL" : "FAIL",
    headStart,
    dataset: {
      start: new Date(DATASET_START).toISOString(),
      end: new Date(DATASET_END).toISOString(),
      trainEnd: new Date(TRAIN_END).toISOString(),
      valEnd: new Date(VAL_END).toISOString(),
      symbols: marketData.length,
      trySymbols: marketData.filter((m) => m.quoteAsset === "TRY").length,
      usdtSymbols: marketData.filter((m) => m.quoteAsset === "USDT").length,
    },
    cost: PARADIGM_COST,
    paradigms: paradigmResults,
    passingParadigms: passing.map((p) => p.name),
    finalPassingParadigms: finalPassing.map((p) => p.name),
    bestParadigm: bestFinal?.name ?? best?.name ?? "",
    robustness,
    ai: { tested: false, preAiExpectancy: bestFinal?.finalExpectancy ?? null, postAiExpectancy: null, roleMismatch: false },
    strategyVerdict,
    productionReady: Boolean(bestFinal),
    recommendedPaperDuration: bestFinal?.name.includes("SWING") ? "48h-7d" : bestFinal ? "24h-48h" : "N/A",
    run15hPaper: "NO",
    nextPhase: bestFinal ? "PRODUCTION_ARCHITECTURE_IMPLEMENTATION" : "BETTER_DATA_UNIVERSE_OR_BUSINESS_MODEL",
    doNotContinueBlindTuning: !bestFinal,
  };

  writeJson(path.join(ARTIFACT, "alt-paradigm-raw.json"), result);
  writeJson(path.join(process.cwd(), "kripto-alternative-market-paradigm-result.json"), {
    verdict: result.verdict,
    dataset: { start: result.dataset.start, end: result.dataset.end, symbols: result.dataset.symbols },
    paradigms: paradigmResults.map((p) => ({
      name: p.name,
      validationTrades: p.validationTrades,
      validationNetPnl: p.validationNetPnl,
      validationExpectancy: p.validationExpectancy,
      validationProfitFactor: p.validationProfitFactor,
      finalTrades: p.finalTrades,
      finalNetPnl: p.finalNetPnl,
      finalExpectancy: p.finalExpectancy,
      finalProfitFactor: p.finalProfitFactor,
      finalMaxDrawdown: p.finalMaxDrawdown,
    })),
    bestParadigm: result.bestParadigm,
    robustness: result.robustness,
    ai: result.ai,
    strategyVerdict: result.strategyVerdict,
    productionReady: result.productionReady,
    recommendedPaperDuration: result.recommendedPaperDuration,
    nextPhase: result.nextPhase,
  });

  const report = buildReport(result, paradigmResults);
  fs.writeFileSync(path.join(process.cwd(), "KRIPTO_ALTERNATIVE_MARKET_PARADIGM_REPORT.md"), report, "utf8");
  console.log(JSON.stringify({ bestParadigm: result.bestParadigm, passing: result.passingParadigms, strategyVerdict: result.strategyVerdict }, null, 2));
}

function buildReport(r: Record<string, unknown>, paradigms: Array<Record<string, unknown>>) {
  return `# KRIPTO Alternative Market Paradigm Report

## 1. Executive Summary

Fresh dataset (2026-07-15 → 2026-08-04) üzerinde 7 alternatif paradigm test edildi.

- **Best paradigm:** ${r.bestParadigm || "none"}
- **STRATEGY_VERDICT:** ${r.strategyVerdict}
- **PRODUCTION_READY:** ${r.productionReady}
- **NEXT_PHASE:** ${r.nextPhase}

## 2–7. Dataset & Cost

${JSON.stringify(r.dataset, null, 2)}

Realistic round-trip: **${(r.cost as { realisticRoundTripPct: number }).realisticRoundTripPct}%**

## 8–14. Paradigm Results

| Paradigm | VAL Exp | VAL PF | VAL Net | TEST Exp | TEST PF | TEST Net | Pass |
|----------|--------:|-------:|--------:|---------:|--------:|---------:|------|
${paradigms.map((p) => `| ${p.name} | ${p.validationExpectancy} | ${p.validationProfitFactor} | ${p.validationNetPnl} | ${p.finalExpectancy} | ${p.finalProfitFactor} | ${p.finalNetPnl} | ${p.validationPass}/${p.finalPass} |`).join("\n")}

## 15–28. Verdict

**DO_NOT_CONTINUE_BLIND_TUNING:** ${r.doNotContinueBlindTuning}

Robustness: ${JSON.stringify(r.robustness)}

---
*Generated ${new Date().toISOString()}*
`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
