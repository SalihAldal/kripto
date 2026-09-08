/**
 * Fast historical market replay & profitability screen (~20-30 min budget).
 * Usage: npx tsx scripts/run-fast-historical-replay.ts [--hours=72] [--symbols=28] [--aiCap=120] [--stride=15]
 */
import "./load-dotenv.cjs";
import { buildMultiTimeframeAnalysis } from "@/src/server/ai/multi-timeframe.service";
import { runAIConsensusFromInput } from "@/src/server/ai/analysis-orchestrator";
import { evaluateAiExecutionReadiness } from "@/src/server/execution/ai-execution-gate.service";
import { calculateTakerFee, resolveBinanceTakerFeeRate } from "@/src/server/execution/fee-profile";
import {
  calculateNetProfitPercent,
  classifyNetExitOutcome,
  shouldRejectHighRiskLowConfidenceEntry,
} from "@/src/server/execution/profit-thresholds";
import { scoreContext } from "@/src/server/scanner/signal-scoring.engine";
import { buildMarketContextFromKlines } from "@/src/server/trading-core/backtest/paper-round-context";
import {
  buildPaperRoundAiProxy,
  evaluatePaperRoundGate,
  rankPaperRoundCandidate,
  type PaperRoundAiProxy,
} from "@/src/server/trading-core/backtest/paper-round-gates";
import { filterTradeableUniverse, resolveQuoteAssets } from "@/src/server/market-data/spine/universe";
import type { AIAnalysisInput, AIConsensusResult } from "@/src/types/ai";
import type { KlineItem } from "@/src/types/exchange";
import type { MarketContext } from "@/src/types/scanner";

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/config";

process.env.LIVE_TRADING_ENABLED = "false";
process.env.LIVE_AUTHORIZATION = "DISABLED";
process.env.EXECUTION_MODE = process.env.EXECUTION_MODE ?? "PAPER";

const REPLAY_HOURS = Number(process.argv.find((a) => a.startsWith("--hours="))?.split("=")[1] ?? 72);
const MAX_SYMBOLS = Number(process.argv.find((a) => a.startsWith("--symbols="))?.split("=")[1] ?? 28);
const AI_CAP = Number(process.argv.find((a) => a.startsWith("--aiCap="))?.split("=")[1] ?? 120);
const STRIDE = Number(process.argv.find((a) => a.startsWith("--stride="))?.split("=")[1] ?? 15);
const TIME_BUDGET_MS = Number(process.argv.find((a) => a.startsWith("--budgetMin="))?.split("=")[1] ?? 28) * 60_000;
const ARTIFACT_DIR = path.join(process.cwd(), "artifacts", "fast-historical-replay", new Date().toISOString().replace(/[:.]/g, "-"));

const SLIPPAGE_BPS = Math.round(env.EXECUTION_ENGINE_V2_MAX_SLIPPAGE_PERCENT * 100);
const TAKER_FEE_RATE = resolveBinanceTakerFeeRate();
const TP_PCT = env.EXECUTION_DEFAULT_TAKE_PROFIT_PERCENT;
const SL_PCT = env.EXECUTION_DEFAULT_STOP_LOSS_PERCENT;
const MAX_WAIT_SEC = 3600;
const CONFIG_HASH = createHash("sha256")
  .update(
    JSON.stringify({
      tp: TP_PCT,
      sl: SL_PCT,
      elite: 82,
      scannerMin: env.SCANNER_MIN_SCORE,
      slippageBps: SLIPPAGE_BPS,
      fee: TAKER_FEE_RATE,
    }),
  )
  .digest("hex")
  .slice(0, 16);

type ReplayTrade = {
  symbol: string;
  decisionTime: number;
  entryTime: number;
  entryPrice: number;
  quantity: number;
  notional: number;
  aiConfidence: number;
  aiRisk: number;
  stopLoss: number;
  takeProfit: number;
  exitTime: number;
  exitPrice: number;
  exitReason: string;
  grossPnl: number;
  fees: number;
  netPnl: number;
  ambiguousIntrabar: boolean;
};

