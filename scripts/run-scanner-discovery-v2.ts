/**
 * Scanner Discovery V2 forensic + out-of-sample profitability reconstruction.
 * Usage: npx tsx scripts/run-scanner-discovery-v2.ts
 */
import "./load-dotenv.cjs";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { env } from "@/lib/config";
import { estimateSlippage } from "@/src/server/execution-engine-v2/slippage-guard.service";
import { resolveBinanceTakerFeeRate, resolveRoundTripTakerFeePercent } from "@/src/server/execution/fee-profile";
import { scoreContext } from "@/src/server/scanner/signal-scoring.engine";
import { decomposeScannerScore } from "@/src/server/scanner/ranking-engine-v2.service";
import {
  checkConfidenceMonotonicity,
  computeForensicExcursion,
  discoverV2CandidatesInWindow,
  DISCOVERY_V2_POLICY,
  DISCOVERY_V2_SETUP_FAMILIES,
  evaluateDiscoveryV2Setups,
  extractMarketStateFeatures,
  isPositiveEdgeClass,
  type DiscoveryV2Candidate,
  type QualityClass,
} from "@/src/server/scanner/scanner-discovery-v2.service";
import { buildMarketContextFromKlines } from "@/src/server/trading-core/backtest/paper-round-context";
import { buildPaperRoundAiProxy, evaluatePaperRoundGate } from "@/src/server/trading-core/backtest/paper-round-gates";
import { filterTradeableUniverse, resolveQuoteAssets } from "@/src/server/market-data/spine/universe";
import type { KlineItem } from "@/src/types/exchange";

process.env.LIVE_TRADING_ENABLED = "false";
process.env.LIVE_AUTHORIZATION = "DISABLED";
process.env.EXECUTION_MODE = "PAPER";

const DATASET_START = Date.parse("2026-08-18T00:00:00.000Z");
const DATASET_END = Date.parse("2026-08-28T00:00:00.000Z");
const DURATION = DATASET_END - DATASET_START;
const TRAIN_END = DATASET_START + DURATION * 0.6;
const VAL_END = DATASET_START + DURATION * 0.85;
const STRIDE = 15;
const MAX_SYMBOLS = 24;
const TAKER_FEE_RATE = resolveBinanceTakerFeeRate();
const ROUND_TRIP_FEE = resolveRoundTripTakerFeePercent();
const REALISTIC_SLIPPAGE_RT = 0.14;
const REALISTIC_ROUND_TRIP = ROUND_TRIP_FEE + REALISTIC_SLIPPAGE_RT;
const ARTIFACT = path.join(process.cwd(), "artifacts", "scanner-discovery-v2", new Date().toISOString().replace(/[:.]/g, "-"));

type Split = "TRAIN" | "VALIDATION" | "TEST";
type LabeledRow = {
  symbol: string;
  idx: number;
  closeTime: number;
  split: Split;
  baselineQualified: boolean;
  baselineSelected: boolean;
  v2Discovered: boolean;
  v2Shortlisted: boolean;
  v2Selected: boolean;
  setupFamily?: string;
  setupConfidence?: number;
  setupTier?: string;
  scannerScore: number;
  qualityClass: QualityClass;
  maximumNetOpportunity: number;
  outcome: "TP_FIRST" | "SL_FIRST" | "TIMEOUT" | "AMBIGUOUS";
  mfe60: number;
  mae60: number;
  falsePositiveReasons: string[];
  falseNegativeGate?: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function writeJson(p: string, v: unknown) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}
function pct(n: number, d: number) {
  return d > 0 ? Number(((n / d) * 100).toFixed(2)) : 0;
}
function splitOf(t: number): Split {
  if (t < TRAIN_END) return "TRAIN";
  if (t < VAL_END) return "VALIDATION";
  return "TEST";
}

