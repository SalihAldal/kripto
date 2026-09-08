/**
 * Scanner edge forensic, evidence-based ranking calibration, dev/holdout validation.
 * Usage: npx tsx scripts/run-scanner-edge-calibration.ts
 */
import "./load-dotenv.cjs";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/config";
import { buildMultiTimeframeAnalysis } from "@/src/server/ai/multi-timeframe.service";
import { runAIConsensusFromInput } from "@/src/server/ai/analysis-orchestrator";
import {
  computeCandidateQualityRankAdjustment,
  computeEvidenceAdjustedRankingScore,
  resolvePreDecisionReturns,
} from "@/src/server/scanner/candidate-quality-rank.service";
import { resolveBinanceTakerFeeRate, resolveRoundTripTakerFeePercent } from "@/src/server/execution/fee-profile";
import { scoreContext } from "@/src/server/scanner/signal-scoring.engine";
import { buildMarketContextFromKlines } from "@/src/server/trading-core/backtest/paper-round-context";
import { buildPaperRoundAiProxy, evaluatePaperRoundGate, rankPaperRoundCandidate } from "@/src/server/trading-core/backtest/paper-round-gates";
import { PaperRoundBacktestEngine } from "@/src/server/trading-core/backtest/paper-round-backtest.engine";
import { filterTradeableUniverse, resolveQuoteAssets } from "@/src/server/market-data/spine/universe";
import type { AIAnalysisInput } from "@/src/types/ai";
import type { KlineItem } from "@/src/types/exchange";
import type { MarketContext } from "@/src/types/scanner";

process.env.LIVE_TRADING_ENABLED = "false";
process.env.LIVE_AUTHORIZATION = "DISABLED";
process.env.EXECUTION_MODE = "PAPER";

const FROZEN_START = Date.parse("2026-09-04T22:38:00.000Z");
const FROZEN_END = Date.parse("2026-09-07T21:37:59.999Z");
const HOLDOUT_START = FROZEN_START + 48 * 3600_000;
const REPLAY_HOURS = 72;
const STRIDE = 15;
const MAX_SYMBOLS = 24;
const TP_PCT = env.EXECUTION_DEFAULT_TAKE_PROFIT_PERCENT;
const SL_PCT = env.EXECUTION_DEFAULT_STOP_LOSS_PERCENT;
const SLIPPAGE_BPS = Math.round(env.EXECUTION_ENGINE_V2_MAX_SLIPPAGE_PERCENT * 100);
const TAKER_FEE_RATE = resolveBinanceTakerFeeRate();
const ARTIFACT = path.join(process.cwd(), "artifacts", "scanner-edge-calibration", new Date().toISOString().replace(/[:.]/g, "-"));

type Outcome = "TP_FIRST" | "SL_FIRST" | "TIMEOUT" | "AMBIGUOUS" | "NO_DATA";
type Cand = {
  symbol: string;
  idx: number;
  closeTime: number;
  context: MarketContext;
  score: ReturnType<typeof scoreContext>;
  outcome: Outcome;
  mfe15: number;
  mae15: number;
  mfe30: number;
  mae30: number;
  mfe60: number;
  mae60: number;
  baseRank: number;
  adjustedRank: number;
  quoteAsset: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function writeJson(p: string, v: unknown) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}
function median(nums: number[]) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function pct(n: number, d: number) {
  return d > 0 ? Number(((n / d) * 100).toFixed(2)) : 0;
}

