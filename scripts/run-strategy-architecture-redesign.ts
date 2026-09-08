/**
 * Strategy Architecture Redesign — multi-setup edge discovery on fresh dataset.
 * Usage: npx tsx scripts/run-strategy-architecture-redesign.ts
 */
import "./load-dotenv.cjs";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { env } from "@/lib/config";
import { resolveBinanceTakerFeeRate } from "@/src/server/execution/fee-profile";
import { scoreContext } from "@/src/server/scanner/signal-scoring.engine";
import {
  computeForensicExcursion,
  isPositiveEdgeClass,
} from "@/src/server/scanner/scanner-discovery-v2.service";
import {
  buildDiversifiedShortlist,
  evaluateAllSetupFamilies,
  SETUP_CONTRACTS,
  SETUP_FAMILY_NAMES,
  type SetupFamilyHit,
  type SetupFamilyName,
} from "@/src/server/strategy-architecture/setup-family-registry.service";
import { buildMarketContextFromKlines } from "@/src/server/trading-core/backtest/paper-round-context";
import { buildPaperRoundAiProxy, evaluatePaperRoundGate } from "@/src/server/trading-core/backtest/paper-round-gates";
import { filterTradeableUniverse, resolveQuoteAssets } from "@/src/server/market-data/spine/universe";
import type { KlineItem } from "@/src/types/exchange";

process.env.LIVE_TRADING_ENABLED = "false";
process.env.LIVE_AUTHORIZATION = "DISABLED";
process.env.EXECUTION_MODE = "PAPER";

const DATASET_START = Date.parse("2026-08-04T00:00:00.000Z");
const DATASET_END = Date.parse("2026-08-18T00:00:00.000Z");
const DURATION = DATASET_END - DATASET_START;
const TRAIN_END = DATASET_START + DURATION * 0.55;
const VAL_END = DATASET_START + DURATION * 0.8;
const STRIDE = 15;
const MAX_SYMBOLS = 24;
const TAKER_FEE_RATE = resolveBinanceTakerFeeRate();
const REALISTIC_SLIPPAGE_RT = 0.14;
const REALISTIC_ROUND_TRIP = 0.3 + REALISTIC_SLIPPAGE_RT;
const REALISTIC_SLIPPAGE_BPS = 7;
const MIN_VAL_SAMPLES = 12;
const ARTIFACT = path.join(process.cwd(), "artifacts", "strategy-architecture-redesign", new Date().toISOString().replace(/[:.]/g, "-"));

type Split = "TRAIN" | "VALIDATION" | "TEST";
type SignalRow = {
  symbol: string;
  idx: number;
  closeTime: number;
  split: Split;
  family: SetupFamilyName;
  confidence: number;
  tier: string;
  positiveEdge: boolean;
  maxNetOpp: number;
  outcome: "TP_FIRST" | "SL_FIRST" | "TIMEOUT" | "AMBIGUOUS";
};

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
function pct(n: number, d: number) {
  return d > 0 ? Number(((n / d) * 100).toFixed(2)) : 0;
}