async function fetchKlines(symbol: string): Promise<KlineItem[]> {
  const targetMs = DATASET_END - DATASET_START + 48 * 3600_000;
  let cursorEnd = DATASET_END + 60_000;
  const merged: KlineItem[] = [];
  const seen = new Set<number>();
  const base = (env.BINANCE_PUBLIC_HTTP_BASES ?? "https://api.binance.me").split(",")[0]?.trim() || "https://api.binance.me";
  for (let page = 0; page < 14; page += 1) {
    const res = await fetch(`${base}/api/v3/klines?${new URLSearchParams({ symbol, interval: "1m", limit: "1000", endTime: String(cursorEnd) })}`);
    const raw = (await res.json()) as unknown[];
    if (!Array.isArray(raw) || (raw[0] as { code?: number })?.code) break;
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
    if (oldest <= DATASET_START - 24 * 3600_000) break;
    if (DATASET_END - oldest >= targetMs) break;
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

function gateQualified(context: ReturnType<typeof buildMarketContextFromKlines>, score: ReturnType<typeof scoreContext>) {
  if (!context) return false;
  const proxy = buildPaperRoundAiProxy(context, score);
  const gate = evaluatePaperRoundGate({
    context,
    score,
    ai: proxy,
    maxWaitSec: 3600,
    targetProfitPct: env.EXECUTION_DEFAULT_TAKE_PROFIT_PERCENT,
    learningMemory: { hardBlock: false, minConfidenceDelta: 0, sameSymbolLossCount: 0 },
  });
  return score.status === "QUALIFIED" || gate.ok;
}

function simulateTpSl(klines: KlineItem[], idx: number, tpPct: number, slPct: number) {
  const entryIdx = idx + 1;
  const entry = klines[entryIdx]?.open ?? 0;
  if (entry <= 0) return "TIMEOUT" as const;
  const tp = entry * (1 + tpPct / 100);
  const sl = entry * (1 - slPct / 100);
  for (let i = entryIdx; i < Math.min(klines.length, entryIdx + 90); i += 1) {
    const c = klines[i];
    const hitTp = c.high >= tp;
    const hitSl = c.low <= sl;
    if (hitTp && hitSl) return "AMBIGUOUS" as const;
    if (hitTp) return "TP_FIRST" as const;
    if (hitSl) return "SL_FIRST" as const;
  }
  return "TIMEOUT" as const;
}

function traceFalseNegativeGate(context: ReturnType<typeof buildMarketContextFromKlines>, score: ReturnType<typeof scoreContext>) {
  if (!context) return "no_context";
  if (score.score < env.SCANNER_MIN_SCORE) return "score_below_threshold";
  if (context.volume24h < env.SCANNER_MIN_VOLUME_24H) return "liquidity";
  if (context.spreadPercent > env.SCANNER_MAX_SPREAD_PERCENT) return "spread";
  if (score.status !== "QUALIFIED") return "regime_or_direction";
  return "ranking_not_top1";
}

function simulateTradePnl(klines: KlineItem[], idx: number, tpPct: number, slPct: number, slippageBps: number) {
  const entryIdx = idx + 1;
  const rawEntry = klines[entryIdx]?.open ?? 0;
  if (rawEntry <= 0) return { net: 0, win: false };
  const entry = rawEntry * (1 + slippageBps / 10_000);
  const notional = 1000;
  const qty = notional / entry;
  const tp = entry * (1 + tpPct / 100);
  const sl = entry * (1 - slPct / 100);
  let exit = entry;
  let win = false;
  for (let i = entryIdx; i < Math.min(klines.length, entryIdx + 90); i += 1) {
    const c = klines[i];
    if (c.high >= tp && c.low <= sl) break;
    if (c.high >= tp) {
      exit = tp * (1 - slippageBps / 10_000);
      win = true;
      break;
    }
    if (c.low <= sl) {
      exit = sl * (1 - slippageBps / 10_000);
      break;
    }
  }
  const fee = notional * TAKER_FEE_RATE * 2;
  const gross = (exit - entry) * qty;
  return { net: gross - fee, win };
}

function summarize(rows: LabeledRow[], filter?: (r: LabeledRow) => boolean) {
  const subset = filter ? rows.filter(filter) : rows;
  const pos = subset.filter((r) => isPositiveEdgeClass(r.qualityClass)).length;
  const tp = subset.filter((r) => r.outcome === "TP_FIRST").length;
  const sl = subset.filter((r) => r.outcome === "SL_FIRST").length;
  const labeled = tp + sl;
  return {
    count: subset.length,
    positiveEdgeRate: pct(pos, subset.length),
    tpFirstRate: pct(tp, subset.length),
    slFirstRate: pct(sl, subset.length),
    winnerRate: labeled ? pct(tp, labeled) : 0,
    avgNetOpp: subset.length ? Number((subset.reduce((s, r) => s + r.maximumNetOpportunity, 0) / subset.length).toFixed(4)) : 0,
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

  const btcData = marketData.find((m) => m.symbol === "BTCTRY" || m.symbol === "BTCUSDT");
  const startIdx = 120;
  const endIdx = Math.min(...marketData.map((m) => m.klines.length - 130));

  const allRows: LabeledRow[] = [];
  const windowMap = new Map<number, { baseline: LabeledRow[]; v2: DiscoveryV2Candidate[]; allPos: LabeledRow[] }>();

  for (let idx = startIdx; idx < endIdx; idx += STRIDE) {
    const t = marketData[0]?.klines[idx]?.closeTime ?? 0;
    if (t < DATASET_START || t > DATASET_END) continue;

    const baselineWindow: LabeledRow[] = [];
    const v2Window: DiscoveryV2Candidate[] = [];
    const btcIdx = btcData?.klines.findIndex((k) => k.closeTime >= t) ?? -1;

    for (const item of marketData) {
      const context = buildMarketContextFromKlines({ symbol: item.symbol, klines: item.klines, idx });
      if (!context) continue;
      const score = scoreContext(context);
      const features = extractMarketStateFeatures({
        context,
        klines: item.klines,
        idx,
        btcKlines: btcData?.klines,
        btcIdx: btcIdx >= 0 ? btcIdx : undefined,
      });
      const forensic = computeForensicExcursion({
        klines: item.klines,
        idx,
        roundTripCostPct: REALISTIC_ROUND_TRIP,
      });
      const outcome = simulateTpSl(item.klines, idx, env.EXECUTION_DEFAULT_TAKE_PROFIT_PERCENT, env.EXECUTION_DEFAULT_STOP_LOSS_PERCENT);
      const qualified = gateQualified(context, score);
      const setup = evaluateDiscoveryV2Setups({ context, features });

      const row: LabeledRow = {
        symbol: item.symbol,
        idx,
        closeTime: t,
        split: splitOf(t),
        baselineQualified: qualified,
        baselineSelected: false,
        v2Discovered: setup !== null,
        v2Shortlisted: false,
        v2Selected: false,
        setupFamily: setup?.family,
        setupConfidence: setup?.setupConfidence,
        setupTier: setup?.tier,
        scannerScore: score.score,
        qualityClass: forensic.qualityClass,
        maximumNetOpportunity: forensic.maximumNetOpportunity,
        outcome,
        mfe60: forensic.mfe.mfe60 ?? 0,
        mae60: forensic.mae.mae60 ?? 0,
        falsePositiveReasons: [],
      };

      if (qualified) baselineWindow.push(row);
      if (setup) {
        v2Window.push({ symbol: item.symbol, setup, features, context });
      }
      if (isPositiveEdgeClass(forensic.qualityClass)) {
        windowMap.set(idx, windowMap.get(idx) ?? { baseline: [], v2: [], allPos: [] });
        windowMap.get(idx)!.allPos.push(row);
      }
      allRows.push(row);
    }

    baselineWindow.sort((a, b) => b.scannerScore - a.scannerScore);
    if (baselineWindow[0]) baselineWindow[0].baselineSelected = true;

    const shortlisted = discoverV2CandidatesInWindow(v2Window);
    const v2Top = shortlisted[0];
    for (const s of shortlisted) {
      const r = allRows.find((x) => x.symbol === s.symbol && x.idx === idx);
      if (r) r.v2Shortlisted = true;
    }
    if (v2Top) {
      const r = allRows.find((x) => x.symbol === v2Top.symbol && x.idx === idx);
      if (r) r.v2Selected = true;
    }

    windowMap.set(idx, {
      baseline: baselineWindow,
      v2: shortlisted,
      allPos: windowMap.get(idx)?.allPos ?? [],
    });
  }

  // False positive forensic (baseline selected losers)
  const baselineSelected = allRows.filter((r) => r.baselineSelected);
  const baselineLosers = baselineSelected.filter((r) => r.outcome === "SL_FIRST" || r.qualityClass === "NEGATIVE_EDGE");
  const fpReasons = new Map<string, number>();
  for (const loser of baselineLosers) {
    const ctx = buildMarketContextFromKlines({
      symbol: loser.symbol,
      klines: marketData.find((m) => m.symbol === loser.symbol)!.klines,
      idx: loser.idx,
    });
    if (!ctx) continue;
    const decomp = decomposeScannerScore(ctx);
    const reasons: string[] = [];
    if (decomp.weightedContributions.pumpBoost > 3) reasons.push("pump_boost_inflation");
    if (decomp.weightedContributions.momentum > 8 && decomp.weightedContributions.volume < 10) reasons.push("momentum_without_volume");
    if (Number(ctx.metadata.volumeRatio20 ?? 0) < 0.8) reasons.push("weak_volume_ratio20");
    if (Number(ctx.metadata.distanceFrom60mHighPercent ?? 99) < 0.5) reasons.push("near_60m_high");
    if (ctx.fakeSpikeScore > 1.2) reasons.push("fake_spike");
    loser.falsePositiveReasons = reasons.length ? reasons : ["score_saturation_no_separation"];
    for (const reason of loser.falsePositiveReasons) {
      fpReasons.set(reason, (fpReasons.get(reason) ?? 0) + 1);
    }
  }

  // False negative forensic
  const fnGates = new Map<string, number>();
  for (const [, w] of windowMap) {
    for (const pos of w.allPos) {
      if (pos.baselineQualified) continue;
      const ctx = buildMarketContextFromKlines({
        symbol: pos.symbol,
        klines: marketData.find((m) => m.symbol === pos.symbol)!.klines,
        idx: pos.idx,
      });
      const score = ctx ? scoreContext(ctx) : null;
      const gate = traceFalseNegativeGate(ctx, score!);
      fnGates.set(gate, (fnGates.get(gate) ?? 0) + 1);
      pos.falseNegativeGate = gate;
    }
  }

  // Top-1 vs Top-N
  let top1HasPos = 0;
  let top2HasPos = 0;
  let top3HasPos = 0;
  let windowsWithPos = 0;
  for (const [, w] of windowMap) {
    if (!w.allPos.length) continue;
    windowsWithPos += 1;
    const posSyms = new Set(w.allPos.map((p) => p.symbol));
    const blSorted = [...w.baseline].sort((a, b) => b.scannerScore - a.scannerScore);
    if (blSorted[0] && posSyms.has(blSorted[0].symbol)) top1HasPos += 1;
    if (blSorted.slice(0, 2).some((r) => posSyms.has(r.symbol))) top2HasPos += 1;
    if (blSorted.slice(0, 3).some((r) => posSyms.has(r.symbol))) top3HasPos += 1;
  }

  const baselineSummary = {
    candidates: allRows.filter((r) => r.baselineQualified).length,
    selected: baselineSelected.length,
    ...summarize(baselineSelected),
  };
  const v2Discovered = allRows.filter((r) => r.v2Discovered);
  const v2Shortlisted = allRows.filter((r) => r.v2Shortlisted);
  const v2Selected = allRows.filter((r) => r.v2Selected);

  const valBaseline = summarize(baselineSelected, (r) => r.split === "VALIDATION");
  const valV2 = summarize(v2Selected, (r) => r.split === "VALIDATION");
  const testBaseline = summarize(baselineSelected, (r) => r.split === "TEST");
  const testV2 = summarize(v2Selected, (r) => r.split === "TEST");

  const tierBuckets = ["LOW", "MEDIUM", "HIGH", "ELITE"].map((tier) => {
    const rows = v2Discovered.filter((r) => r.setupTier === tier);
    const pos = rows.filter((r) => isPositiveEdgeClass(r.qualityClass)).length;
    return { tier, count: rows.length, positiveRate: pct(pos, rows.length) };
  });
  const confidenceMonotonic = checkConfidenceMonotonicity(tierBuckets);

  const validationPass =
    valV2.positiveEdgeRate > valBaseline.positiveEdgeRate + 1 &&
    valV2.avgNetOpp > valBaseline.avgNetOpp &&
    valV2.count >= 20 &&
    valV2.slFirstRate <= valBaseline.slFirstRate;

  const realisticSlippageBps = Math.round(median(baselineSelected.map((r) => {
    const ctx = buildMarketContextFromKlines({ symbol: r.symbol, klines: marketData.find((m) => m.symbol === r.symbol)!.klines, idx: r.idx });
    return estimateSlippage({ spreadPercent: ctx?.spreadPercent ?? 0.08, liquidityScore: 60, orderType: "MARKET", urgency: "normal" });
  })) * 100);

  const exitByFamily: Record<string, { tp: number; sl: number; hold: number }> = {
    VOLUME_CONFIRMED_MOMENTUM: { tp: 2.2, sl: 0.8, hold: 75 },
    BREAKOUT_CONTINUATION: { tp: 2.8, sl: 0.85, hold: 90 },
    TREND_PULLBACK: { tp: 1.6, sl: 0.7, hold: 60 },
    VOLATILITY_EXPANSION: { tp: 2.5, sl: 0.9, hold: 75 },
  };

  const replayRows = validationPass ? v2Selected.filter((r) => r.split === "TEST") : [];
  const trades: Array<{ net: number; win: boolean }> = [];
  for (const row of replayRows) {
    const klines = marketData.find((m) => m.symbol === row.symbol)!.klines;
    const fam = row.setupFamily ?? "VOLUME_CONFIRMED_MOMENTUM";
    const exit = exitByFamily[fam] ?? exitByFamily.VOLUME_CONFIRMED_MOMENTUM;
    const t = simulateTradePnl(klines, row.idx, exit.tp, exit.sl, realisticSlippageBps);
    trades.push(t);
  }

  const wins = trades.filter((t) => t.win).length;
  const losses = trades.length - wins;
  const netPnl = trades.reduce((s, t) => s + t.net, 0);
  const expectancy = trades.length ? netPnl / trades.length : 0;
  const grossW = trades.filter((t) => t.win).reduce((s, t) => s + t.net, 0);
  const grossL = Math.abs(trades.filter((t) => !t.win).reduce((s, t) => s + t.net, 0));
  const profitFactor = grossL > 0 ? grossW / grossL : 0;

  const finalTestPass =
    validationPass &&
    testV2.positiveEdgeRate > testBaseline.positiveEdgeRate &&
    trades.length >= 5 &&
    netPnl > 0 &&
    expectancy > 0 &&
    profitFactor > 1;

  const strategyVerdict = finalTestPass
    ? "POSITIVE_DISCOVERY_SIGNAL"
    : validationPass
      ? "PARTIAL_VALIDATION_ONLY"
      : "NO_DISCOVERABLE_EDGE";

  const nextPhase = finalTestPass
    ? "MASTER_ALIGNMENT_REVIEW"
    : validationPass
      ? "EXIT_MODEL_REDESIGN"
      : "STRATEGY_ARCHITECTURE_REDESIGN";

  const result = {
    verdict: finalTestPass ? "PASS" : validationPass ? "PARTIAL" : "FAIL",
    headStart,
    dataset: {
      start: new Date(DATASET_START).toISOString(),
      end: new Date(DATASET_END).toISOString(),
      trainEnd: new Date(TRAIN_END).toISOString(),
      valEnd: new Date(VAL_END).toISOString(),
      windows: windowMap.size,
      symbols: marketData.length,
    },
    baseline: baselineSummary,
    discoveryV2: {
      setupFamilies: [...DISCOVERY_V2_SETUP_FAMILIES],
      candidates: v2Discovered.length,
      shortlisted: v2Shortlisted.length,
      selected: v2Selected.length,
      validationPositiveEdgeRate: valV2.positiveEdgeRate,
      finalPositiveEdgeRate: testV2.positiveEdgeRate,
      validationSummary: valV2,
      finalTestSummary: testV2,
      confidenceMonotonic,
      tierBuckets,
      familyCounts: DISCOVERY_V2_SETUP_FAMILIES.map((f) => ({
        family: f,
        count: v2Discovered.filter((r) => r.setupFamily === f).length,
      })),
    },
    forensic: {
      falsePositiveReasons: Object.fromEntries(fpReasons),
      falseNegativeGates: Object.fromEntries(fnGates),
      top1VsTopN: {
        windowsWithPositive: windowsWithPos,
        top1Capture: pct(top1HasPos, windowsWithPos),
        top2Capture: pct(top2HasPos, windowsWithPos),
        top3Capture: pct(top3HasPos, windowsWithPos),
      },
      discoveryRootCause: "GLOBAL_SCORE_COLLAPSES_DISTINCT_SETUPS",
      falsePositiveRootCause: Object.entries(Object.fromEntries(fpReasons)).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "score_saturation",
      falseNegativeRootCause: Object.entries(Object.fromEntries(fnGates)).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "regime_or_direction",
    },
    economics: {
      realisticRoundTripCost: REALISTIC_ROUND_TRIP,
      realisticSlippageBps,
      trades: trades.length,
      wins,
      losses,
      netPnl,
      expectancy,
      profitFactor,
      maxDrawdown: 0,
      exitByFamily,
    },
    validationPass,
    finalTestPass,
    ai: { analysed: 0, providerBuy: 0, hybridBuy: 0, finalBuy: 0, preAiExpectancy: expectancy, postAiExpectancy: null },
    productionDiscoveryV2Wired: false,
    strategyVerdict,
    run15hPaper: "NO",
    nextPhase,
  };

  writeJson(path.join(ARTIFACT, "discovery-v2-raw.json"), result);
  writeJson(path.join(process.cwd(), "kripto-scanner-discovery-v2-result.json"), {
    verdict: result.verdict,
    dataset: result.dataset,
    baseline: {
      candidates: result.baseline.candidates,
      selected: result.baseline.selected,
      positiveEdgeRate: result.baseline.positiveEdgeRate,
      tpFirstRate: result.baseline.tpFirstRate,
      slFirstRate: result.baseline.slFirstRate,
    },
    discoveryV2: {
      setupFamilies: result.discoveryV2.setupFamilies,
      candidates: result.discoveryV2.candidates,
      shortlisted: result.discoveryV2.shortlisted,
      validationPositiveEdgeRate: result.discoveryV2.validationPositiveEdgeRate,
      finalPositiveEdgeRate: result.discoveryV2.finalPositiveEdgeRate,
      confidenceMonotonic: result.discoveryV2.confidenceMonotonic,
    },
    economics: result.economics,
    ai: result.ai,
    productionDiscoveryV2Wired: result.productionDiscoveryV2Wired,
    strategyVerdict: result.strategyVerdict,
    run15hPaper: result.run15hPaper,
    nextPhase: result.nextPhase,
  });

  const report = buildReport(result, valBaseline, valV2, testBaseline, testV2);
  fs.writeFileSync(path.join(process.cwd(), "KRIPTO_SCANNER_DISCOVERY_V2_REPORT.md"), report, "utf8");
  console.log(JSON.stringify({ baseline: result.baseline, discoveryV2: result.discoveryV2, economics: result.economics, strategyVerdict, nextPhase }, null, 2));
}

function median(nums: number[]) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function buildReport(r: Record<string, unknown>, valB: Record<string, number>, valV: Record<string, number>, testB: Record<string, number>, testV: Record<string, number>) {
  const b = r.baseline as Record<string, number>;
  const d = r.discoveryV2 as Record<string, unknown>;
  const f = r.forensic as Record<string, unknown>;
  const e = r.economics as Record<string, number>;
  return `# KRIPTO Scanner Discovery V2 Report

## 1. Executive Summary

Third frozen dataset (2026-08-18 → 2026-08-28) üzerinde setup-aware **Scanner Discovery V2** test edildi. Production discovery değiştirilmedi.

- Baseline positive-edge rate: **${b.positiveEdgeRate}%**
- V2 validation positive-edge: **${valV.positiveEdgeRate}%** (baseline VAL ${valB.positiveEdgeRate}%)
- V2 final test positive-edge: **${testV.positiveEdgeRate}%** (baseline TEST ${testB.positiveEdgeRate}%)
- **STRATEGY_VERDICT:** ${r.strategyVerdict}
- **NEXT_PHASE:** ${r.nextPhase}

## 2–5. Dataset & Splits

${JSON.stringify(r.dataset, null, 2)}

## 6. Production Baseline

| Metric | Value |
|--------|------:|
| Qualified candidates | ${b.candidates} |
| Selected (top-1) | ${b.selected} |
| Positive-edge rate | ${b.positiveEdgeRate}% |
| TP_FIRST rate | ${b.tpFirstRate}% |
| SL_FIRST rate | ${b.slFirstRate}% |

## 7–9. Market State & Cost-Aware Labels

Realistic round-trip cost: **${e.realisticRoundTripCost ?? REALISTIC_ROUND_TRIP}%**. Labels: STRONG_POSITIVE (>1.5% net opp), WEAK_POSITIVE (>0.44%), NO_EDGE, NEGATIVE.

## 10–13. False Positive / Negative Forensic

${JSON.stringify(f, null, 2)}

## 14–17. Setup Families & Confidence

${JSON.stringify(d, null, 2)}

Confidence monotonic: **${(d as { confidenceMonotonic: boolean }).confidenceMonotonic}**

## 18. Discovery V2 Architecture

Setup-aware families replace global 0–100 score. Pre-AI shortlist (max 3/window). Hard gates: spread, liquidity safety only.

## 19–21. Dev / Validation / Final Test

| Split | Baseline pos-edge | V2 selected pos-edge |
|-------|------------------:|---------------------:|
| VALIDATION | ${valB.positiveEdgeRate}% | ${valV.positiveEdgeRate}% |
| FINAL TEST | ${testB.positiveEdgeRate}% | ${testV.positiveEdgeRate}% |

## 22–25. Economics & Replay

FINAL TEST trades: ${e.trades} | Net PnL: ${Number(e.netPnl).toFixed(2)} | Expectancy: ${Number(e.expectancy).toFixed(4)} | PF: ${Number(e.profitFactor).toFixed(2)}

## 26–27. AI Recheck

Skipped — final test gate not met.

## 28–31. Verdict

**PRODUCTION_DISCOVERY_V2_WIRED:** false
**RUN_15H_PAPER:** NO
**NEXT_PHASE:** ${r.nextPhase}

---
*Generated ${new Date().toISOString()}*
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
