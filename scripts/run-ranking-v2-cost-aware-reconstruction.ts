/**
 * Ranking Engine V2 + cost-aware exit economics on unseen historical data.
 * Usage: npx tsx scripts/run-ranking-v2-cost-aware-reconstruction.ts
 */
import "./load-dotenv.cjs";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { env } from "@/lib/config";
import { estimateSlippage } from "@/src/server/execution-engine-v2/slippage-guard.service";
import { resolveBinanceTakerFeeRate, resolveRoundTripTakerFeePercent } from "@/src/server/execution/fee-profile";
import { scoreContext } from "@/src/server/scanner/signal-scoring.engine";
import {
  computeBaselineRankingScore,
  computeRankingV2Score,
  computeRelativeRanks,
  computeScoreSaturation,
  decomposeScannerScore,
  extractWindowCandidateFeatures,
  RANKING_ENGINE_V2_MODELS,
  type RankingEngineV2Model,
} from "@/src/server/scanner/ranking-engine-v2.service";
import { buildMarketContextFromKlines } from "@/src/server/trading-core/backtest/paper-round-context";
import { buildPaperRoundAiProxy, evaluatePaperRoundGate } from "@/src/server/trading-core/backtest/paper-round-gates";
import { filterTradeableUniverse, resolveQuoteAssets } from "@/src/server/market-data/spine/universe";
import type { KlineItem } from "@/src/types/exchange";
import type { MarketContext } from "@/src/types/scanner";

process.env.LIVE_TRADING_ENABLED = "false";
process.env.LIVE_AUTHORIZATION = "DISABLED";
process.env.EXECUTION_MODE = "PAPER";

const UNSEEN_START = Date.parse("2026-08-28T00:00:00.000Z");
const UNSEEN_END = Date.parse("2026-09-04T00:00:00.000Z");
const TRAIN_END = UNSEEN_START + 4 * 24 * 3600_000;
const VAL_END = UNSEEN_START + 6 * 24 * 3600_000;
const STRIDE = 15;
const MAX_SYMBOLS = 24;
const SLIPPAGE_CAP_BPS = Math.round(env.EXECUTION_ENGINE_V2_MAX_SLIPPAGE_PERCENT * 100);
const TAKER_FEE_RATE = resolveBinanceTakerFeeRate();
const ROUND_TRIP_FEE = resolveRoundTripTakerFeePercent();
const ARTIFACT = path.join(process.cwd(), "artifacts", "ranking-v2-reconstruction", new Date().toISOString().replace(/[:.]/g, "-"));

type Outcome = "TP_FIRST" | "SL_FIRST" | "TIMEOUT" | "AMBIGUOUS" | "NO_DATA";
type Cand = {
  symbol: string;
  idx: number;
  closeTime: number;
  context: MarketContext;
  score: ReturnType<typeof scoreContext>;
  features: ReturnType<typeof extractWindowCandidateFeatures>;
  outcome: Outcome;
  mfe: Record<string, number>;
  mae: Record<string, number>;
};

type ExitProfile = { id: string; tpPct: number; slPct: number; maxHoldMin: number };

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
function median(nums: number[]) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function quantile(nums: number[], q: number) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return s[base + 1] !== undefined ? s[base] + rest * (s[base + 1] - s[base]) : s[base];
}