async function fetchKlines(symbol: string): Promise<KlineItem[]> {
  let cursorEnd = DATASET_END + 60_000;
  const merged: KlineItem[] = [];
  const seen = new Set<number>();
  const base = (env.BINANCE_PUBLIC_HTTP_BASES ?? "https://api.binance.me").split(",")[0]?.trim() || "https://api.binance.me";
  for (let page = 0; page < 16; page += 1) {
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
    if (oldest <= DATASET_START - 48 * 3600_000) break;
    cursorEnd = oldest - 1;
    if (batch.length < 1000) break;
    await sleep(25);
  }
  return merged.filter((r) => r.closeTime >= DATASET_START - 3600_000 && r.closeTime <= DATASET_END + 60_000);
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

function simulateTrade(klines: KlineItem[], idx: number, tp: number, sl: number, hold: number, slipBps: number) {
  const entryIdx = idx + 1;
  const raw = klines[entryIdx]?.open ?? 0;
  if (raw <= 0) return { net: 0, win: false };
  const entry = raw * (1 + slipBps / 10_000);
  const notional = 1000;
  const qty = notional / entry;
  const tpPx = entry * (1 + tp / 100);
  const slPx = entry * (1 - sl / 100);
  let exit = entry;
  let win = false;
  for (let i = entryIdx; i < Math.min(klines.length, entryIdx + hold); i += 1) {
    const c = klines[i];
    if (c.high >= tpPx && c.low <= slPx) break;
    if (c.high >= tpPx) {
      exit = tpPx * (1 - slipBps / 10_000);
      win = true;
      break;
    }
    if (c.low <= slPx) {
      exit = slPx * (1 - slipBps / 10_000);
      break;
    }
  }
  const fee = notional * TAKER_FEE_RATE * 2;
  return { net: (exit - entry) * qty - fee, win };
}

function simulateTpSl(klines: KlineItem[], idx: number, tp: number, sl: number) {
  const entryIdx = idx + 1;
  const entry = klines[entryIdx]?.open ?? 0;
  if (entry <= 0) return "TIMEOUT" as const;
  const tpPx = entry * (1 + tp / 100);
  const slPx = entry * (1 - sl / 100);
  for (let i = entryIdx; i < Math.min(klines.length, entryIdx + 90); i += 1) {
    const c = klines[i];
    if (c.high >= tpPx && c.low <= slPx) return "AMBIGUOUS" as const;
    if (c.high >= tpPx) return "TP_FIRST" as const;
    if (c.low <= slPx) return "SL_FIRST" as const;
  }
  return "TIMEOUT" as const;
}

function expectancyStats(trades: Array<{ net: number; win: boolean }>) {
  const wins = trades.filter((t) => t.win).length;
  const netPnl = trades.reduce((s, t) => s + t.net, 0);
  const grossW = trades.filter((t) => t.win).reduce((s, t) => s + t.net, 0);
  const grossL = Math.abs(trades.filter((t) => !t.win).reduce((s, t) => s + t.net, 0));
  let peak = 10_000;
  let eq = 10_000;
  let maxDd = 0;
  for (const t of trades) {
    eq += t.net;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, ((peak - eq) / peak) * 100);
  }
  return {
    trades: trades.length,
    wins,
    losses: trades.length - wins,
    netPnl,
    expectancy: trades.length ? netPnl / trades.length : 0,
    profitFactor: grossL > 0 ? grossW / grossL : grossW > 0 ? 999 : 0,
    maxDrawdown: maxDd,
  };
}