type Funnel = {
  marketWindows: number;
  scannerCandidates: number;
  hotCandidates: number;
  microConfirmed: number;
  executionReady: number;
  selected: number;
  aiBuy: number;
  aiSell: number;
  aiNoTrade: number;
  aiError: number;
  entryPass: number;
  entryReject: number;
  riskPass: number;
  riskReject: number;
  sizingPass: number;
  sizingReject: number;
  tradesOpened: number;
  tradesClosed: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function pct(n: number, total: number) {
  if (total <= 0) return 0;
  return Number(((n / total) * 100).toFixed(2));
}

function applySlippage(price: number, side: "BUY" | "SELL") {
  const factor = SLIPPAGE_BPS / 10_000;
  return side === "BUY" ? price * (1 + factor) : price * (1 - factor);
}

function consensusToProxy(ai: AIConsensusResult): PaperRoundAiProxy {
  const decision =
    ai.finalDecision === "BUY" || ai.finalDecision === "SELL" || ai.finalDecision === "HOLD"
      ? ai.finalDecision
      : "NO_TRADE";
  return {
    finalDecision: decision,
    finalConfidence: ai.finalConfidence,
    finalRiskScore: ai.finalRiskScore,
    explanation: ai.explanation,
    roleScores: ai.roleScores ?? [],
    analysisScorecard: ai.analysisScorecard,
    decisionPayload: ai.decisionPayload,
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
    lastPrice: context.lastPrice,
    klines: slice,
    volume24h: context.volume24h,
    orderBookSummary: {
      bestBid: bid,
      bestAsk: ask,
      bidDepth: bid * recentVol * 0.4,
      askDepth: ask * recentVol * 0.4,
    },
    recentTradesSummary: {
      buyVolume: buyVol,
      sellVolume: sellVol,
      buySellRatio: Number((buyVol / Math.max(sellVol, 0.0001)).toFixed(4)),
    },
    spread: context.spreadPercent,
    volatility: context.volatilityPercent,
    marketSignals: {
      change24h: context.change24h,
      shortMomentumPercent: Number(context.metadata.shortMomentumPercent ?? 0),
      shortFlowImbalance: Number(context.metadata.shortFlowImbalance ?? 0),
      shortTradeCount: Number(context.metadata.shortTradeCount ?? 0),
      tradeVelocity: Number(context.metadata.tradeVelocity ?? 0),
      btcDominanceBias: Number(context.metadata.btcDominanceBias ?? 0),
      socialSentimentScore: Number(context.metadata.socialSentimentScore ?? 50),
      newsSentiment: "NEUTRAL",
      macroHighImpactNews: false,
      macroUncertaintyLevel: 0,
      futuresIntent: "NEUTRAL",
      futuresRiskScore: Number(context.metadata.futuresRiskScore ?? 0),
      futuresRiskSummary: "historical-replay",
      futuresIntelDegraded: true,
      leverageStressScore: Number(context.metadata.leverageStressScore ?? 0),
      squeezeProbability: 0,
      leveragedTrapProbability: Number(context.metadata.leveragedTrapProbability ?? 0),
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
      regimeStabilityScore: Number(context.metadata.regimeStabilityScore ?? 50),
      regimeAgeSec: 0,
      regimeTransitionProbability: Number(context.metadata.regimeTransitionProbability ?? 0),
      regimeFlipRisk: Number(context.metadata.regimeFlipRisk ?? 0),
      regimeChaosProbability: Number(context.metadata.regimeChaosProbability ?? 0),
      regimePersistenceScore: 50,
      regimeSwitchCount10m: 0,
      regimeLifecyclePhase: String(context.metadata.regimeLifecyclePhase ?? "NEW_REGIME"),
      regimeChopWarning: Boolean(context.metadata.regimeChopWarning ?? false),
      regimeUnstableBreakoutCondition: Boolean(context.metadata.regimeUnstableBreakoutCondition ?? false),
      pumpCandidate: false,
      pumpStage: "",
      pumpPriorityScore: 0,
    },
    marketRegime: {
      mode: String(context.metadata.marketRegime ?? "RANGE_SIDEWAYS") as NonNullable<AIAnalysisInput["marketRegime"]>["mode"],
      confidenceScore: Number(context.metadata.marketRegimeConfidenceScore ?? 60),
      reason: String(context.metadata.marketRegimeReason ?? "historical replay"),
      marketSummary: "historical replay",
      selectedStrategy: String(context.metadata.marketRegimeStrategy ?? "RANGE_MEAN_REVERSION"),
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

async function fetchPaginatedKlines(symbol: string, hours: number): Promise<KlineItem[]> {
  const { getExchangeProvider } = await import("@/src/server/exchange");
  const provider = getExchangeProvider();
  const interval = "1m";
  const targetMs = hours * 60 * 60 * 1000;
  const endTime = Date.now();
  let cursorEnd = endTime;
  const merged: KlineItem[] = [];
  const seen = new Set<number>();

  for (let page = 0; page < 8; page += 1) {
    let batch: KlineItem[] = [];
    try {
      const bases = (env.BINANCE_PUBLIC_HTTP_BASES ?? "https://api.binance.me").split(",");
      const base = bases[0]?.trim() || "https://api.binance.me";
      const params = new URLSearchParams({
        symbol: symbol.toUpperCase(),
        interval,
        limit: "1000",
        endTime: String(cursorEnd),
      });
      const res = await fetch(`${base}/api/v3/klines?${params.toString()}`);
      if (!res.ok) throw new Error(`klines ${res.status}`);
      const raw = (await res.json()) as unknown[];
      batch = raw
        .filter((row) => Array.isArray(row) && row.length >= 6)
        .map((row) => {
          const r = row as unknown[];
          return {
            openTime: Number(r[0]),
            closeTime: Number(r[6] ?? r[0]),
            open: Number(r[1]),
            high: Number(r[2]),
            low: Number(r[3]),
            close: Number(r[4]),
            volume: Number(r[5]),
          };
        });
    } catch {
      try {
        batch = await provider.getKlines(symbol.toUpperCase(), interval, 1000);
      } catch {
        batch = [];
      }
    }

    if (batch.length === 0) break;
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
    await sleep(40);
  }

  const cutoff = endTime - targetMs;
  return merged.filter((row) => row.closeTime >= cutoff);
}

async function resolveSymbolUniverse(limit: number): Promise<string[]> {
  const { getExchangeProvider } = await import("@/src/server/exchange");
  const provider = getExchangeProvider();
  const quotes = resolveQuoteAssets(env.BINANCE_PLATFORM, env.MARKET_DATA_QUOTE_ASSETS);
  const info = await provider.getExchangeInfo();
  const tradeable = filterTradeableUniverse(info.symbols ?? [], { quoteAssets: quotes });
  const tickers = (await provider.listTickers24h?.().catch(() => [])) ?? [];
  const volumeBySymbol = new Map(tickers.map((t) => [String(t.symbol).toUpperCase(), Number(t.volume24h ?? 0)]));
  const trySymbols = tradeable.filter((s) => s.quoteAsset === "TRY").sort((a, b) => (volumeBySymbol.get(b.symbol) ?? 0) - (volumeBySymbol.get(a.symbol) ?? 0));
  const usdtSymbols = tradeable.filter((s) => s.quoteAsset === "USDT").sort((a, b) => (volumeBySymbol.get(b.symbol) ?? 0) - (volumeBySymbol.get(a.symbol) ?? 0));
  const half = Math.ceil(limit / 2);
  const picked = [...trySymbols.slice(0, half), ...usdtSymbols.slice(0, limit - half)].map((s) => s.symbol);
  return Array.from(new Set(picked)).slice(0, limit);
}

function simulateTrade(input: {
  symbol: string;
  decisionTime: number;
  entryIdx: number;
  klines: KlineItem[];
  aiConfidence: number;
  aiRisk: number;
  notional: number;
}): ReplayTrade | null {
  const rows = input.klines;
  const signalCandle = rows[input.entryIdx];
  if (!signalCandle) return null;
  const nextIdx = input.entryIdx + 1;
  if (nextIdx >= rows.length) return null;
  const entryCandle = rows[nextIdx];
  const entryPrice = applySlippage(entryCandle.open, "BUY");
  const quantity = input.notional / entryPrice;
  const tpPrice = entryPrice * (1 + TP_PCT / 100);
  const slPrice = entryPrice * (1 - SL_PCT / 100);
  const entryFee = calculateTakerFee(input.notional);

  for (let i = nextIdx; i < rows.length; i += 1) {
    const candle = rows[i];
    const ageSec = Math.max(0, Math.floor((candle.closeTime - entryCandle.openTime) / 1000));
    const hitTp = candle.high >= tpPrice;
    const hitSl = candle.low <= slPrice;
    const timedOut = ageSec >= MAX_WAIT_SEC;
    let exitReason = "";
    let exitPrice = candle.close;
    let ambiguous = false;

    if (hitTp && hitSl) {
      ambiguous = true;
      exitReason = "AMBIGUOUS_INTRABAR";
      exitPrice = slPrice;
    } else if (hitTp) {
      exitReason = "TAKE_PROFIT";
      exitPrice = tpPrice;
    } else if (hitSl) {
      exitReason = "STOP_LOSS";
      exitPrice = slPrice;
    } else if (timedOut) {
      exitReason = "TIMEOUT";
      exitPrice = candle.close;
    } else {
      continue;
    }

    const filledExit = applySlippage(exitPrice, "SELL");
    const exitFee = calculateTakerFee(filledExit * quantity);
    const grossPnl = (filledExit - entryPrice) * quantity;
    const fees = entryFee + exitFee;
    const netPnl = grossPnl - fees;

    return {
      symbol: input.symbol,
      decisionTime: input.decisionTime,
      entryTime: entryCandle.openTime,
      entryPrice: Number(entryPrice.toFixed(8)),
      quantity: Number(quantity.toFixed(8)),
      notional: Number(input.notional.toFixed(8)),
      aiConfidence: input.aiConfidence,
      aiRisk: input.aiRisk,
      stopLoss: Number(slPrice.toFixed(8)),
      takeProfit: Number(tpPrice.toFixed(8)),
      exitTime: candle.closeTime,
      exitPrice: Number(filledExit.toFixed(8)),
      exitReason,
      grossPnl: Number(grossPnl.toFixed(8)),
      fees: Number(fees.toFixed(8)),
      netPnl: Number(netPnl.toFixed(8)),
      ambiguousIntrabar: ambiguous,
    };
  }
  return null;
}

function computePerformance(trades: ReplayTrade[]) {
  const closed = trades.filter((t) => t.exitTime > 0);
  const wins = closed.filter((t) => t.netPnl > 0);
  const losses = closed.filter((t) => t.netPnl < 0);
  const grossPnl = closed.reduce((s, t) => s + t.grossPnl, 0);
  const fees = closed.reduce((s, t) => s + t.fees, 0);
  const netPnl = closed.reduce((s, t) => s + t.netPnl, 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.netPnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.netPnl, 0) / losses.length) : 0;
  const winRate = closed.length ? wins.length / closed.length : null;
  const lossRate = closed.length ? losses.length / closed.length : 0;
  const profitFactor =
    losses.length === 0 ? (wins.length > 0 ? null : null) : wins.reduce((s, t) => s + t.netPnl, 0) / Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
  const expectancy = winRate !== null ? winRate * avgWin - lossRate * avgLoss : null;

  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  for (const t of closed) {
    equity += t.netPnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const avgHold =
    closed.length > 0
      ? closed.reduce((s, t) => s + (t.exitTime - t.entryTime) / 1000, 0) / closed.length
      : null;

  return {
    wins: wins.length,
    losses: losses.length,
    winRate: winRate !== null ? Number((winRate * 100).toFixed(2)) : null,
    grossPnl: Number(grossPnl.toFixed(4)),
    fees: Number(fees.toFixed(4)),
    netPnl: Number(netPnl.toFixed(4)),
    averageWin: Number(avgWin.toFixed(4)),
    averageLoss: Number(avgLoss.toFixed(4)),
    profitFactor: profitFactor !== null && Number.isFinite(profitFactor) ? Number(profitFactor.toFixed(4)) : null,
    expectancy: expectancy !== null ? Number(expectancy.toFixed(4)) : null,
    maxDrawdown: Number(maxDrawdown.toFixed(4)),
    averageHoldingTimeSec: avgHold !== null ? Number(avgHold.toFixed(0)) : null,
  };
}

function sampleVerdict(closed: number) {
  if (closed === 0) return "NO_TRADE_SAMPLE";
  if (closed <= 4) return "VERY_LOW_SAMPLE";
  if (closed <= 19) return "LOW_SAMPLE";
  if (closed <= 49) return "PRELIMINARY_SAMPLE";
  return "USEFUL_FAST_REPLAY_SAMPLE";
}

function resolveStrategyVerdict(input: {
  aiBuy: number;
  selected: number;
  trades: number;
  netPnl: number;
  expectancy: number | null;
}) {
  if (input.selected < 5) return "INSUFFICIENT_REPLAY_DATA";
  if (input.selected >= 10 && input.aiBuy === 0) return "TOO_SELECTIVE";
  if (input.trades >= 3 && input.expectancy !== null && input.expectancy < -2) return "NEGATIVE_FAST_EVIDENCE";
  if (input.trades >= 3 && input.netPnl > 0 && input.expectancy !== null && input.expectancy > 0) return "POSITIVE_FAST_EVIDENCE";
  if (input.aiBuy > 0 || input.trades > 0) return "MIXED_FAST_EVIDENCE";
  return "TOO_SELECTIVE";
}

function resolveRun15h(input: {
  aiBuy: number;
  trades: number;
  expectancy: number | null;
  sample: string;
  strategyVerdict: string;
}) {
  if (input.strategyVerdict === "TOO_SELECTIVE" && input.aiBuy === 0) return "NO";
  if (input.strategyVerdict === "NEGATIVE_FAST_EVIDENCE") return "NO";
  if (input.aiBuy > 0 && input.trades > 0 && input.expectancy !== null && input.expectancy >= 0) return "YES";
  if (input.aiBuy > 0 && input.trades > 0) return "CONDITIONAL";
  if (input.aiBuy > 0 && input.trades === 0) return "CONDITIONAL";
  if (input.sample === "NO_TRADE_SAMPLE" && input.aiBuy === 0) return "NO";
  return "CONDITIONAL";
}

async function main() {
  const startedAt = Date.now();
  const head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  console.log(`HEAD=${head}`);
  console.log(`Replay hours=${REPLAY_HOURS} symbols=${MAX_SYMBOLS} aiCap=${AI_CAP} stride=${STRIDE}min`);

  const symbols = await resolveSymbolUniverse(MAX_SYMBOLS);
  console.log(`Universe: ${symbols.length} symbols`);

  const marketData: Array<{ symbol: string; klines: KlineItem[] }> = [];
  for (const symbol of symbols) {
    if (Date.now() - startedAt > TIME_BUDGET_MS * 0.35) break;
    const klines = await fetchPaginatedKlines(symbol, REPLAY_HOURS);
    if (klines.length >= 80) marketData.push({ symbol, klines });
    console.log(`  ${symbol}: ${klines.length} candles`);
    await sleep(30);
  }

  if (marketData.length === 0) throw new Error("No market data loaded");

  const minBars = Math.min(...marketData.map((m) => m.klines.length));
  const startIndex = 60;
  const endIndex = minBars - 2;
  const startTime = marketData[0]!.klines[startIndex]?.openTime ?? 0;
  const endTime = marketData[0]!.klines[endIndex]?.closeTime ?? 0;

  const funnel: Funnel = {
    marketWindows: 0,
    scannerCandidates: 0,
    hotCandidates: 0,
    microConfirmed: 0,
    executionReady: 0,
    selected: 0,
    aiBuy: 0,
    aiSell: 0,
    aiNoTrade: 0,
    aiError: 0,
    entryPass: 0,
    entryReject: 0,
    riskPass: 0,
    riskReject: 0,
    sizingPass: 0,
    sizingReject: 0,
    tradesOpened: 0,
    tradesClosed: 0,
  };

  const rejectionHistogram = new Map<string, number>();
  const aiCache = new Map<string, AIConsensusResult>();
  const selectedQueue: Array<{
    symbol: string;
    idx: number;
    context: MarketContext;
    score: ReturnType<typeof scoreContext>;
    proxy: PaperRoundAiProxy;
    closeTime: number;
  }> = [];
  const trades: ReplayTrade[] = [];
  const MIN_NOTIONAL = 500;

  for (let idx = startIndex; idx < endIndex; idx += STRIDE) {
    if (Date.now() - startedAt > TIME_BUDGET_MS * 0.55) break;
    funnel.marketWindows += 1;
    const windowCandidates: Array<{
      symbol: string;
      idx: number;
      context: MarketContext;
      score: ReturnType<typeof scoreContext>;
      proxy: PaperRoundAiProxy;
      rank: number;
      gateOk: boolean;
      closeTime: number;
    }> = [];

    for (const item of marketData) {
      const candle = item.klines[idx];
      if (!candle) continue;
      const context = buildMarketContextFromKlines({ symbol: item.symbol, klines: item.klines, idx });
      if (!context) continue;
      const score = scoreContext(context);
      if (score.score >= env.SCANNER_MIN_SCORE * 0.85) funnel.scannerCandidates += 1;
      if (score.status === "QUALIFIED") funnel.hotCandidates += 1;
      const shortMom = Number(context.metadata.shortMomentumPercent ?? 0);
      const shortFlow = Number(context.metadata.shortFlowImbalance ?? 0);
      if (shortMom >= 0.004 || shortFlow >= 0.002) funnel.microConfirmed += 1;

      const proxy = buildPaperRoundAiProxy(context, score);
      const gate = evaluatePaperRoundGate({
        context,
        score,
        ai: proxy,
        maxWaitSec: MAX_WAIT_SEC,
        targetProfitPct: TP_PCT,
        learningMemory: { hardBlock: false, minConfidenceDelta: 0, sameSymbolLossCount: 0 },
      });
      if (gate.ok) funnel.executionReady += 1;

      if (score.status !== "QUALIFIED" && !gate.ok) continue;
      const rank = rankPaperRoundCandidate({ context, score, ai: proxy });
      windowCandidates.push({
        symbol: item.symbol,
        idx,
        context,
        score,
        proxy,
        rank,
        gateOk: gate.ok,
        closeTime: candle.closeTime,
      });
    }

    if (windowCandidates.length === 0) continue;
    windowCandidates.sort((a, b) => b.rank - a.rank);
    const top = windowCandidates[0]!;
    funnel.selected += 1;
    selectedQueue.push({
      symbol: top.symbol,
      idx: top.idx,
      context: top.context,
      score: top.score,
      proxy: top.proxy,
      closeTime: top.closeTime,
    });
  }

  const deduped = new Map<string, (typeof selectedQueue)[number]>();
  for (const row of selectedQueue) {
    const hourKey = `${row.symbol}:${Math.floor(row.closeTime / (60 * 60 * 1000))}`;
    const prev = deduped.get(hourKey);
    if (!prev || row.score.score > prev.score.score) deduped.set(hourKey, row);
  }
  const aiTargets = Array.from(deduped.values()).slice(0, AI_CAP);
  console.log(`Selected windows=${funnel.selected} unique AI targets=${aiTargets.length}`);

  let aiCalls = 0;
  let aiRemoteHealthy = 0;
  let aiAllDegraded = 0;
  for (const target of aiTargets) {
    if (Date.now() - startedAt > TIME_BUDGET_MS * 0.92) break;
    const item = marketData.find((m) => m.symbol === target.symbol);
    if (!item) continue;
    const klinesSlice = item.klines.slice(0, target.idx + 1);
    const fingerprint = createHash("sha256")
      .update(`${target.symbol}|${target.closeTime}|${klinesSlice.at(-1)?.close}|${CONFIG_HASH}`)
      .digest("hex");
    let consensus = aiCache.get(fingerprint);
    if (!consensus) {
      try {
        const aiInput = buildHistoricalAiInput(target.context, klinesSlice, target.closeTime);
        consensus = await runAIConsensusFromInput(aiInput);
        aiCache.set(fingerprint, consensus);
        aiCalls += 1;
        if (aiCalls % 5 === 0) console.log(`  AI progress ${aiCalls}/${aiTargets.length}`);
      } catch (error) {
        funnel.aiError += 1;
        rejectionHistogram.set("AI_ERROR", (rejectionHistogram.get("AI_ERROR") ?? 0) + 1);
        continue;
      }
    }

    const decision = String(consensus.finalDecision ?? "NO_TRADE").toUpperCase();
    if (consensus.outputs.some((row) => row.remoteOk)) aiRemoteHealthy += 1;
    else if (String(consensus.explanation ?? "").includes("AI_PROVIDER_DEGRADED")) aiAllDegraded += 1;

    if (decision === "BUY") funnel.aiBuy += 1;
    else if (decision === "SELL") funnel.aiSell += 1;
    else funnel.aiNoTrade += 1;

    const aiGate = evaluateAiExecutionReadiness({
      ai: consensus,
      policy: "ADVISORY",
      learningLane: false,
      microTradeEligible: false,
    });

    const entryQuality = shouldRejectHighRiskLowConfidenceEntry({
      confidencePercent: consensus.finalConfidence,
      aiRiskScore: consensus.finalRiskScore,
      marketRegime: String(target.context.metadata.marketRegime ?? "RANGE_SIDEWAYS"),
    });

    const proxyFromAi = consensusToProxy(consensus);
    const prodGate = evaluatePaperRoundGate({
      context: target.context,
      score: target.score,
      ai: proxyFromAi,
      maxWaitSec: MAX_WAIT_SEC,
      targetProfitPct: TP_PCT,
      learningMemory: { hardBlock: false, minConfidenceDelta: 0, sameSymbolLossCount: 0 },
    });

    if (decision !== "BUY") {
      rejectionHistogram.set("AI_NO_BUY", (rejectionHistogram.get("AI_NO_BUY") ?? 0) + 1);
      continue;
    }

    if (entryQuality.reject || !prodGate.ok) {
      funnel.entryReject += 1;
      const reason = entryQuality.reason ?? prodGate.reason ?? "ENTRY_QUALITY";
      const bucket = reason.includes("ENTRY_QUALITY") ? "ENTRY_QUALITY_REJECT" : "GATE_REJECT";
      rejectionHistogram.set(bucket, (rejectionHistogram.get(bucket) ?? 0) + 1);
      continue;
    }
    funnel.entryPass += 1;

    if (consensus.finalRiskScore > 92 || aiGate.verdict === "AI_GATE_BLOCK") {
      funnel.riskReject += 1;
      rejectionHistogram.set("RISK_REJECT", (rejectionHistogram.get("RISK_REJECT") ?? 0) + 1);
      continue;
    }
    funnel.riskPass += 1;

    const notional = MIN_NOTIONAL;
    if (notional < 100) {
      funnel.sizingReject += 1;
      rejectionHistogram.set("SIZING_REJECT", (rejectionHistogram.get("SIZING_REJECT") ?? 0) + 1);
      continue;
    }
    funnel.sizingPass += 1;
    funnel.tradesOpened += 1;

    const trade = simulateTrade({
      symbol: target.symbol,
      decisionTime: target.closeTime,
      entryIdx: target.idx,
      klines: item.klines,
      aiConfidence: consensus.finalConfidence,
      aiRisk: consensus.finalRiskScore,
      notional,
    });
    if (trade) {
      trades.push(trade);
      funnel.tradesClosed += 1;
    }
  }

  const performance = computePerformance(trades);

  const { PaperRoundBacktestEngine } = await import("@/src/server/trading-core/backtest/paper-round-backtest.engine");
  const proxyBacktest = new PaperRoundBacktestEngine().run({
    initialBalance: 10_000,
    positionSizePercent: 10,
    takeProfitPercent: TP_PCT,
    stopLossPercent: SL_PCT,
    maxWaitSec: MAX_WAIT_SEC,
    costModel: { takerFeeRate: TAKER_FEE_RATE, slippageBps: SLIPPAGE_BPS },
    symbols: marketData.map((m) => m.symbol),
    marketData,
    lanes: ["paper-round"],
  });
  const proxyPrimary = proxyBacktest.strategyResults[0];
  const proxyTrades = proxyPrimary?.trades ?? [];
  const proxyPerformance = computePerformance(
    proxyTrades.map((t) => ({
      symbol: t.symbol,
      decisionTime: t.entryTime,
      entryTime: t.entryTime,
      entryPrice: t.entryPrice,
      quantity: t.quantity,
      notional: t.notional,
      aiConfidence: 0,
      aiRisk: 0,
      stopLoss: 0,
      takeProfit: 0,
      exitTime: t.exitTime,
      exitPrice: t.exitPrice,
      exitReason: t.exitReason,
      grossPnl: t.grossPnl,
      fees: t.fee,
      netPnl: t.netPnl,
      ambiguousIntrabar: false,
    })),
  );

  const timeBudgetReached = Date.now() - startedAt >= TIME_BUDGET_MS * 0.9;
  const sampleVerdictLabel = sampleVerdict(funnel.tradesClosed);

  let dominantGate = "AI_NO_BUY";
  if (funnel.selected > 0 && funnel.aiBuy === 0) dominantGate = "AI_NO_BUY";
  else if (funnel.entryReject > funnel.aiBuy) dominantGate = "ENTRY_QUALITY_REJECT";
  else if (funnel.riskReject > 0) dominantGate = "RISK_REJECT";
  else if (funnel.tradesOpened === 0 && funnel.executionReady === 0) dominantGate = "SCANNER_TOO_SELECTIVE";
  else if (funnel.tradesOpened > 0) dominantGate = "TRADE_OPENED";

  let whyZeroTrades: string | null = null;
  if (funnel.tradesClosed === 0) {
    if (aiAllDegraded >= aiCalls && aiCalls > 0) whyZeroTrades = "EXECUTION_PATH_FAILURE";
    else if (funnel.aiBuy === 0 && funnel.selected >= 5) whyZeroTrades = "AI_NO_BUY";
    else if (funnel.executionReady === 0) whyZeroTrades = "SCANNER_TOO_SELECTIVE";
    else if (funnel.entryReject > 0) whyZeroTrades = "ENTRY_QUALITY_REJECT";
    else if (funnel.selected < 5) whyZeroTrades = "INSUFFICIENT_REPLAY_SAMPLE";
    else whyZeroTrades = "AI_NO_BUY";
  }

  const strategyVerdict = resolveStrategyVerdict({
    aiBuy: funnel.aiBuy,
    selected: funnel.selected,
    trades: funnel.tradesClosed,
    netPnl: performance.netPnl,
    expectancy: performance.expectancy,
  });

  const run15hPaper = resolveRun15h({
    aiBuy: funnel.aiBuy,
    trades: funnel.tradesClosed,
    expectancy: performance.expectancy,
    sample: sampleVerdictLabel,
    strategyVerdict,
  });

  const machineResult = {
    verdict: funnel.tradesClosed > 0 || funnel.aiBuy > 0 ? "PARTIAL" : "FAIL",
    head,
    replayWindow: {
      start: new Date(startTime).toISOString(),
      end: new Date(endTime).toISOString(),
      hours: REPLAY_HOURS,
      symbols: marketData.length,
      marketWindows: funnel.marketWindows,
      strideMinutes: STRIDE,
      candlesLoaded: marketData.reduce((s, m) => s + m.klines.length, 0),
      timeframe: "1m",
      dataSource: "binance-public-klines",
    },
    replayCandidateCap: AI_CAP,
    configHash: CONFIG_HASH,
    funnel: {
      ...funnel,
      aiBuyRate: pct(funnel.aiBuy, funnel.selected),
      conversion: {
        scannerToSelected: pct(funnel.selected, funnel.scannerCandidates),
        selectedToAiBuy: pct(funnel.aiBuy, funnel.selected),
        aiBuyToEntryPass: pct(funnel.entryPass, funnel.aiBuy),
        entryToTrade: pct(funnel.tradesOpened, funnel.entryPass),
      },
    },
    performance,
    dominantGate,
    whyZeroTrades,
    rejectionHistogram: Object.fromEntries(rejectionHistogram),
    sampleVerdict: sampleVerdictLabel,
    strategyVerdict,
    run15hPaper,
    timeBudgetReached,
    liveTradingEnabled: false,
    aiCalls,
    aiRemoteHealthy,
    aiAllDegraded,
    proxyBacktest: {
      note: "Scanner+proxy-AI lane (not production real-AI); supplementary trade capacity signal",
      tradesClosed: proxyTrades.length,
      performance: proxyPerformance,
      gatePasses: proxyPrimary?.diagnostics?.gatePasses ?? 0,
      candidateScans: proxyPrimary?.diagnostics?.candidateScans ?? 0,
    },
    trades,
    durationSec: Math.round((Date.now() - startedAt) / 1000),
  };

  writeJson(path.join(ARTIFACT_DIR, "replay-raw.json"), machineResult);
  writeJson(path.join(process.cwd(), "kripto-fast-historical-replay-result.json"), {
    verdict: machineResult.verdict,
    replayWindow: machineResult.replayWindow,
    funnel: machineResult.funnel,
    performance: machineResult.performance,
    proxyBacktestSupplement: machineResult.proxyBacktest,
    aiRemoteHealthy: machineResult.aiRemoteHealthy,
    aiCalls: machineResult.aiCalls,
    replayCandidateCap: AI_CAP,
    dominantGate: machineResult.dominantGate,
    whyZeroTrades: machineResult.whyZeroTrades,
    sampleVerdict: machineResult.sampleVerdict,
    strategyVerdict: machineResult.strategyVerdict,
    run15hPaper: machineResult.run15hPaper,
    timeBudgetReached: machineResult.timeBudgetReached,
    liveTradingEnabled: false,
  });

  const report = buildReport(machineResult);
  fs.writeFileSync(path.join(process.cwd(), "KRIPTO_FAST_HISTORICAL_REPLAY_REPORT.md"), report, "utf8");

  console.log("\n=== FAST REPLAY COMPLETE ===");
  console.log(
    JSON.stringify(
      {
        selected: funnel.selected,
        aiBuy: funnel.aiBuy,
        trades: funnel.tradesClosed,
        netPnl: performance.netPnl,
        run15hPaper,
        strategyVerdict,
        durationSec: machineResult.durationSec,
      },
      null,
      2,
    ),
  );
}

function buildReport(data: Record<string, unknown>) {
  const f = data.funnel as Funnel & { aiBuyRate?: number; conversion?: Record<string, number> };
  const p = data.performance as ReturnType<typeof computePerformance>;
  const w = data.replayWindow as {
    start: string;
    end: string;
    hours: number;
    symbols: number;
    marketWindows: number;
    strideMinutes: number;
    candlesLoaded: number;
    timeframe: string;
    dataSource: string;
  };

  const funnelLines = [
    `| Stage | Count | Conv % |`,
    `|-------|------:|-------:|`,
    `| Market windows | ${f.marketWindows} | 100 |`,
    `| Scanner candidates | ${f.scannerCandidates} | ${pct(f.scannerCandidates, f.marketWindows)} |`,
    `| Hot (QUALIFIED) | ${f.hotCandidates} | ${pct(f.hotCandidates, f.scannerCandidates)} |`,
    `| Micro confirmed | ${f.microConfirmed} | ${pct(f.microConfirmed, f.hotCandidates)} |`,
    `| Execution ready (proxy gate) | ${f.executionReady} | ${pct(f.executionReady, f.microConfirmed)} |`,
    `| Selected (top/window) | ${f.selected} | ${pct(f.selected, f.marketWindows)} |`,
    `| AI BUY | ${f.aiBuy} | ${pct(f.aiBuy, f.selected)} |`,
    `| Entry pass | ${f.entryPass} | ${pct(f.entryPass, f.aiBuy)} |`,
    `| Risk pass | ${f.riskPass} | ${pct(f.riskPass, f.entryPass)} |`,
    `| Sizing pass | ${f.sizingPass} | ${pct(f.sizingPass, f.riskPass)} |`,
    `| Trades opened | ${f.tradesOpened} | ${pct(f.tradesOpened, f.sizingPass)} |`,
    `| Trades closed | ${f.tradesClosed} | — |`,
  ].join("\n");

  return `# KRIPTO Fast Historical Replay Report

## 1. Executive Summary

Bounded fast replay on real Binance 1m klines using production scanner scoring, real AI consensus on selected candidates (cap ${data.replayCandidateCap}), production admission gates, and fee/slippage-aware trade simulation.

- **RUN_15H_PAPER:** ${data.run15hPaper}
- **STRATEGY_VERDICT:** ${data.strategyVerdict}
- **Dominant gate:** ${data.dominantGate}
- **Duration:** ${data.durationSec}s | Time budget reached: ${data.timeBudgetReached}

## 2. HEAD

\`${data.head}\`

## 3. Replay Methodology

- Candidate-first scan: production \`scoreContext\` + \`rankPaperRoundCandidate\` per ${w.strideMinutes}m window
- AI only on deduped selected candidates (hourly bucket), max ${data.replayCandidateCap} calls
- Real \`runAIConsensusFromInput\` with response cache (symbol+timestamp+context fingerprint+config hash)
- Trade sim: next-candle open entry (lookahead-safe), TP=${TP_PCT}% SL=${SL_PCT}%, conservative SL on ambiguous intrabar

## 4. Lookahead Protection

- Context built with \`buildMarketContextFromKlines({ idx })\` — candles ≤ decision index only
- Entry at candle[idx+1].open after signal at idx close
- Future candles used only post-entry for exit/PnL

## 5. Dataset

| Field | Value |
|-------|-------|
| startTime | ${w.start} |
| endTime | ${w.end} |
| hours | ${w.hours} |
| symbols | ${w.symbols} |
| candlesLoaded | ${w.candlesLoaded} |
| timeframe | ${w.timeframe} |
| dataSource | ${w.dataSource} |

## 6. Data Quality

Real Binance public klines; TRY+USDT universe via production \`filterTradeableUniverse\`. Volume-ranked symbol pick.

## 7. Production Strategy Parity

Scanner thresholds frozen (SCANNER_MIN_SCORE=${env.SCANNER_MIN_SCORE}). Elite confidence 82% entry quality gate unchanged. No threshold relaxation.

## 8. Scanner Funnel

${funnelLines}

## 9. Candidate Funnel

Selected = top ranked candidate per stride window among QUALIFIED or proxy-gate-pass symbols.

## 10. AI Consensus

Real provider consensus: ${data.aiCalls} API calls. Remote-healthy: ${data.aiRemoteHealthy}/${data.aiCalls}. ALL_DEGRADED: ${data.aiAllDegraded}. AI errors: ${f.aiError}.

## 10b. Proxy Backtest Supplement (non-production AI)

Scanner + proxy-AI paper-round lane on same dataset: ${(data.proxyBacktest as { tradesClosed?: number })?.tradesClosed ?? 0} closed trades, net PnL ${(data.proxyBacktest as { performance?: { netPnl?: number } })?.performance?.netPnl ?? 0}. Gate passes: ${(data.proxyBacktest as { gatePasses?: number })?.gatePasses ?? 0}/${(data.proxyBacktest as { candidateScans?: number })?.candidateScans ?? 0}.

## 11. AI BUY Analysis

- AI BUY: ${f.aiBuy} (${f.aiBuyRate ?? pct(f.aiBuy, f.selected)}% of selected)
- AI SELL: ${f.aiSell}
- AI NO_TRADE/HOLD: ${f.aiNoTrade}

${f.selected >= 5 && f.aiBuy === 0 ? "**Critical:** sufficient selected sample but AI BUY=0 — 15h PAPER value is low." : ""}

## 12. Entry Quality

Pass: ${f.entryPass} | Reject: ${f.entryReject} (82% elite + production gate)

## 13. Risk

Pass: ${f.riskPass} | Reject: ${f.riskReject}

## 14. Sizing

Pass: ${f.sizingPass} | Reject: ${f.sizingReject} | Min notional: 500

## 15. Trades

${((data.trades as ReplayTrade[]) ?? []).map((t) => `- ${t.symbol} entry=${t.entryPrice} exit=${t.exitPrice} net=${t.netPnl} (${t.exitReason})`).join("\n") || "No trades"}

## 16. Exit Results

TP/SL/TIMEOUT/AMBIGUOUS_INTRABAR per production conservative policy (SL wins on same-candle TP+SL).

## 17. Fees / Slippage

Taker fee rate: ${TAKER_FEE_RATE} per leg. Slippage: ${SLIPPAGE_BPS} bps per side (${env.EXECUTION_ENGINE_V2_MAX_SLIPPAGE_PERCENT}% production cap).

## 18. PnL

Gross: ${p.grossPnl} | Fees: ${p.fees} | Net: ${p.netPnl}

## 19. Win Rate

${p.winRate ?? "n/a"}% (${p.wins}W / ${p.losses}L)

## 20. Profit Factor

${p.profitFactor ?? "n/a"}

## 21. Expectancy

${p.expectancy ?? "n/a"}

## 22. Drawdown

Max drawdown: ${p.maxDrawdown}

## 23. Rejection Histogram

${JSON.stringify(data.rejectionHistogram, null, 2)}

## 24. WHY_ZERO_TRADES

${data.whyZeroTrades ?? "n/a"}

## 25. Sample Quality

${data.sampleVerdict}

## 26. Strategy Verdict

${data.strategyVerdict}

## 27. 15H PAPER Decision

**RUN_15H_PAPER = ${data.run15hPaper}**

## 28. Limitations

Fast screen only — not statistical certainty. REPLAY_CANDIDATE_CAP=${data.replayCandidateCap}. Stride=${w.strideMinutes}m subsampling. Historical order book/trades approximated from kline context.

## 29. Recommended Next Step

${data.run15hPaper === "NO" ? "Do not commit 15h PAPER until AI BUY rate improves or strategy blockers addressed." : data.run15hPaper === "YES" ? "Proceed with 15h bounded PAPER campaign; monitor AI BUY conversion live." : "Optional short PAPER (4-8h) to validate live AI BUY conversion before 15h."}

---
*Generated ${new Date().toISOString()}*
`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