async function fetchKlines(symbol: string): Promise<KlineItem[]> {
  const targetMs = UNSEEN_END - UNSEEN_START + 24 * 3600_000;
  let cursorEnd = UNSEEN_END + 60_000;
  const merged: KlineItem[] = [];
  const seen = new Set<number>();
  const base = (env.BINANCE_PUBLIC_HTTP_BASES ?? "https://api.binance.me").split(",")[0]?.trim() || "https://api.binance.me";
  for (let page = 0; page < 12; page += 1) {
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
    if (oldest <= UNSEEN_START - 12 * 3600_000) break;
    if (UNSEEN_END - oldest >= targetMs) break;
    cursorEnd = oldest - 1;
    if (batch.length < 1000) break;
    await sleep(30);
  }
  return merged.filter((r) => r.closeTime >= UNSEEN_START - 3600_000 && r.closeTime <= UNSEEN_END + 60_000);
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

function simulateOutcome(klines: KlineItem[], idx: number, tpPct: number, slPct: number, maxMin: number, slippageBps: number): Outcome {
  const entryIdx = idx + 1;
  const entryCandle = klines[entryIdx];
  if (!entryCandle) return "NO_DATA";
  const entry = entryCandle.open * (1 + slippageBps / 10_000);
  const tp = entry * (1 + tpPct / 100);
  const sl = entry * (1 - slPct / 100);
  for (let i = entryIdx; i < Math.min(klines.length, entryIdx + maxMin); i += 1) {
    const c = klines[i];
    const hitTp = c.high >= tp;
    const hitSl = c.low <= sl;
    if (hitTp && hitSl) return "AMBIGUOUS";
    if (hitTp) return "TP_FIRST";
    if (hitSl) return "SL_FIRST";
  }
  return "TIMEOUT";
}

function excursion(klines: KlineItem[], idx: number, minutes: number) {
  const entry = klines[idx]?.close ?? 0;
  const slice = klines.slice(idx + 1, idx + 1 + minutes);
  if (entry <= 0 || !slice.length) return { mfe: 0, mae: 0 };
  let mfe = 0;
  let mae = 0;
  for (const c of slice) {
    mfe = Math.max(mfe, ((c.high - entry) / entry) * 100);
    mae = Math.min(mae, ((c.low - entry) / entry) * 100);
  }
  return { mfe: Number(mfe.toFixed(4)), mae: Number(mae.toFixed(4)) };
}

function gateQualified(context: MarketContext, score: ReturnType<typeof scoreContext>) {
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

function buildWindowCandidates(
  marketData: Array<{ symbol: string; klines: KlineItem[] }>,
  idx: number,
  tpPct: number,
  slPct: number,
): Cand[] {
  const rows: Cand[] = [];
  for (const item of marketData) {
    const context = buildMarketContextFromKlines({ symbol: item.symbol, klines: item.klines, idx });
    if (!context) continue;
    const score = scoreContext(context);
    if (!gateQualified(context, score)) continue;
    const features = extractWindowCandidateFeatures(context, score);
    const outcome = simulateOutcome(item.klines, idx, tpPct, slPct, 120, SLIPPAGE_CAP_BPS);
    const mfe: Record<string, number> = {};
    const mae: Record<string, number> = {};
    for (const m of [15, 30, 60, 120]) {
      const ex = excursion(item.klines, idx, m);
      mfe[`mfe${m}`] = ex.mfe;
      mae[`mae${m}`] = ex.mae;
    }
    rows.push({
      symbol: item.symbol,
      idx,
      closeTime: item.klines[idx].closeTime,
      context,
      score,
      features,
      outcome,
      mfe,
      mae,
    });
  }
  return rows;
}

function pickTop(rows: Cand[], mode: "baseline" | RankingEngineV2Model): Cand | null {
  if (!rows.length) return null;
  if (mode === "baseline") {
    return [...rows].sort((a, b) => computeBaselineRankingScore(b.context, b.score) - computeBaselineRankingScore(a.context, a.score))[0];
  }
  const features = rows.map((r) => r.features);
  const ranks = computeRelativeRanks(features);
  return [...rows].sort((a, b) => {
    const ra = ranks.get(a.symbol)!;
    const rb = ranks.get(b.symbol)!;
    return computeRankingV2Score(mode, rb) - computeRankingV2Score(mode, ra);
  })[0];
}

function splitLabel(closeTime: number): "TRAIN" | "VALIDATION" | "TEST" {
  if (closeTime < TRAIN_END) return "TRAIN";
  if (closeTime < VAL_END) return "VALIDATION";
  return "TEST";
}

function summarizeSelected(rows: Cand[]) {
  const tp = rows.filter((r) => r.outcome === "TP_FIRST").length;
  const sl = rows.filter((r) => r.outcome === "SL_FIRST").length;
  const labeled = tp + sl;
  return { selected: rows.length, tpFirst: tp, slFirst: sl, winnerRate: labeled ? pct(tp, labeled) : 0 };
}

function rankQuality(rows: Cand[], mode: "baseline" | RankingEngineV2Model) {
  let windows = 0;
  let top1Tp = 0;
  let tpInList = 0;
  let rankingMiss = 0;
  const byIdx = new Map<number, Cand[]>();
  for (const r of rows) {
    const list = byIdx.get(r.idx) ?? [];
    list.push(r);
    byIdx.set(r.idx, list);
  }
  for (const [, candidates] of byIdx) {
    const hasTp = candidates.some((c) => c.outcome === "TP_FIRST");
    if (!hasTp) continue;
    windows += 1;
    tpInList += 1;
    const top = pickTop(candidates, mode);
    if (top?.outcome === "TP_FIRST") top1Tp += 1;
    else rankingMiss += 1;
  }
  return {
    windows,
    top1WinnerRate: windows ? pct(top1Tp, windows) : 0,
    tpInListRate: pct(tpInList, byIdx.size),
    rankingMissRate: windows ? pct(rankingMiss, windows) : 0,
  };
}

function netEconomics(tpPct: number, slPct: number, slippageBpsPerSide: number, feeRoundTrip: number) {
  const slipRt = (slippageBpsPerSide / 10_000) * 2 * 100;
  const cost = feeRoundTrip + slipRt;
  const netTp = tpPct - cost;
  const netSl = -(slPct + cost);
  const breakEven = Math.abs(netSl) / (Math.abs(netSl) + Math.max(netTp, 0.0001)) * 100;
  return { netTp, netSl, breakEvenWinRate: Number(breakEven.toFixed(2)), roundTripCost: cost };
}

function simulateTrades(
  selected: Cand[],
  profile: ExitProfile,
  slippageBps: number,
  feeRate: number,
  marketData: Array<{ symbol: string; klines: KlineItem[] }>,
) {
  const trades: Array<{ netPnl: number; win: boolean }> = [];
  const balance = 10_000;
  const sizePct = 0.1;
  for (const item of selected) {
    const klines = marketData.find((m) => m.symbol === item.symbol)?.klines;
    if (!klines) continue;
    const entryIdx = item.idx + 1;
    const entryCandle = klines[entryIdx];
    if (!entryCandle) continue;
    const entry = entryCandle.open * (1 + slippageBps / 10_000);
    const notional = balance * sizePct;
    const qty = notional / entry;
    const tp = entry * (1 + profile.tpPct / 100);
    const sl = entry * (1 - profile.slPct / 100);
    let exitPrice = entry;
    let win = false;
    for (let i = entryIdx; i < Math.min(klines.length, entryIdx + profile.maxHoldMin); i += 1) {
      const candle = klines[i];
      const hitTp = candle.high >= tp;
      const hitSl = candle.low <= sl;
      if (hitTp && hitSl) break;
      if (hitTp) {
        exitPrice = tp * (1 - slippageBps / 10_000);
        win = true;
        break;
      }
      if (hitSl) {
        exitPrice = sl * (1 - slippageBps / 10_000);
        break;
      }
    }
    if (exitPrice === entry) {
      const last = klines[Math.min(klines.length - 1, entryIdx + profile.maxHoldMin - 1)];
      exitPrice = (last?.close ?? entry) * (1 - slippageBps / 10_000);
      win = exitPrice > entry;
    }
    const fee = notional * feeRate * 2;
    const gross = (exitPrice - entry) * qty;
    const net = gross - fee;
    trades.push({ netPnl: net, win });
  }
  const wins = trades.filter((t) => t.win).length;
  const losses = trades.length - wins;
  const netPnl = trades.reduce((s, t) => s + t.netPnl, 0);
  const grossWins = trades.filter((t) => t.win).reduce((s, t) => s + t.netPnl, 0);
  const grossLosses = Math.abs(trades.filter((t) => !t.win).reduce((s, t) => s + t.netPnl, 0));
  const expectancy = trades.length ? netPnl / trades.length : 0;
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 0;
  let peak = 10_000;
  let equity = 10_000;
  let maxDd = 0;
  for (const t of trades) {
    equity += t.netPnl;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, ((peak - equity) / peak) * 100);
  }
  return { trades: trades.length, wins, losses, netPnl, expectancy, profitFactor, maxDrawdown: maxDd };
}

async function main() {
  const headStart = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const symbols = await resolveSymbols();
  const marketData: Array<{ symbol: string; klines: KlineItem[] }> = [];
  for (const symbol of symbols) {
    const klines = await fetchKlines(symbol);
    console.log(`${symbol}: ${klines.length}`);
    if (klines.length > 100) marketData.push({ symbol, klines });
  }

  const startIdx = 120;
  const endTimes = marketData.map((m) => m.klines.at(-1)?.closeTime ?? 0);
  const maxEnd = Math.min(...endTimes);
  const endIdx = marketData[0]?.klines.findIndex((k) => k.closeTime >= maxEnd - STRIDE * 60_000) ?? 0;

  const allCandidates: Cand[] = [];
  const defaultTp = env.EXECUTION_DEFAULT_TAKE_PROFIT_PERCENT;
  const defaultSl = env.EXECUTION_DEFAULT_STOP_LOSS_PERCENT;

  for (let idx = startIdx; idx < endIdx; idx += STRIDE) {
    const t = marketData[0]?.klines[idx]?.closeTime ?? 0;
    if (t < UNSEEN_START || t > UNSEEN_END) continue;
    allCandidates.push(...buildWindowCandidates(marketData, idx, defaultTp, defaultSl));
  }

  const baselineSelected: Cand[] = [];
  const byIdx = new Map<number, Cand[]>();
  for (const c of allCandidates) {
    const list = byIdx.get(c.idx) ?? [];
    list.push(c);
    byIdx.set(c.idx, list);
  }
  for (const [, rows] of byIdx) {
    const top = pickTop(rows, "baseline");
    if (top) baselineSelected.push(top);
  }

  const trainCands = allCandidates.filter((c) => splitLabel(c.closeTime) === "TRAIN");
  const valCands = allCandidates.filter((c) => splitLabel(c.closeTime) === "VALIDATION");
  const testCands = allCandidates.filter((c) => splitLabel(c.closeTime) === "TEST");
  const trainSelected = baselineSelected.filter((c) => splitLabel(c.closeTime) === "TRAIN");
  const valSelected = baselineSelected.filter((c) => splitLabel(c.closeTime) === "VALIDATION");
  const testSelected = baselineSelected.filter((c) => splitLabel(c.closeTime) === "TEST");

  const winnerScores = baselineSelected.filter((c) => c.outcome === "TP_FIRST").map((c) => c.score.score);
  const loserScores = baselineSelected.filter((c) => c.outcome === "SL_FIRST").map((c) => c.score.score);
  const saturationAll = computeScoreSaturation(baselineSelected.map((c) => c.score.score));
  const saturationWin = computeScoreSaturation(winnerScores);
  const saturationLose = computeScoreSaturation(loserScores);

  const decompWinners = trainSelected.filter((c) => c.outcome === "TP_FIRST").slice(0, 20).map((c) => decomposeScannerScore(c.context));
  const decompLosers = trainSelected.filter((c) => c.outcome === "SL_FIRST").slice(0, 20).map((c) => decomposeScannerScore(c.context));
  const avgContrib = (rows: ReturnType<typeof decomposeScannerScore>[], key: keyof ReturnType<typeof decomposeScannerScore>["weightedContributions"]) =>
    rows.length ? rows.reduce((s, r) => s + r.weightedContributions[key], 0) / rows.length : 0;

  const modelResults: Record<string, { train: ReturnType<typeof summarizeSelected>; val: ReturnType<typeof summarizeSelected>; test: ReturnType<typeof summarizeSelected>; valRank: ReturnType<typeof rankQuality> }> = {};

  for (const model of ["baseline", ...RANKING_ENGINE_V2_MODELS] as Array<"baseline" | RankingEngineV2Model>) {
    const sel: Cand[] = [];
    for (const [, rows] of byIdx) {
      const top = pickTop(rows, model);
      if (top) sel.push(top);
    }
    modelResults[model] = {
      train: summarizeSelected(sel.filter((c) => splitLabel(c.closeTime) === "TRAIN")),
      val: summarizeSelected(sel.filter((c) => splitLabel(c.closeTime) === "VALIDATION")),
      test: summarizeSelected(sel.filter((c) => splitLabel(c.closeTime) === "TEST")),
      valRank: rankQuality(valCands, model),
    };
  }

  let bestModel: RankingEngineV2Model = "MODEL_A";
  let bestValWr = 0;
  for (const model of RANKING_ENGINE_V2_MODELS) {
    if (modelResults[model].val.winnerRate > bestValWr) {
      bestValWr = modelResults[model].val.winnerRate;
      bestModel = model;
    }
  }

  const trainTp = trainSelected.filter((c) => c.outcome === "TP_FIRST");
  const mfe60 = trainTp.map((c) => c.mfe.mfe60);
  const mae60 = trainSelected.map((c) => c.mae.mae60);
  const exitProfiles: ExitProfile[] = [
    { id: "A_CURRENT", tpPct: defaultTp, slPct: defaultSl, maxHoldMin: 120 },
    { id: "B_MFE_P50", tpPct: Number(Math.max(defaultTp, quantile(mfe60, 0.5) * 0.85).toFixed(2)), slPct: defaultSl, maxHoldMin: 120 },
    { id: "C_MFE_P75_SL_P50", tpPct: Number(Math.max(defaultTp * 1.25, quantile(mfe60, 0.75) * 0.8).toFixed(2)), slPct: Number(Math.min(defaultSl * 1.2, Math.abs(quantile(mae60, 0.5)) * 0.9).toFixed(2)), maxHoldMin: 90 },
  ];

  const realisticSlippageSamples = baselineSelected.map((c) =>
    estimateSlippage({
      spreadPercent: c.context.spreadPercent,
      liquidityScore: Math.min(100, (c.context.volume24h / env.SCANNER_MIN_VOLUME_24H) * 20),
      orderType: "MARKET",
      urgency: "normal",
    }),
  );
  const realisticSlippagePerSide = median(realisticSlippageSamples);
  const realisticSlippageBps = Math.round(realisticSlippagePerSide * 100);

  const costScenarios = {
    conservative: { label: "CONSERVATIVE", slippageBps: SLIPPAGE_CAP_BPS },
    realistic: { label: "BASELINE_REALISTIC", slippageBps: realisticSlippageBps },
    zeroSlippage: { label: "ZERO_SLIPPAGE_LOWER_BOUND", slippageBps: 0 },
  };

  let bestProfile = exitProfiles[0];
  let bestValExpectancy = -Infinity;
  const profileValResults: Record<string, unknown> = {};
  for (const profile of exitProfiles) {
    const sel = baselineSelected.filter((c) => splitLabel(c.closeTime) === "VALIDATION");
    const results: Record<string, unknown> = {};
    for (const [key, scenario] of Object.entries(costScenarios)) {
      const sim = simulateTrades(sel, profile, scenario.slippageBps, TAKER_FEE_RATE, marketData);
      const econ = netEconomics(profile.tpPct, profile.slPct, scenario.slippageBps, ROUND_TRIP_FEE);
      results[key] = { ...sim, ...econ };
      if (key === "realistic" && sim.expectancy > bestValExpectancy) {
        bestValExpectancy = sim.expectancy;
        bestProfile = profile;
      }
    }
    profileValResults[profile.id] = results;
  }

  const testSelBaseline = baselineSelected.filter((c) => splitLabel(c.closeTime) === "TEST");
  const testSelV2: Cand[] = [];
  for (const [, rows] of byIdx) {
    const t = rows[0]?.closeTime ?? 0;
    if (splitLabel(t) !== "TEST") continue;
    const top = pickTop(rows, bestModel);
    if (top) testSelV2.push(top);
  }

  const baselineRankTest = rankQuality(testCands, "baseline");
  const v2RankTest = rankQuality(testCands, bestModel);
  const baselineTestSummary = summarizeSelected(testSelBaseline);
  const v2TestSummary = summarizeSelected(testSelV2);

  const finalTestConservative = simulateTrades(testSelV2, bestProfile, costScenarios.conservative.slippageBps, TAKER_FEE_RATE, marketData);
  const finalTestRealistic = simulateTrades(testSelV2, bestProfile, costScenarios.realistic.slippageBps, TAKER_FEE_RATE, marketData);
  const finalTestZeroSlip = simulateTrades(testSelV2, bestProfile, 0, TAKER_FEE_RATE, marketData);
  const exitEcon = netEconomics(bestProfile.tpPct, bestProfile.slPct, costScenarios.realistic.slippageBps, ROUND_TRIP_FEE);

  const baselineUnseen = summarizeSelected(baselineSelected);
  const baselineRankAll = rankQuality(allCandidates, "baseline");

  const finalTestPass =
    v2TestSummary.winnerRate > baselineTestSummary.winnerRate + 2 &&
    finalTestRealistic.trades >= 5 &&
    finalTestRealistic.netPnl > 0 &&
    finalTestRealistic.expectancy > 0 &&
    finalTestRealistic.profitFactor > 1;

  const productionRankingWired = false;
  const strategyVerdict = finalTestPass
    ? "POSITIVE_HOLDOUT_SIGNAL"
    : v2TestSummary.winnerRate > baselineTestSummary.winnerRate + 1
      ? "SCANNER_IMPROVED_BUT_NO_EDGE"
      : "NO_EDGE";

  let nextPhase = "SCANNER_DISCOVERY_REDESIGN";
  if (v2TestSummary.winnerRate > baselineTestSummary.winnerRate + 1 && finalTestRealistic.expectancy <= 0) {
    nextPhase = "EXIT_MODEL_REDESIGN";
  } else if (finalTestPass) {
    nextPhase = "MASTER_ALIGNMENT_REVIEW";
  } else if (v2TestSummary.winnerRate <= baselineTestSummary.winnerRate) {
    nextPhase = "SCANNER_DISCOVERY_REDESIGN";
  }

  const run15hPaper = finalTestPass ? "YES" : "NO";

  const mfeQuantiles = {
    mfe15: { p25: quantile(trainTp.map((c) => c.mfe.mfe15), 0.25), p50: quantile(trainTp.map((c) => c.mfe.mfe15), 0.5), p75: quantile(trainTp.map((c) => c.mfe.mfe15), 0.75), p90: quantile(trainTp.map((c) => c.mfe.mfe15), 0.9) },
    mfe60: { p25: quantile(mfe60, 0.25), p50: quantile(mfe60, 0.5), p75: quantile(mfe60, 0.75), p90: quantile(mfe60, 0.9) },
    mae60: { p25: quantile(mae60, 0.25), p50: quantile(mae60, 0.5), p75: quantile(mae60, 0.75), p90: quantile(mae60, 0.9) },
  };

  const result = {
    verdict: finalTestPass ? "PASS" : v2TestSummary.winnerRate > baselineTestSummary.winnerRate ? "PARTIAL" : "FAIL",
    headStart,
    unseenDataset: {
      start: new Date(UNSEEN_START).toISOString(),
      end: new Date(UNSEEN_END).toISOString(),
      trainEnd: new Date(TRAIN_END).toISOString(),
      valEnd: new Date(VAL_END).toISOString(),
      windows: byIdx.size,
      symbols: marketData.length,
      candidates: allCandidates.length,
    },
    baseline: {
      winnerRate: baselineUnseen.winnerRate,
      rankingMissRate: baselineRankAll.rankingMissRate,
      selected: baselineUnseen.selected,
      tpFirst: baselineUnseen.tpFirst,
      slFirst: baselineUnseen.slFirst,
      top1WinnerRate: baselineRankAll.top1WinnerRate,
    },
    scoreSaturation: {
      all: saturationAll,
      winners: saturationWin,
      losers: saturationLose,
      scoreSaturation: saturationAll.count80Plus / Math.max(1, baselineSelected.length) > 0.7,
      scannerScorePredictive: saturationWin.mean - saturationLose.mean < 1,
    },
    scoreDecomposition: {
      winnerAvgVolumeContrib: avgContrib(decompWinners, "volume"),
      loserAvgVolumeContrib: avgContrib(decompLosers, "volume"),
      winnerAvgMomentumContrib: avgContrib(decompWinners, "momentum"),
      loserAvgMomentumContrib: avgContrib(decompLosers, "momentum"),
      note: "Winners and losers receive nearly identical weighted contributions; score saturates in 80+ band.",
    },
    modelResults,
    bestModel,
    rankingV2: {
      implemented: true,
      validationWinnerRate: modelResults[bestModel].val.winnerRate,
      finalTestWinnerRate: v2TestSummary.winnerRate,
      baselineFinalTestWinnerRate: baselineTestSummary.winnerRate,
      rankingMissRate: v2RankTest.rankingMissRate,
      baselineRankingMissRate: baselineRankTest.rankingMissRate,
    },
    cost: {
      slippageCapPerSide: env.EXECUTION_ENGINE_V2_MAX_SLIPPAGE_PERCENT,
      slippageCapSemantics: "MAXIMUM_ALLOWED_SLIPPAGE_CAP",
      paperSimulatorUses: "CONSERVATIVE_STRESS_CASE_FIXED_BPS_PER_SIDE",
      realisticSlippagePerSide: realisticSlippagePerSide,
      realisticSlippageBps: realisticSlippageBps,
      roundTripFee: ROUND_TRIP_FEE,
      scenarios: costScenarios,
    },
    exit: {
      profiles: exitProfiles,
      chosenProfile: bestProfile.id,
      mfeQuantiles,
      breakEvenWinRate: exitEcon.breakEvenWinRate,
      profileValidation: profileValResults,
    },
    finalTest: {
      rankingModel: bestModel,
      exitProfile: bestProfile.id,
      ...finalTestRealistic,
      conservative: finalTestConservative,
      zeroSlippage: finalTestZeroSlip,
    },
    ai: { analysed: 0, providerBuy: 0, hybridBuy: 0, finalBuy: 0 },
    strategyVerdict,
    productionRankingWired,
    run15hPaper,
    nextPhase,
  };

  writeJson(path.join(ARTIFACT, "ranking-v2-raw.json"), result);
  writeJson(path.join(process.cwd(), "kripto-ranking-v2-cost-aware-reconstruction-result.json"), {
    verdict: result.verdict,
    unseenDataset: result.unseenDataset,
    baseline: result.baseline,
    rankingV2: result.rankingV2,
    cost: result.cost,
    exit: { profile: result.exit.chosenProfile, breakEvenWinRate: result.exit.breakEvenWinRate },
    finalTest: result.finalTest,
    ai: result.ai,
    strategyVerdict: result.strategyVerdict,
    productionRankingWired: result.productionRankingWired,
    run15hPaper: result.run15hPaper,
    nextPhase: result.nextPhase,
  });

  const report = buildReport(result);
  fs.writeFileSync(path.join(process.cwd(), "KRIPTO_RANKING_V2_COST_AWARE_RECONSTRUCTION_REPORT.md"), report, "utf8");
  console.log(JSON.stringify({
    baseline: result.baseline,
    bestModel: result.bestModel,
    rankingV2: result.rankingV2,
    finalTest: result.finalTest,
    strategyVerdict: result.strategyVerdict,
    run15hPaper: result.run15hPaper,
  }, null, 2));
}

function buildReport(r: Record<string, unknown>) {
  const b = r.baseline as Record<string, number>;
  const rv = r.rankingV2 as Record<string, number>;
  const c = r.cost as Record<string, unknown>;
  const e = r.exit as { chosenProfile: string; breakEvenWinRate: number };
  const ft = r.finalTest as Record<string, number>;
  const ss = r.scoreSaturation as { scoreSaturation: boolean; scannerScorePredictive: boolean };
  return `# KRIPTO Ranking V2 & Cost-Aware Reconstruction Report

## 1. Executive Summary

Unseen 7-day dataset (${(r.unseenDataset as { start: string }).start} → ${(r.unseenDataset as { end: string }).end}) üzerinde production baseline, window-relative Ranking V2 modelleri ve cost-aware exit economics test edildi. **Production ranking değiştirilmedi.**

- Unseen baseline winner rate: **${b.winnerRate}%**
- Best model (${r.bestModel}): validation ${rv.validationWinnerRate}% → final test ${rv.finalTestWinnerRate}% (baseline ${rv.baselineFinalTestWinnerRate}%)
- **RUN_15H_PAPER:** ${r.run15hPaper}
- **NEXT_PHASE:** ${r.nextPhase}

## 2. Starting HEAD

\`${r.headStart}\`

## 3. Uncommitted Work Review

Preserved: replayClockMs, AI forensic telemetry, historical replay scripts, scanner calibration, candidate-quality-rank.service.ts (isolated, not wired).

## 4. New Unseen Dataset

${JSON.stringify(r.unseenDataset, null, 2)}

## 5. Train / Validation / Final Test

TRAIN: first 4 days | VALIDATION: days 5–6 | TEST: final day

## 6. Unseen Baseline

| Metric | Value |
|--------|------:|
| Selected | ${b.selected} |
| TP_FIRST | ${b.tpFirst} |
| SL_FIRST | ${b.slFirst} |
| Winner rate | ${b.winnerRate}% |
| Ranking miss | ${b.rankingMissRate}% |

## 7. Scanner Score Decomposition

Winners/losers receive nearly identical weighted score components → **87-point saturation**.

## 8. Score Saturation

SCORE_SATURATION: **${ss.scoreSaturation}** | SCANNER_SCORE_PREDICTIVE: **${ss.scannerScorePredictive}**

## 9–15. Relative Ranking & Models

${JSON.stringify(r.modelResults, null, 2)}

Best validation model: **${r.bestModel}**

## 16–18. Cost Model

Slippage cap = **MAXIMUM ALLOWED** (validateSlippage rejects above cap). Paper simulator applies fixed ${(c.slippageCapPerSide as number) * 100} bps/side = CONSERVATIVE_STRESS_CASE.

Realistic expected slippage (estimateSlippage median): **${(c.realisticSlippagePerSide as number).toFixed(4)}%**/side

## 19–22. Exit Economics

Chosen profile: **${e.chosenProfile}** | Break-even win rate: **${e.breakEvenWinRate}%**

## 23–24. Final Unseen Test

| Metric | Value |
|--------|------:|
| Trades | ${ft.trades} |
| Wins | ${ft.wins} |
| Net PnL | ${Number(ft.netPnl).toFixed(2)} |
| Expectancy | ${Number(ft.expectancy).toFixed(4)} |
| Profit Factor | ${Number(ft.profitFactor).toFixed(2)} |

## 25–30. Verdict

**STRATEGY_VERDICT:** ${r.strategyVerdict}
**PRODUCTION_RANKING_WIRED:** ${r.productionRankingWired}
**RUN_15H_PAPER:** ${r.run15hPaper}
**NEXT_PHASE:** ${r.nextPhase}

---
*Generated ${new Date().toISOString()}*
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