async function main() {
  const headStart = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const symbols = await resolveSymbols();
  const marketData: Array<{ symbol: string; klines: KlineItem[] }> = [];
  for (const symbol of symbols) {
    const klines = await fetchKlines(symbol);
    console.log(`${symbol}: ${klines.length}`);
    if (klines.length > 150) marketData.push({ symbol, klines });
  }

  const btc = marketData.find((m) => m.symbol === "BTCTRY" || m.symbol === "BTCUSDT");
  const startIdx = 120;
  const endIdx = Math.min(...marketData.map((m) => m.klines.length - 130));

  const allSignals: SignalRow[] = [];
  let top1Pos = 0;
  let top3Pos = 0;
  let windowsWithPos = 0;

  for (let idx = startIdx; idx < endIdx; idx += STRIDE) {
    const t = marketData[0]?.klines[idx]?.closeTime ?? 0;
    if (t < DATASET_START || t > DATASET_END) continue;

    const btcIdx = btc?.klines.findIndex((k) => k.closeTime >= t) ?? -1;
    const windowHits: Array<{ symbol: string; hit: SetupFamilyHit; positive: boolean }> = [];

    for (const item of marketData) {
      const context = buildMarketContextFromKlines({ symbol: item.symbol, klines: item.klines, idx });
      if (!context) continue;
      const hits = evaluateAllSetupFamilies({
        context,
        klines: item.klines,
        idx,
        btcKlines: btc?.klines,
        btcIdx: btcIdx >= 0 ? btcIdx : undefined,
      });
      const best = hits[0];
      if (!best || best.setupConfidence < 42) continue;

      const forensic = computeForensicExcursion({ klines: item.klines, idx, roundTripCostPct: REALISTIC_ROUND_TRIP });
      const exit = SETUP_CONTRACTS[best.family].defaultExit;
      const outcome = simulateTpSl(item.klines, idx, exit.tpPct, exit.slPct);
      const positive = isPositiveEdgeClass(forensic.qualityClass);

      allSignals.push({
        symbol: item.symbol,
        idx,
        closeTime: t,
        split: splitOf(t),
        family: best.family,
        confidence: best.setupConfidence,
        tier: best.tier,
        positiveEdge: positive,
        maxNetOpp: forensic.maximumNetOpportunity,
        outcome,
      });
      windowHits.push({ symbol: item.symbol, hit: best, positive });
    }

    const posSyms = new Set(windowHits.filter((w) => w.positive).map((w) => w.symbol));
    if (posSyms.size > 0) {
      windowsWithPos += 1;
      const sorted = [...windowHits].sort((a, b) => b.hit.setupConfidence - a.hit.setupConfidence);
      if (sorted[0] && posSyms.has(sorted[0].symbol)) top1Pos += 1;
      const diversified = buildDiversifiedShortlist(windowHits.map((w) => ({ symbol: w.symbol, hit: w.hit })), 3);
      if (diversified.some((d) => posSyms.has(d.symbol))) top3Pos += 1;
    }
  }

  // Baseline production scanner selected
  let baselineSelected = 0;
  let baselinePos = 0;
  for (let idx = startIdx; idx < endIdx; idx += STRIDE) {
    const t = marketData[0]?.klines[idx]?.closeTime ?? 0;
    if (t < DATASET_START || t > DATASET_END) continue;
    let best: { score: number; pos: boolean } | null = null;
    for (const item of marketData) {
      const context = buildMarketContextFromKlines({ symbol: item.symbol, klines: item.klines, idx });
      if (!context) continue;
      const score = scoreContext(context);
      const proxy = buildPaperRoundAiProxy(context, score);
      const gate = evaluatePaperRoundGate({
        context,
        score,
        ai: proxy,
        maxWaitSec: 3600,
        targetProfitPct: env.EXECUTION_DEFAULT_TAKE_PROFIT_PERCENT,
        learningMemory: { hardBlock: false, minConfidenceDelta: 0, sameSymbolLossCount: 0 },
      });
      if (score.status !== "QUALIFIED" && !gate.ok) continue;
      const forensic = computeForensicExcursion({ klines: item.klines, idx, roundTripCostPct: REALISTIC_ROUND_TRIP });
      const pos = isPositiveEdgeClass(forensic.qualityClass);
      if (!best || score.score > best.score) best = { score: score.score, pos };
    }
    if (best) {
      baselineSelected += 1;
      if (best.pos) baselinePos += 1;
    }
  }

  const setupResults = SETUP_FAMILY_NAMES.map((name) => {
    const train = allSignals.filter((s) => s.family === name && s.split === "TRAIN");
    const val = allSignals.filter((s) => s.family === name && s.split === "VALIDATION");
    const test = allSignals.filter((s) => s.family === name && s.split === "TEST");

    const valTrades: Array<{ net: number; win: boolean }> = [];
    for (const s of val) {
      const klines = marketData.find((m) => m.symbol === s.symbol)!.klines;
      const exit = SETUP_CONTRACTS[name].defaultExit;
      valTrades.push(simulateTrade(klines, s.idx, exit.tpPct, exit.slPct, exit.holdMin, REALISTIC_SLIPPAGE_BPS));
    }
    const valStats = expectancyStats(valTrades);

    const testTrades: Array<{ net: number; win: boolean }> = [];
    for (const s of test) {
      const klines = marketData.find((m) => m.symbol === s.symbol)!.klines;
      const exit = SETUP_CONTRACTS[name].defaultExit;
      testTrades.push(simulateTrade(klines, s.idx, exit.tpPct, exit.slPct, exit.holdMin, REALISTIC_SLIPPAGE_BPS));
    }
    const testStats = expectancyStats(testTrades);

    const valPass =
      val.length >= MIN_VAL_SAMPLES &&
      valStats.expectancy > 0 &&
      valStats.profitFactor > 1 &&
      valStats.netPnl > 0;

    return {
      name,
      trainSamples: train.length,
      validationSamples: val.length,
      finalTestSamples: test.length,
      validationPositiveEdgeRate: pct(val.filter((s) => s.positiveEdge).length, val.length),
      validationExpectancy: Number(valStats.expectancy.toFixed(4)),
      validationProfitFactor: Number(valStats.profitFactor.toFixed(4)),
      validationNetPnl: Number(valStats.netPnl.toFixed(2)),
      validationPass: valPass,
      finalExpectancy: test.length ? Number(testStats.expectancy.toFixed(4)) : null,
      finalProfitFactor: test.length ? Number(testStats.profitFactor.toFixed(4)) : null,
      finalNetPnl: test.length ? Number(testStats.netPnl.toFixed(2)) : null,
      finalStats: testStats,
    };
  });

  const passingSetups = setupResults.filter((s) => s.validationPass);

  const portfolioTrades: Array<{ net: number; win: boolean }> = [];
  if (passingSetups.length > 0) {
    const testSignals = allSignals.filter(
      (s) => s.split === "TEST" && passingSetups.some((p) => p.name === s.family),
    );
    const byWindow = new Map<number, SignalRow[]>();
    for (const s of testSignals) {
      const list = byWindow.get(s.idx) ?? [];
      list.push(s);
      byWindow.set(s.idx, list);
    }
    const usedSymbols = new Set<string>();
    for (const [, rows] of byWindow) {
      const shortlist = buildDiversifiedShortlist(
        rows.map((r) => ({ symbol: r.symbol, hit: { family: r.family, setupConfidence: r.confidence, tier: r.tier as SetupFamilyHit["tier"], reasons: [] } })),
        3,
      );
      for (const pick of shortlist) {
        if (usedSymbols.has(pick.symbol)) continue;
        usedSymbols.add(pick.symbol);
        const row = rows.find((r) => r.symbol === pick.symbol)!;
        const klines = marketData.find((m) => m.symbol === row.symbol)!.klines;
        const exit = SETUP_CONTRACTS[row.family].defaultExit;
        portfolioTrades.push(simulateTrade(klines, row.idx, exit.tpPct, exit.slPct, exit.holdMin, REALISTIC_SLIPPAGE_BPS));
      }
    }
  }

  const portfolioStats = expectancyStats(portfolioTrades);
  const finalTestPass =
    portfolioStats.trades >= 5 &&
    portfolioStats.netPnl > 0 &&
    portfolioStats.expectancy > 0 &&
    portfolioStats.profitFactor > 1;

  const strategyVerdict = finalTestPass
    ? "POSITIVE_MULTI_SETUP_EDGE"
    : passingSetups.length > 0
      ? "PARTIAL_SETUP_EDGE_VALIDATION_ONLY"
      : "NO_EDGE_ACROSS_TESTED_SETUPS";

  const nextPhase = finalTestPass
    ? "MASTER_ALIGNMENT_REVIEW"
    : passingSetups.length > 0
      ? "EXIT_MODEL_REDESIGN"
      : "ALTERNATIVE_MARKET_PARADIGM";

  const result = {
    verdict: finalTestPass ? "PASS" : passingSetups.length > 0 ? "PARTIAL" : "FAIL",
    headStart,
    dataset: {
      start: new Date(DATASET_START).toISOString(),
      end: new Date(DATASET_END).toISOString(),
      trainEnd: new Date(TRAIN_END).toISOString(),
      valEnd: new Date(VAL_END).toISOString(),
      windows: Math.floor((endIdx - startIdx) / STRIDE),
      symbols: marketData.length,
    },
    baseline: {
      selected: baselineSelected,
      positiveEdgeRate: pct(baselinePos, baselineSelected),
    },
    topN: {
      top1PositiveCapture: pct(top1Pos, windowsWithPos),
      top3PositiveCapture: pct(top3Pos, windowsWithPos),
      windowsWithPositive: windowsWithPos,
    },
    setups: setupResults,
    passingSetupFamilies: passingSetups.map((s) => s.name),
    rejectedSetupFamilies: setupResults.filter((s) => !s.validationPass).map((s) => s.name),
    portfolio: portfolioStats,
    realisticRoundTripCost: REALISTIC_ROUND_TRIP,
    ai: { analysed: 0, providerBuy: 0, hybridBuy: 0, finalBuy: 0, preAiExpectancy: portfolioStats.expectancy, postAiExpectancy: null },
    productionWired: false,
    strategyArchitectureVerdict: strategyVerdict,
    run15hPaper: "NO",
    nextPhase,
  };

  writeJson(path.join(ARTIFACT, "strategy-arch-raw.json"), result);
  writeJson(path.join(process.cwd(), "kripto-strategy-architecture-redesign-result.json"), {
    verdict: result.verdict,
    dataset: result.dataset,
    setups: result.setups.map((s) => ({
      name: s.name,
      trainSamples: s.trainSamples,
      validationSamples: s.validationSamples,
      finalTestSamples: s.finalTestSamples,
      validationExpectancy: s.validationExpectancy,
      validationProfitFactor: s.validationProfitFactor,
      finalExpectancy: s.finalExpectancy,
      finalProfitFactor: s.finalProfitFactor,
      finalNetPnl: s.finalNetPnl,
    })),
    portfolio: result.portfolio,
    ai: result.ai,
    productionWired: result.productionWired,
    strategyArchitectureVerdict: result.strategyArchitectureVerdict,
    run15hPaper: result.run15hPaper,
    nextPhase: result.nextPhase,
  });

  const report = buildReport(result);
  fs.writeFileSync(path.join(process.cwd(), "KRIPTO_STRATEGY_ARCHITECTURE_REDESIGN_REPORT.md"), report, "utf8");
  console.log(JSON.stringify({ passing: result.passingSetupFamilies, portfolio: result.portfolio, strategyVerdict, nextPhase }, null, 2));
}