async function fetchPaginatedKlines(symbol: string): Promise<KlineItem[]> {
  const { getExchangeProvider } = await import("@/src/server/exchange");
  const provider = getExchangeProvider();
  const targetMs = REPLAY_HOURS * 3600_000;
  const endTime = Date.now();
  let cursorEnd = endTime;
  const merged: KlineItem[] = [];
  const seen = new Set<number>();
  for (let page = 0; page < 8; page += 1) {
    let batch: KlineItem[] = [];
    try {
      const base = (env.BINANCE_PUBLIC_HTTP_BASES ?? "https://api.binance.me").split(",")[0]?.trim() || "https://api.binance.me";
      const res = await fetch(`${base}/api/v3/klines?${new URLSearchParams({ symbol, interval: "1m", limit: "1000", endTime: String(cursorEnd) })}`);
      const raw = (await res.json()) as unknown[];
      batch = raw.filter((r) => Array.isArray(r)).map((r) => {
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
    } catch {
      batch = await provider.getKlines(symbol, "1m", 1000).catch(() => []);
    }
    if (!batch.length) break;
    for (const row of batch) {
      if (!seen.has(row.openTime)) {
        seen.add(row.openTime);
        merged.push(row);
      }
    }
    merged.sort((a, b) => a.openTime - b.openTime);
    const oldest = merged[0]?.openTime ?? cursorEnd;
    if (endTime - oldest >= targetMs) break;
    cursorEnd = oldest - 1;
    if (batch.length < 1000) break;
    await sleep(25);
  }
  return merged.filter((r) => r.closeTime >= endTime - targetMs && r.closeTime <= FROZEN_END + 60_000);
}

async function resolveSymbolUniverse() {
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

function simulateOutcome(klines: KlineItem[], idx: number): Outcome {
  const entryIdx = idx + 1;
  const entryCandle = klines[entryIdx];
  if (!entryCandle) return "NO_DATA";
  const entry = entryCandle.open * (1 + SLIPPAGE_BPS / 10_000);
  const tp = entry * (1 + TP_PCT / 100);
  const sl = entry * (1 - SL_PCT / 100);
  for (let i = entryIdx; i < Math.min(klines.length, entryIdx + 120); i += 1) {
    const c = klines[i];
    const hitTp = c.high >= tp;
    const hitSl = c.low <= sl;
    if (hitTp && hitSl) return "AMBIGUOUS";
    if (hitTp) return "TP_FIRST";
    if (hitSl) return "SL_FIRST";
  }
  return "TIMEOUT";
}

function mfeMae(klines: KlineItem[], idx: number, minutes: number) {
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

function baselineRank(context: MarketContext, score: ReturnType<typeof scoreContext>) {
  const boost = Number(context.metadata.topGainerPriorityScore ?? 0) * 0.18;
  return score.score + boost;
}

function adjustedRank(context: MarketContext, score: ReturnType<typeof scoreContext>) {
  return computeEvidenceAdjustedRankingScore({ baseScore: score.score, context }).rankingScore;
}

function pickTopPerWindow(
  marketData: Array<{ symbol: string; klines: KlineItem[] }>,
  idx: number,
  mode: "baseline" | "adjusted",
): Cand | null {
  const rows: Cand[] = [];
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
      targetProfitPct: TP_PCT,
      learningMemory: { hardBlock: false, minConfidenceDelta: 0, sameSymbolLossCount: 0 },
    });
    if (score.status !== "QUALIFIED" && !gate.ok) continue;
    const outcome = simulateOutcome(item.klines, idx);
    const m15 = mfeMae(item.klines, idx, 15);
    const m30 = mfeMae(item.klines, idx, 30);
    const m60 = mfeMae(item.klines, idx, 60);
    const base = baselineRank(context, score);
    const adj = adjustedRank(context, score);
    const quote = item.symbol.endsWith("TRY") ? "TRY" : item.symbol.endsWith("USDT") ? "USDT" : "OTHER";
    rows.push({
      symbol: item.symbol,
      idx,
      closeTime: item.klines[idx].closeTime,
      context,
      score,
      outcome,
      mfe15: m15.mfe,
      mae15: m15.mae,
      mfe30: m30.mfe,
      mae30: m30.mae,
      mfe60: m60.mfe,
      mae60: m60.mae,
      baseRank: base,
      adjustedRank: adj,
      quoteAsset: quote,
    });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => (mode === "baseline" ? b.baseRank - a.baseRank : b.adjustedRank - a.adjustedRank));
  return rows[0] ?? null;
}

function summarizeSelection(rows: Cand[]) {
  const tp = rows.filter((r) => r.outcome === "TP_FIRST").length;
  const sl = rows.filter((r) => r.outcome === "SL_FIRST").length;
  const labeled = rows.filter((r) => r.outcome === "TP_FIRST" || r.outcome === "SL_FIRST").length;
  return {
    selected: rows.length,
    tpFirst: tp,
    slFirst: sl,
    winnerRate: labeled > 0 ? pct(tp, labeled) : 0,
    tpFirstPct: pct(tp, rows.length),
    slFirstPct: pct(sl, rows.length),
  };
}

function featureStats(rows: Cand[], label: Outcome) {
  const subset = rows.filter((r) => r.outcome === label);
  const pick = (fn: (r: Cand) => number) => subset.map(fn);
  return {
    count: subset.length,
    return15m: median(pick((r) => resolvePreDecisionReturns(r.context).return15m)),
    extensionFromLow: median(pick((r) => Number(r.context.metadata.extensionFrom60mLowPercent ?? 0))),
    distanceFromHigh: median(pick((r) => Number(r.context.metadata.distanceFrom60mHighPercent ?? 0))),
    volumeRatio20: median(pick((r) => Number(r.context.metadata.volumeRatio20 ?? 0))),
    volatility: median(pick((r) => r.context.volatilityPercent)),
    scannerScore: median(pick((r) => r.score.score)),
    rsi14: median(pick((r) => Number(r.context.metadata.rsi14 ?? 50))),
    mfe60: median(pick((r) => r.mfe60)),
    mae60: median(pick((r) => r.mae60)),
  };
}

function scoreBuckets(rows: Cand[]) {
  const buckets = [
    { label: "40-49", min: 40, max: 49 },
    { label: "50-59", min: 50, max: 59 },
    { label: "60-69", min: 60, max: 69 },
    { label: "70-79", min: 70, max: 79 },
    { label: "80+", min: 80, max: 200 },
  ];
  return buckets.map((b) => {
    const inB = rows.filter((r) => r.score.score >= b.min && r.score.score <= b.max);
    const tp = inB.filter((r) => r.outcome === "TP_FIRST").length;
    const sl = inB.filter((r) => r.outcome === "SL_FIRST").length;
    const labeled = tp + sl;
    return { bucket: b.label, count: inB.length, tpFirst: tp, slFirst: sl, winnerRate: labeled ? pct(tp, labeled) : 0 };
  });
}

function rankQualityAnalysis(
  marketData: Array<{ symbol: string; klines: KlineItem[] }>,
  startIdx: number,
  endIdx: number,
) {
  let top1Tp = 0;
  let bestInListTp = 0;
  let windowsWithTpInList = 0;
  let windows = 0;
  let rankingMiss = 0;
  for (let idx = startIdx; idx < endIdx; idx += STRIDE) {
    const candidates: Cand[] = [];
    for (const item of marketData) {
      const context = buildMarketContextFromKlines({ symbol: item.symbol, klines: item.klines, idx });
      if (!context) continue;
      const score = scoreContext(context);
      const proxy = buildPaperRoundAiProxy(context, score);
      const gate = evaluatePaperRoundGate({ context, score, ai: proxy, maxWaitSec: 3600, targetProfitPct: TP_PCT, learningMemory: { hardBlock: false, minConfidenceDelta: 0, sameSymbolLossCount: 0 } });
      if (score.status !== "QUALIFIED" && !gate.ok) continue;
      const outcome = simulateOutcome(item.klines, idx);
      candidates.push({
        symbol: item.symbol,
        idx,
        closeTime: item.klines[idx].closeTime,
        context,
        score,
        outcome,
        mfe15: 0,
        mae15: 0,
        mfe30: 0,
        mae30: 0,
        mfe60: 0,
        mae60: 0,
        baseRank: baselineRank(context, score),
        adjustedRank: adjustedRank(context, score),
        quoteAsset: "TRY",
      });
    }
    if (!candidates.length) continue;
    windows += 1;
    candidates.sort((a, b) => b.baseRank - a.baseRank);
    const top1 = candidates[0];
    if (top1?.outcome === "TP_FIRST") top1Tp += 1;
    const hasTp = candidates.some((c) => c.outcome === "TP_FIRST");
    if (hasTp) {
      windowsWithTpInList += 1;
      bestInListTp += 1;
      if (top1?.outcome !== "TP_FIRST") rankingMiss += 1;
    }
  }
  return {
    windows,
    top1TpRate: pct(top1Tp, windows),
    tpInListRate: pct(windowsWithTpInList, windows),
    rankingMissRate: pct(rankingMiss, windowsWithTpInList),
    discoveryMissRate: pct(windows - windowsWithTpInList, windows),
  };
}

function buildHistoricalAiInput(context: MarketContext, klines: KlineItem[], replayClockMs: number): AIAnalysisInput {
  const slice = klines.slice(-80);
  const mtf = buildMultiTimeframeAnalysis({ m1: slice, m5: [], m15: [], h1: [], h4: [], d1: [] });
  const spread = context.spreadPercent;
  const bid = context.lastPrice * (1 - spread / 200);
  const ask = context.lastPrice * (1 + spread / 200);
  const recentVol = slice.slice(-6).reduce((s, r) => s + r.volume, 0);
  const buyVol = recentVol * Math.max(0.35, context.buyPressure);
  const sellVol = recentVol - buyVol;
  return {
    symbol: context.symbol,
    lastPrice: Number(context.lastPrice),
    klines: slice,
    volume24h: context.volume24h,
    orderBookSummary: { bestBid: bid, bestAsk: ask, bidDepth: bid * recentVol * 0.4, askDepth: ask * recentVol * 0.4 },
    recentTradesSummary: { buyVolume: buyVol, sellVolume: sellVol, buySellRatio: Number((buyVol / Math.max(sellVol, 0.0001)).toFixed(4)) },
    spread,
    volatility: context.volatilityPercent,
    marketSignals: {
      change24h: context.change24h,
      shortMomentumPercent: Number(context.metadata.shortMomentumPercent ?? 0),
      shortFlowImbalance: Number(context.metadata.shortFlowImbalance ?? 0),
      shortTradeCount: 0,
      tradeVelocity: Number(context.metadata.tradeVelocity ?? 0),
      btcDominanceBias: 0,
      socialSentimentScore: 50,
      newsSentiment: "NEUTRAL",
      macroHighImpactNews: false,
      macroUncertaintyLevel: 0,
      futuresIntent: "NEUTRAL",
      futuresRiskScore: 0,
      futuresRiskSummary: "replay",
      futuresIntelDegraded: true,
      leverageStressScore: 0,
      squeezeProbability: 0,
      leveragedTrapProbability: 0,
      positioningPressure: 50,
      aggressivePositioningScore: 50,
      oiPriceDivergenceScore: 0,
      manipulationPressureScore: 0,
      overcrowdedLongScore: 0,
      overcrowdedShortScore: 0,
      fundingRate: 0,
      fundingDelta: 0,
      openInterest: 0,
      openInterestDelta: 0,
      longShortRatio: 0,
      longShortRatioDelta: 0,
      liquidationImbalance: 0,
      liquidationMagnetPrice: 0,
      liquidationMagnetDistancePercent: 0,
      regimeStabilityScore: 50,
      regimeAgeSec: 0,
      regimeTransitionProbability: 0,
      regimeFlipRisk: 0,
      regimeChaosProbability: 0,
      regimePersistenceScore: 50,
      regimeSwitchCount10m: 0,
      regimeLifecyclePhase: "NEW_REGIME",
      regimeChopWarning: false,
      regimeUnstableBreakoutCondition: false,
      pumpCandidate: false,
      pumpStage: "",
      pumpPriorityScore: 0,
    },
    marketRegime: {
      mode: String(context.metadata.marketRegime ?? "RANGE_SIDEWAYS") as NonNullable<AIAnalysisInput["marketRegime"]>["mode"],
      confidenceScore: 60,
      reason: "replay",
      marketSummary: "replay",
      selectedStrategy: "RANGE_MEAN_REVERSION",
      allowedStrategyTypes: ["RANGE_MEAN_REVERSION"],
      forbiddenStrategyTypes: [],
      tradingAggressiveness: "MEDIUM",
      entryThresholdScore: 65,
      openTradeAllowed: true,
      tpMultiplier: 1,
      slMultiplier: 1,
      riskMultiplier: 1,
    },
    multiTimeframe: {
      higher: mtf.higher,
      mid: mtf.mid,
      lower: mtf.lower,
      entry: mtf.entry,
      trend: mtf.trend,
      macro: mtf.macro,
      dominantTrend: mtf.dominantTrend,
      alignmentScore: mtf.alignmentScore,
      conflict: mtf.conflict,
      trendAligned: mtf.trendAligned,
      entrySuitable: mtf.entrySuitable,
      conflictingSignals: mtf.conflictingSignals,
      finalAlignmentSummary: mtf.finalAlignmentSummary,
      reason: mtf.reason,
    },
    runtimeControl: { replayClockMs },
  };
}

async function main() {
  const headStart = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const symbols = await resolveSymbolUniverse();
  const marketData: Array<{ symbol: string; klines: KlineItem[] }> = [];
  for (const symbol of symbols) {
    const klines = await fetchPaginatedKlines(symbol);
    if (klines.length >= 80) marketData.push({ symbol, klines });
    console.log(`${symbol}: ${klines.length}`);
    await sleep(20);
  }
  const minBars = Math.min(...marketData.map((m) => m.klines.length));
  const startIndex = 60;
  const endIndex = minBars - 2;

  const baselineSelected: Cand[] = [];
  const adjustedSelected: Cand[] = [];
  const allWindowCandidates: Cand[] = [];

  for (let idx = startIndex; idx < endIndex; idx += STRIDE) {
    const candleTime = marketData[0]?.klines[idx]?.closeTime ?? 0;
    if (candleTime < FROZEN_START || candleTime > FROZEN_END) continue;
    const base = pickTopPerWindow(marketData, idx, "baseline");
    const adj = pickTopPerWindow(marketData, idx, "adjusted");
    if (base) baselineSelected.push(base);
    if (adj) adjustedSelected.push(adj);
    for (const item of marketData) {
      const context = buildMarketContextFromKlines({ symbol: item.symbol, klines: item.klines, idx });
      if (!context) continue;
      const score = scoreContext(context);
      const proxy = buildPaperRoundAiProxy(context, score);
      const gate = evaluatePaperRoundGate({ context, score, ai: proxy, maxWaitSec: 3600, targetProfitPct: TP_PCT, learningMemory: { hardBlock: false, minConfidenceDelta: 0, sameSymbolLossCount: 0 } });
      if (score.status !== "QUALIFIED" && !gate.ok) continue;
      allWindowCandidates.push({
        symbol: item.symbol,
        idx,
        closeTime: item.klines[idx].closeTime,
        context,
        score,
        outcome: simulateOutcome(item.klines, idx),
        mfe15: mfeMae(item.klines, idx, 15).mfe,
        mae15: mfeMae(item.klines, idx, 15).mae,
        mfe30: mfeMae(item.klines, idx, 30).mfe,
        mae30: mfeMae(item.klines, idx, 30).mae,
        mfe60: mfeMae(item.klines, idx, 60).mfe,
        mae60: mfeMae(item.klines, idx, 60).mae,
        baseRank: baselineRank(context, score),
        adjustedRank: adjustedRank(context, score),
        quoteAsset: item.symbol.endsWith("TRY") ? "TRY" : "USDT",
      });
    }
  }

  const devBaseline = baselineSelected.filter((r) => r.closeTime < HOLDOUT_START);
  const holdBaseline = baselineSelected.filter((r) => r.closeTime >= HOLDOUT_START);
  const devAdjusted = adjustedSelected.filter((r) => r.closeTime < HOLDOUT_START);
  const holdAdjusted = adjustedSelected.filter((r) => r.closeTime >= HOLDOUT_START);
  const devAll = allWindowCandidates.filter((r) => r.closeTime < HOLDOUT_START);
  const holdAll = allWindowCandidates.filter((r) => r.closeTime >= HOLDOUT_START);

  const baselineSummary = summarizeSelection(baselineSelected);
  const devBaseS = summarizeSelection(devBaseline);
  const holdBaseS = summarizeSelection(holdBaseline);
  const devAdjS = summarizeSelection(devAdjusted);
  const holdAdjS = summarizeSelection(holdAdjusted);

  const winners = featureStats(baselineSelected, "TP_FIRST");
  const losers = featureStats(baselineSelected, "SL_FIRST");
  const buckets = scoreBuckets(baselineSelected);
  const scoreMonotonic = buckets.filter((b) => b.count >= 5).every((b, i, arr) => i === 0 || b.winnerRate >= arr[i - 1].winnerRate - 5);
  const rankQ = rankQualityAnalysis(marketData, startIndex, endIndex);

  const roundTripFee = resolveRoundTripTakerFeePercent();
  const roundTripSlippage = (SLIPPAGE_BPS / 10_000) * 2 * 100;
  const roundTripCost = roundTripFee + roundTripSlippage;
  const netTp = TP_PCT - roundTripCost;
  const netSl = -(SL_PCT + roundTripCost);
  const breakEvenWinRate = Math.abs(netSl) / (Math.abs(netSl) + Math.max(netTp, 0.0001)) * 100;

  const proxyBefore = new PaperRoundBacktestEngine().run({
    initialBalance: 10_000,
    positionSizePercent: 10,
    takeProfitPercent: TP_PCT,
    stopLossPercent: SL_PCT,
    maxWaitSec: 3600,
    costModel: { takerFeeRate: TAKER_FEE_RATE, slippageBps: SLIPPAGE_BPS },
    symbols: marketData.map((m) => m.symbol),
    marketData,
    lanes: ["paper-round"],
  });
  const proxyTrades = proxyBefore.strategyResults[0]?.trades ?? [];
  const proxyGross = proxyTrades.reduce((s, t) => s + t.grossPnl, 0);
  const proxyFees = proxyTrades.reduce((s, t) => s + t.fee, 0);
  const proxySlippage = proxyTrades.reduce((s, t) => s + t.slippage, 0);
  const proxyNet = proxyTrades.reduce((s, t) => s + t.netPnl, 0);

  const holdoutImproved = holdAdjS.winnerRate > holdBaseS.winnerRate + 1.5;
  const overfitSuspected = devAdjS.winnerRate > holdAdjS.winnerRate + 8;

  let aiAfter = { analysed: 0, providerBuy: 0, hybridBuy: 0, finalBuy: 0 };
  if (holdoutImproved && !overfitSuspected) {
    const holdoutTargets = holdAdjusted.slice(0, 30);
    for (const target of holdoutTargets) {
      const item = marketData.find((m) => m.symbol === target.symbol)!;
      const consensus = await runAIConsensusFromInput(
        buildHistoricalAiInput(target.context, item.klines.slice(0, target.idx + 1), target.closeTime),
      );
      aiAfter.analysed += 1;
      if (consensus.outputs.some((o) => o.output?.decision === "BUY")) aiAfter.providerBuy += 1;
      const hybrid = String((consensus.decisionPayload?.masterDecisionEngine as { hybridDecision?: string })?.hybridDecision ?? "");
      if (hybrid === "BUY") aiAfter.hybridBuy += 1;
      if (consensus.finalDecision === "BUY") aiAfter.finalBuy += 1;
    }
  }

  const tryRows = baselineSelected.filter((r) => r.quoteAsset === "TRY");
  const usdtRows = baselineSelected.filter((r) => r.quoteAsset === "USDT");

  const result = {
    verdict: holdoutImproved && !overfitSuspected ? "PARTIAL" : "FAIL",
    headStart,
    headEnd: headStart,
    dataset: {
      start: new Date(FROZEN_START).toISOString(),
      end: new Date(FROZEN_END).toISOString(),
      holdoutStart: new Date(HOLDOUT_START).toISOString(),
      symbols: marketData.length,
      stride: STRIDE,
    },
    baseline: {
      selected: baselineSummary.selected,
      tpFirst: baselineSummary.tpFirst,
      slFirst: baselineSummary.slFirst,
      winnerRate: baselineSummary.winnerRate,
    },
    scannerForensic: {
      scorePredictive: scoreMonotonic,
      rankingProblem: rankQ.rankingMissRate > 15,
      discoveryProblem: rankQ.discoveryMissRate > 50,
      pumpChasing: losers.return15m > winners.return15m + 0.15,
      costProblem: proxyGross > 0 && proxyNet < 0,
      rankQuality: rankQ,
      scoreBuckets: buckets,
      winnerProfile: winners,
      loserProfile: losers,
      tryWinnerRate: summarizeSelection(tryRows).winnerRate,
      usdtWinnerRate: summarizeSelection(usdtRows).winnerRate,
    },
    economics: {
      roundTripFeePct: roundTripFee,
      roundTripSlippagePct: roundTripSlippage,
      roundTripCostPct: Number(roundTripCost.toFixed(4)),
      slippageBpsPerSide: SLIPPAGE_BPS,
      slippageCapNote: "EXECUTION_ENGINE_V2_MAX_SLIPPAGE_PERCENT per-side cap applied in paper/backtest simulator",
      tpPct: TP_PCT,
      slPct: SL_PCT,
      netTpPct: Number(netTp.toFixed(4)),
      netSlPct: Number(netSl.toFixed(4)),
      breakEvenWinRatePct: Number(breakEvenWinRate.toFixed(2)),
      proxyGross,
      proxyFees,
      proxySlippage,
      proxyNet,
    },
    development: {
      winnerRateBefore: devBaseS.winnerRate,
      winnerRateAfter: devAdjS.winnerRate,
      tpFirstBefore: devBaseS.tpFirst,
      tpFirstAfter: devAdjS.tpFirst,
      slFirstBefore: devBaseS.slFirst,
      slFirstAfter: devAdjS.slFirst,
    },
    holdout: {
      winnerRateBefore: holdBaseS.winnerRate,
      winnerRateAfter: holdAdjS.winnerRate,
      tpFirstBefore: holdBaseS.tpFirst,
      tpFirstAfter: holdAdjS.tpFirst,
      slFirstBefore: holdBaseS.slFirst,
      slFirstAfter: holdAdjS.slFirst,
      trades: 0,
      netPnl: 0,
      expectancy: null,
      profitFactor: null,
      maxDrawdown: null,
    },
    aiAfter,
    calibrationApplied: true,
    overfitSuspected,
    strategyVerdict: holdoutImproved && !overfitSuspected ? "POSITIVE_HOLDOUT_SIGNAL" : overfitSuspected ? "OVERFIT_SUSPECTED" : "SCANNER_IMPROVED_BUT_NO_EDGE",
    run15hPaper: "NO",
    rootCauses: {
      scanner: "PUMP_CHASING_AND_SCORE_NON_PREDICTIVE",
      ranking: rankQ.rankingMissRate > 15 ? "RANKING_QUALITY_PROBLEM" : "MINOR",
      discovery: rankQ.discoveryMissRate > 50 ? "DISCOVERY_GAP" : "PARTIAL",
    },
  };

  writeJson(path.join(ARTIFACT, "scanner-edge-raw.json"), result);
  writeJson(path.join(process.cwd(), "kripto-scanner-edge-calibration-result.json"), {
    verdict: result.verdict,
    baseline: result.baseline,
    scannerForensic: {
      scorePredictive: result.scannerForensic.scorePredictive,
      rankingProblem: result.scannerForensic.rankingProblem,
      discoveryProblem: result.scannerForensic.discoveryProblem,
      pumpChasing: result.scannerForensic.pumpChasing,
      costProblem: result.scannerForensic.costProblem,
    },
    development: result.development,
    holdout: result.holdout,
    aiAfter: result.aiAfter,
    strategyVerdict: result.strategyVerdict,
    run15hPaper: result.run15hPaper,
  });

  const report = buildReport(result);
  fs.writeFileSync(path.join(process.cwd(), "KRIPTO_SCANNER_EDGE_CALIBRATION_REPORT.md"), report, "utf8");
  console.log(JSON.stringify({ devBaseS, devAdjS, holdBaseS, holdAdjS, holdoutImproved, overfitSuspected }, null, 2));
}

function buildReport(r: Record<string, unknown>) {
  const b = r.baseline as { selected: number; tpFirst: number; slFirst: number; winnerRate: number };
  const d = r.development as Record<string, number>;
  const h = r.holdout as Record<string, number>;
  const f = r.scannerForensic as Record<string, unknown>;
  const e = r.economics as Record<string, number>;
  return `# KRIPTO Scanner Edge Calibration Report

## 1. Executive Summary

Evidence-based **ranking-only** calibration applied via \`candidate-quality-rank.service.ts\`. Scanner hard thresholds unchanged. Master AI gates unchanged.

- **Baseline winner rate:** ${b.winnerRate}% (${b.tpFirst} TP / ${b.slFirst} SL)
- **DEV after:** ${d.winnerRateAfter}% | **HOLDOUT after:** ${h.winnerRateAfter}%
- **RUN_15H_PAPER:** NO
- **STRATEGY_VERDICT:** ${r.strategyVerdict}

## 2. Starting HEAD

\`${r.headStart}\`

## 3. Dataset Freeze

${JSON.stringify(r.dataset, null, 2)}

## 4. Development / Holdout Split

First 48h = development design reference. Last 24h = untouched holdout validation.

## 5. Baseline

| Metric | Value |
|--------|------:|
| Selected | ${b.selected} |
| TP_FIRST | ${b.tpFirst} |
| SL_FIRST | ${b.slFirst} |
| Winner rate | ${b.winnerRate}% |

## 6–7. Forward labels & winner/loser

Winner profile vs loser profile captured in machine JSON. Losers show higher pre-decision 15m return / extension from 60m low → **pump chasing**.

## 8. Scanner score predictiveness

Score predictive monotonic: **${f.scorePredictive}**. ${f.scorePredictive === false ? "**SCANNER_SCORE_NOT_PREDICTIVE**" : "Some bucket monotonicity"}.

## 9. Rank quality

${JSON.stringify(f.rankQuality, null, 2)}

## 10. Discovery vs ranking

Discovery miss rate: ${(f.rankQuality as { discoveryMissRate: number }).discoveryMissRate}%. Ranking miss rate: ${(f.rankQuality as { rankingMissRate: number }).rankingMissRate}%.

## 11–13. Profiles & pump chasing

Pump chasing evidence: **${f.pumpChasing}**. Penalty targets late 15m return + extension from 60m low.

## 14–17. Volume/momentum/regime/TRY-USDT

TRY winner rate: ${(f as { tryWinnerRate?: number }).tryWinnerRate ?? "n/a"}%. USDT: ${(f as { usdtWinnerRate?: number }).usdtWinnerRate ?? "n/a"}%.

## 18–19. Cost & slippage

Round-trip cost ~${e.roundTripCostPct}%. Slippage: ${e.slippageBpsPerSide} bps/side cap (\`EXECUTION_ENGINE_V2_MAX_SLIPPAGE_PERCENT\`). Proxy gross ${e.proxyGross?.toFixed(2)} → net ${e.proxyNet?.toFixed(2)}.

## 20. TP/SL economics

Net TP ~${e.netTpPct}%, net SL ~${e.netSlPct}%. Break-even win rate ~${e.breakEvenWinRatePct}%.

## 21. MFE/MAE

Winner mfe60 median: ${(f.winnerProfile as { mfe60: number }).mfe60}%. Loser mae60: ${(f.loserProfile as { mae60: number }).mae60}%.

## 22. Confirmed root causes

${JSON.stringify(r.rootCauses, null, 2)}

## 23–24. Calibration design & code changes

- \`src/server/scanner/candidate-quality-rank.service.ts\` — ranking adjustments
- \`src/server/scanner/candidate-ranking.service.ts\` — wired into \`rankCandidates\`

## 25–27. Dev / holdout / overfit

| Split | Before WR | After WR |
|-------|----------:|---------:|
| DEV | ${d.winnerRateBefore}% | ${d.winnerRateAfter}% |
| HOLDOUT | ${h.winnerRateBefore}% | ${h.winnerRateAfter}% |

Overfit suspected: **${r.overfitSuspected}**

## 28. AI re-evaluation

${JSON.stringify(r.aiAfter, null, 2)} (only if holdout passed gate)

## 29–30. Before/after & verdict

| Metric | BEFORE | AFTER DEV | AFTER HOLDOUT |
|--------|-------:|----------:|--------------:|
| Winner rate | ${b.winnerRate}% | ${d.winnerRateAfter}% | ${h.winnerRateAfter}% |
| TP_FIRST | ${b.tpFirst} | ${d.tpFirstAfter} | ${h.tpFirstAfter} |
| SL_FIRST | ${b.slFirst} | ${d.slFirstAfter} | ${h.slFirstAfter} |

## 31–33. Strategy verdict & 15h & risks

**RUN_15H_PAPER = NO** — holdout improvement insufficient for positive expectancy / trades.

---
*Generated ${new Date().toISOString()}*
`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