function buildReport(r: Record<string, unknown>) {
  const setups = r.setups as Array<Record<string, unknown>>;
  const p = r.portfolio as Record<string, number>;
  const t = r.topN as Record<string, number>;
  return `# KRIPTO Strategy Architecture Redesign Report

## 1. Executive Summary

Fresh dataset (2026-08-04 → 2026-08-18) üzerinde 7 setup family bağımsız test edildi. Multi-setup architecture offline simulation. Production **değiştirilmedi**.

- **Passing setups (VALIDATION):** ${(r.passingSetupFamilies as string[]).join(", ") || "none"}
- **STRATEGY_ARCHITECTURE_VERDICT:** ${r.strategyArchitectureVerdict}
- **NEXT_PHASE:** ${r.nextPhase}

## 2. Starting HEAD

\`${r.headStart}\`

## 3–6. Dataset, Baseline, Architecture

${JSON.stringify(r.dataset, null, 2)}

Baseline positive-edge capture: ${(r.baseline as { positiveEdgeRate: number }).positiveEdgeRate}%

## 7–13. Setup Family Results

${setups.map((s) => `### ${s.name}\n- VAL samples: ${s.validationSamples} | expectancy: ${s.validationExpectancy} | PF: ${s.validationProfitFactor} | pass: ${s.validationPass}\n- FINAL: expectancy ${s.finalExpectancy} | PF ${s.finalProfitFactor} | net ${s.finalNetPnl}`).join("\n\n")}

## 14–17. Top-N & Portfolio

Top-1 capture: ${t.top1PositiveCapture}% | Top-3/diversified: ${t.top3PositiveCapture}%

Portfolio FINAL TEST: trades ${p.trades} | net ${Number(p.netPnl).toFixed(2)} | expectancy ${Number(p.expectancy).toFixed(4)} | PF ${Number(p.profitFactor).toFixed(2)}

## 18–31. Verdict

**PRODUCTION_WIRED:** false | **RUN_15H_PAPER:** NO

---
*Generated ${new Date().toISOString()}*
`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
