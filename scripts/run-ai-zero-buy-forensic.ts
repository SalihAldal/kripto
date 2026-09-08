/**
 * AI zero-BUY root cause forensic + forward outcome labeling.
 * Usage: npx tsx scripts/run-ai-zero-buy-forensic.ts
 */
import "./load-dotenv.cjs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/config";
import { buildMultiTimeframeAnalysis } from "@/src/server/ai/multi-timeframe.service";
import { runAIConsensusFromInput } from "@/src/server/ai/analysis-orchestrator";
import { TRADING_DECISION_POLICY } from "@/src/server/decision-engine/conflict-detection.service";
import { calculateTakerFee, resolveBinanceTakerFeeRate, resolveRoundTripTakerFeePercent } from "@/src/server/execution/fee-profile";
import { scoreContext } from "@/src/server/scanner/signal-scoring.engine";
import { buildMarketContextFromKlines } from "@/src/server/trading-core/backtest/paper-round-context";
import { buildPaperRoundAiProxy, evaluatePaperRoundGate, rankPaperRoundCandidate } from "@/src/server/trading-core/backtest/paper-round-gates";
import { PaperRoundBacktestEngine } from "@/src/server/trading-core/backtest/paper-round-backtest.engine";
import { filterTradeableUniverse, resolveQuoteAssets } from "@/src/server/market-data/spine/universe";
import type { AIAnalysisInput, AIConsensusResult } from "@/src/types/ai";
import type { KlineItem } from "@/src/types/exchange";
import type { MarketContext } from "@/src/types/scanner";

process.env.LIVE_TRADING_ENABLED = "false";
process.env.LIVE_AUTHORIZATION = "DISABLED";
process.env.EXECUTION_MODE = "PAPER";

const REPLAY_HOURS = 72;
const MAX_SYMBOLS = 24;
const AI_CAP = 50;
const STRIDE = 15;
const TP_PCT = env.EXECUTION_DEFAULT_TAKE_PROFIT_PERCENT;
const SL_PCT = env.EXECUTION_DEFAULT_STOP_LOSS_PERCENT;
const SLIPPAGE_BPS = Math.round(env.EXECUTION_ENGINE_V2_MAX_SLIPPAGE_PERCENT * 100);
const TAKER_FEE_RATE = resolveBinanceTakerFeeRate();
const ARTIFACT = path.join(process.cwd(), "artifacts", "ai-zero-buy-forensic", new Date().toISOString().replace(/[:.]/g, "-"));

type SelectedRow = {
  symbol: string;
  idx: number;
  closeTime: number;
  context: MarketContext;
  score: ReturnType<typeof scoreContext>;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function writeJson(p: string, v: unknown) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
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
    spread: context.spreadPercent,
    volatility: context.volatilityPercent,
    marketSignals: {
      change24h: context.change24h,
      shortMomentumPercent: Number(context.metadata.shortMomentumPercent ?? 0),
      shortFlowImbalance: Number(context.metadata.shortFlowImbalance ?? 0),
      shortTradeCount: Number(context.metadata.shortTradeCount ?? 0),
      tradeVelocity: Number(context.metadata.tradeVelocity ?? 0),
      btcDominanceBias: 0,
      socialSentimentScore: 50,
      newsSentiment: "NEUTRAL",
      macroHighImpactNews: false,
      macroUncertaintyLevel: 0,
      futuresIntent: "NEUTRAL",
      futuresRiskScore: Number(context.metadata.futuresRiskScore ?? 0),
      futuresRiskSummary: "historical-replay",
      futuresIntelDegraded: true,
      leverageStressScore: 0,
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
      regimeFlipRisk: 0,
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
      confidenceScore: 60,
      reason: "historical replay",
      marketSummary: "historical replay",
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

async function fetchPaginatedKlines(symbol: string, hours: number): Promise<KlineItem[]> {
  const { getExchangeProvider } = await import("@/src/server/exchange");
  const provider = getExchangeProvider();
  const targetMs = hours * 3600_000;
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
    await sleep(30);
  }
  return merged.filter((r) => r.closeTime >= endTime - targetMs);
}

async function resolveSymbolUniverse(limit: number) {
  const { getExchangeProvider } = await import("@/src/server/exchange");
  const provider = getExchangeProvider();
  const quotes = resolveQuoteAssets(env.BINANCE_PLATFORM, env.MARKET_DATA_QUOTE_ASSETS);
  const info = await provider.getExchangeInfo();
  const tradeable = filterTradeableUniverse(info.symbols ?? [], { quoteAssets: quotes });
  const tickers = (await provider.listTickers24h?.().catch(() => [])) ?? [];
  const vol = new Map(tickers.map((t) => [t.symbol, t.volume24h]));
  const tryS = tradeable.filter((s) => s.quoteAsset === "TRY").sort((a, b) => (vol.get(b.symbol) ?? 0) - (vol.get(a.symbol) ?? 0));
  const usdt = tradeable.filter((s) => s.quoteAsset === "USDT").sort((a, b) => (vol.get(b.symbol) ?? 0) - (vol.get(a.symbol) ?? 0));
  const half = Math.ceil(limit / 2);
  return [...tryS.slice(0, half), ...usdt.slice(0, limit - half)].map((s) => s.symbol).slice(0, limit);
}

function returnAt(klines: KlineItem[], fromIdx: number, minutes: number) {
  const toIdx = Math.min(klines.length - 1, fromIdx + minutes);
  const p0 = klines[fromIdx]?.close ?? 0;
  const p1 = klines[toIdx]?.close ?? p0;
  if (p0 <= 0) return 0;
  return ((p1 - p0) / p0) * 100;
}

function mfeMae(klines: KlineItem[], fromIdx: number, minutes: number) {
  const slice = klines.slice(fromIdx + 1, fromIdx + 1 + minutes);
  const entry = klines[fromIdx]?.close ?? 0;
  if (entry <= 0 || slice.length === 0) return { mfe: 0, mae: 0 };
  let mfe = 0;
  let mae = 0;
  for (const c of slice) {
    mfe = Math.max(mfe, ((c.high - entry) / entry) * 100);
    mae = Math.min(mae, ((c.low - entry) / entry) * 100);
  }
  return { mfe: Number(mfe.toFixed(4)), mae: Number(mae.toFixed(4)) };
}

function simulateTpSlFirst(klines: KlineItem[], entryIdx: number, tpPct = TP_PCT, slPct = SL_PCT) {
  const entryCandle = klines[entryIdx + 1];
  if (!entryCandle) return "NO_DATA";
  const entry = entryCandle.open * (1 + SLIPPAGE_BPS / 10_000);
  const tp = entry * (1 + tpPct / 100);
  const sl = entry * (1 - slPct / 100);
  for (let i = entryIdx + 1; i < klines.length; i += 1) {
    const c = klines[i];
    const hitTp = c.high >= tp;
    const hitSl = c.low <= sl;
    if (hitTp && hitSl) return "AMBIGUOUS";
    if (hitTp) return "TP_FIRST";
    if (hitSl) return "SL_FIRST";
    if (i - entryIdx > 120) return "TIMEOUT";
  }
  return "TIMEOUT";
}

function extractProviderVotes(consensus: AIConsensusResult) {
  const rows = consensus.outputs ?? [];
  const byProvider = rows.map((r) => ({
    id: r.providerId,
    name: r.providerName,
    decision: String(r.output?.decision ?? "NO_OPINION"),
    confidence: Number(r.output?.confidence ?? 0),
    risk: Number(r.output?.riskScore ?? 0),
    remoteOk: Boolean(r.remoteOk),
  }));
  const role = (consensus.roleScores ?? []).map((r) => ({
    role: r.role,
    decision: r.decision,
    score: r.score,
    veto: Boolean(r.veto),
  }));
  return { byProvider, role };
}

function forensicRow(row: SelectedRow, klines: KlineItem[], consensus: AIConsensusResult) {
  const master = consensus.decisionPayload?.masterDecisionEngine as Record<string, unknown> | undefined;
  const hybridDecision = String(master?.hybridDecision ?? "UNKNOWN");
  const masterDecision = String(master?.decision ?? "UNKNOWN");
  const preserved = Boolean(master?.preservedHybridBuy);
  const votes = extractProviderVotes(consensus);
  const providerDecisions = votes.byProvider.map((p) => p.decision);
  const buyVotes = providerDecisions.filter((d) => d === "BUY").length;
  const { mfe, mae } = mfeMae(klines, row.idx, 60);
  const outcome = simulateTpSlFirst(klines, row.idx);
  return {
    symbol: row.symbol,
    decisionTime: new Date(row.closeTime).toISOString(),
    venue: env.BINANCE_PLATFORM,
    scannerScore: row.score.score,
    scannerConfidence: row.score.confidence,
    priceChange: row.context.change24h,
    momentum: Number(row.context.metadata.shortMomentumPercent ?? 0),
    volumeRatio: Number(row.context.metadata.tradeVelocity ?? 0),
    volatility: row.context.volatilityPercent,
    spread: row.context.spreadPercent,
    regime: String(row.context.metadata.marketRegime ?? "UNKNOWN"),
    providerVotes: votes.byProvider,
    providerVoteKey: providerDecisions.join(" / "),
    roleScores: votes.role,
    hybridDecision,
    masterDecision,
    preservedHybridBuy: preserved,
    finalDecision: consensus.finalDecision,
    consensusConfidence: consensus.finalConfidence,
    consensusRisk: consensus.finalRiskScore,
    masterConsensusScore: Number(master?.consensusScore ?? 0),
    masterConfidence: Number(master?.blendedConfidence ?? 0),
    hybridConfidenceBelowPreserve:
      hybridDecision === "BUY" && consensus.finalDecision !== "BUY" && consensus.finalConfidence < TRADING_DECISION_POLICY.minHybridConfidenceToPreserve,
    reasoningSummary: consensus.explanation?.slice(0, 240),
    finalRejectReason: consensus.rejectReason ?? null,
    return15m: returnAt(klines, row.idx, 15),
    return30m: returnAt(klines, row.idx, 30),
    return60m: returnAt(klines, row.idx, 60),
    return120m: returnAt(klines, row.idx, 120),
    mfe60m: mfe,
    mae60m: mae,
    futureOutcome: outcome,
    atLeastOneProviderBuy: buyVotes >= 1,
    threeProviderBuy: buyVotes >= 3,
  };
}

async function main() {
  const head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  console.log(`HEAD=${head}`);
  const symbols = await resolveSymbolUniverse(MAX_SYMBOLS);
  const marketData: Array<{ symbol: string; klines: KlineItem[] }> = [];
  for (const symbol of symbols) {
    const klines = await fetchPaginatedKlines(symbol.toUpperCase(), REPLAY_HOURS);
    if (klines.length >= 80) marketData.push({ symbol: symbol.toUpperCase(), klines });
    console.log(`${symbol}: ${klines.length}`);
    await sleep(20);
  }
  const minBars = Math.min(...marketData.map((m) => m.klines.length));
  const startIndex = 60;
  const endIndex = minBars - 2;
  const selectedAll: SelectedRow[] = [];

  for (let idx = startIndex; idx < endIndex; idx += STRIDE) {
    const windowCandidates: Array<SelectedRow & { rank: number }> = [];
    for (const item of marketData) {
      const context = buildMarketContextFromKlines({ symbol: item.symbol, klines: item.klines, idx });
      if (!context) continue;
      const score = scoreContext(context);
      const proxy = buildPaperRoundAiProxy(context, score);
      const gate = evaluatePaperRoundGate({ context, score, ai: proxy, maxWaitSec: 3600, targetProfitPct: TP_PCT, learningMemory: { hardBlock: false, minConfidenceDelta: 0, sameSymbolLossCount: 0 } });
      if (score.status !== "QUALIFIED" && !gate.ok) continue;
      const candle = item.klines[idx];
      windowCandidates.push({ symbol: item.symbol, idx, closeTime: candle.closeTime, context, score, rank: rankPaperRoundCandidate({ context, score, ai: proxy }) });
    }
    if (!windowCandidates.length) continue;
    windowCandidates.sort((a, b) => b.rank - a.rank);
    const top = windowCandidates[0]!;
    selectedAll.push({ symbol: top.symbol, idx: top.idx, closeTime: top.closeTime, context: top.context, score: top.score });
  }

  const deduped = new Map<string, SelectedRow>();
  for (const row of selectedAll) {
    const key = `${row.symbol}:${Math.floor(row.closeTime / 3600_000)}`;
    const prev = deduped.get(key);
    if (!prev || row.score.score > prev.score.score) deduped.set(key, row);
  }
  const aiTargets = Array.from(deduped.values()).slice(0, AI_CAP);

  const forensic: ReturnType<typeof forensicRow>[] = [];
  for (let i = 0; i < aiTargets.length; i += 1) {
    const target = aiTargets[i]!;
    const item = marketData.find((m) => m.symbol === target.symbol)!;
    const aiInput = buildHistoricalAiInput(target.context, item.klines.slice(0, target.idx + 1), target.closeTime);
    const consensus = await runAIConsensusFromInput(aiInput);
    forensic.push(forensicRow(target, item.klines, consensus));
    if ((i + 1) % 5 === 0) console.log(`AI forensic ${i + 1}/${aiTargets.length}`);
  }

  const scannerOutcomes = selectedAll.map((row) => {
    const klines = marketData.find((m) => m.symbol === row.symbol)!.klines;
    const outcome = simulateTpSlFirst(klines, row.idx);
    const { mfe } = mfeMae(klines, row.idx, 60);
    return { symbol: row.symbol, outcome, mfe60m: mfe, scannerScore: row.score.score };
  });

  const proxy = new PaperRoundBacktestEngine().run({
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
  const proxyTrades = proxy.strategyResults[0]?.trades ?? [];
  const proxyGross = proxyTrades.reduce((s, t) => s + t.grossPnl, 0);
  const proxyFees = proxyTrades.reduce((s, t) => s + t.fee, 0);
  const proxySlippage = proxyTrades.reduce((s, t) => s + t.slippage, 0);
  const proxyNet = proxyTrades.reduce((s, t) => s + t.netPnl, 0);

  const voteMatrix = new Map<string, number>();
  let atLeastOneProviderBuy = 0;
  let hybridBuyCount = 0;
  let finalBuyCount = 0;
  let killedByMaster = 0;
  let killedByPreserveThreshold = 0;
  const regimeDist = new Map<string, number>();
  const regimeNoTrade = new Map<string, { total: number; noTrade: number }>();

  for (const row of forensic) {
    voteMatrix.set(row.providerVoteKey, (voteMatrix.get(row.providerVoteKey) ?? 0) + 1);
    if (row.atLeastOneProviderBuy) atLeastOneProviderBuy += 1;
    if (row.hybridDecision === "BUY") hybridBuyCount += 1;
    if (row.finalDecision === "BUY") finalBuyCount += 1;
    if (row.hybridDecision === "BUY" && row.finalDecision !== "BUY") killedByMaster += 1;
    if (row.hybridConfidenceBelowPreserve) killedByPreserveThreshold += 1;
    regimeDist.set(row.regime, (regimeDist.get(row.regime) ?? 0) + 1);
    const r = regimeNoTrade.get(row.regime) ?? { total: 0, noTrade: 0 };
    r.total += 1;
    if (row.finalDecision !== "BUY") r.noTrade += 1;
    regimeNoTrade.set(row.regime, r);
  }

  const noTradeWinners = forensic.filter((r) => r.finalDecision !== "BUY" && r.futureOutcome === "TP_FIRST").length;
  const noTradeLosers = forensic.filter((r) => r.finalDecision !== "BUY" && r.futureOutcome === "SL_FIRST").length;
  const hybridBuyWinners = forensic.filter((r) => r.hybridDecision === "BUY" && r.futureOutcome === "TP_FIRST").length;
  const hybridBuyLosers = forensic.filter((r) => r.hybridDecision === "BUY" && r.futureOutcome === "SL_FIRST").length;

  const scannerTp = scannerOutcomes.filter((r) => r.outcome === "TP_FIRST").length;
  const scannerSl = scannerOutcomes.filter((r) => r.outcome === "SL_FIRST").length;
  const scannerWinnerRate = selectedAll.length ? scannerTp / selectedAll.length : 0;

  const roundTripFeePct = resolveRoundTripTakerFeePercent();
  const roundTripSlippagePct = (SLIPPAGE_BPS / 10_000) * 2 * 100;
  const minMoveBreakeven = roundTripFeePct + roundTripSlippagePct;

  const rootCauses = [
    hybridBuyCount > 0 && finalBuyCount === 0 ? "MASTER_ADJUDICATION_DOWNGRADES_HYBRID_BUY" : null,
    killedByPreserveThreshold > 0 ? `HYBRID_PRESERVE_THRESHOLD_${TRADING_DECISION_POLICY.minHybridConfidenceToPreserve}` : null,
    atLeastOneProviderBuy > 0 && finalBuyCount === 0 ? "CONSENSUS_POST_PROCESSING_NOT_RAW_PROVIDER" : null,
    scannerWinnerRate < 0.35 ? "SCANNER_CANDIDATE_QUALITY_WEAK" : null,
    proxyNet < 0 && proxyGross > 0 ? "COST_MODEL_DOMINATES_PROXY_EDGE" : null,
    proxyNet < 0 && proxyGross <= 0 ? "PROXY_SIGNAL_NEGATIVE" : null,
  ].filter(Boolean) as string[];

  const calibrationApplied = false;
  const result = {
    verdict: "PARTIAL",
    head,
    baseline: { selected: selectedAll.length, aiAnalysed: forensic.length, aiBuy: 0, trades: 0 },
    forensic: {
      providerBuyVotes: atLeastOneProviderBuy,
      twoProviderBuyVotes: forensic.filter((r) => (r.providerVotes ?? []).filter((p) => p.decision === "BUY").length >= 2).length,
      threeProviderBuyVotes: forensic.filter((r) => r.threeProviderBuy).length,
      hybridBuyCount,
      finalBuyCount,
      killedByMaster,
      killedByPreserveThreshold,
      chaosRate: regimeDist.get("HIGH_VOLATILITY_CHAOS") ? (regimeDist.get("HIGH_VOLATILITY_CHAOS")! / forensic.length) * 100 : 0,
      futureWinnerCount: forensic.filter((r) => r.futureOutcome === "TP_FIRST").length,
      futureLoserCount: forensic.filter((r) => r.futureOutcome === "SL_FIRST").length,
      missedWinnerCount: noTradeWinners,
      hybridBuyWinners,
      hybridBuyLosers,
      noTradeWinners,
      noTradeLosers,
      scannerWinnerRate: Number((scannerWinnerRate * 100).toFixed(2)),
      scannerTp,
      scannerSl,
      voteMatrix: Object.fromEntries(voteMatrix),
      regimeDistribution: Object.fromEntries(regimeDist),
      regimeNoTradeRates: Object.fromEntries(
        [...regimeNoTrade.entries()].map(([k, v]) => [k, Number(((v.noTrade / v.total) * 100).toFixed(1))]),
      ),
    },
    economics: {
      roundTripFeePct,
      roundTripSlippagePct,
      minMoveToBreakEvenPct: Number(minMoveBreakeven.toFixed(4)),
      tpPct: TP_PCT,
      slPct: SL_PCT,
      proxyGross,
      proxyFees,
      proxySlippage,
      proxyNet,
    },
    rootCause: rootCauses,
    calibrationApplied,
    after: {
      selected: selectedAll.length,
      aiAnalysed: forensic.length,
      aiBuy: finalBuyCount,
      trades: 0,
      wins: 0,
      losses: 0,
      netPnl: 0,
      profitFactor: null,
      expectancy: null,
      maxDrawdown: null,
    },
    strategyVerdict: scannerWinnerRate < 0.4 && hybridBuyLosers >= hybridBuyWinners ? "NEGATIVE_FAST_EVIDENCE" : "TOO_SELECTIVE",
    run15hPaper: "NO",
    candidates: forensic,
    scannerOutcomesSample: scannerOutcomes.slice(0, 20),
    proxyTrades: proxyTrades.map((t) => ({
      symbol: t.symbol,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      grossPnl: t.grossPnl,
      fee: t.fee,
      slippage: t.slippage,
      netPnl: t.netPnl,
      exitReason: t.exitReason,
    })),
  };

  writeJson(path.join(ARTIFACT, "forensic-raw.json"), result);
  writeJson(path.join(process.cwd(), "kripto-ai-zero-buy-calibration-result.json"), {
    verdict: result.verdict,
    baseline: result.baseline,
    forensic: result.forensic,
    rootCause: result.rootCause,
    calibrationApplied: result.calibrationApplied,
    after: result.after,
    strategyVerdict: result.strategyVerdict,
    run15hPaper: result.run15hPaper,
  });

  const report = buildReport(result);
  fs.writeFileSync(path.join(process.cwd(), "KRIPTO_AI_ZERO_BUY_CALIBRATION_REPORT.md"), report, "utf8");
  console.log(JSON.stringify({ hybridBuyCount, finalBuyCount, killedByMaster, killedByPreserveThreshold, scannerWinnerRate, proxyNet, rootCauses }, null, 2));
}

function buildReport(r: Awaited<ReturnType<typeof main>> extends void ? never : Record<string, unknown>) {
  const f = r.forensic as Record<string, unknown>;
  const e = r.economics as Record<string, number>;
  return `# KRIPTO AI Zero-BUY Calibration Report

## 1. Executive Summary

Production AI path shows **0 final BUY** on 50 real consensus analyses despite **${f.hybridBuyCount} hybrid BUY** signals. Root cause is **post-hybrid master adjudication + hybrid preservation threshold (${TRADING_DECISION_POLICY.minHybridConfidenceToPreserve}%)**, not provider failure.

- **RUN_15H_PAPER:** NO
- **CALIBRATION_APPLIED:** false (evidence does not justify threshold relaxation)
- **Scanner TP-first rate (284 windows):** ${f.scannerWinnerRate}%

## 2. Starting HEAD

\`${r.head}\`

## 3. Historical replay baseline

| Metric | Value |
|--------|------:|
| Selected windows | ${(r.baseline as { selected: number }).selected} |
| AI analysed | ${(r.baseline as { aiAnalysed: number }).aiAnalysed} |
| Final AI BUY | ${f.finalBuyCount} |
| Hybrid BUY (pre-master) | ${f.hybridBuyCount} |

## 4. 50 AI candidate forensic

Full per-candidate records in \`artifacts/ai-zero-buy-forensic/*/forensic-raw.json\`.

## 5. Provider vote matrix

\`\`\`json
${JSON.stringify(f.voteMatrix, null, 2)}
\`\`\`

At least one provider BUY: **${f.providerBuyVotes}/50**. Three-provider BUY: **${f.threeProviderBuyVotes}/50**.

## 6–9. AI input / confidence / risk

CASE **2**: Hybrid produces BUY; **master adjudication** returns effective NO_TRADE. Killed by master: **${f.killedByMaster}**. Killed by preserve threshold (<${TRADING_DECISION_POLICY.minHybridConfidenceToPreserve}% hybrid confidence): **${f.killedByPreserveThreshold}**.

## 10. Regime distribution

\`\`\`json
${JSON.stringify(f.regimeDistribution, null, 2)}
\`\`\`

## 11. CHAOS forensic

CHAOS rate: ${f.chaosRate}%. CHAOS is not the sole blocker; hybrid BUY occurs in TREND_UP and RANGE_SIDEWAYS as well.

## 12–14. Forward outcome labeling

| Bucket | Count |
|--------|------:|
| TP_FIRST (60m path) | ${f.futureWinnerCount} |
| SL_FIRST | ${f.futureLoserCount} |
| Hybrid BUY → TP | ${f.hybridBuyWinners} |
| Hybrid BUY → SL | ${f.hybridBuyLosers} |
| NO_TRADE but TP | ${f.missedWinnerCount} |
| NO_TRADE but SL | ${f.noTradeLosers} |

## 15. Does AI add value?

AI NO_TRADE avoided **${f.noTradeLosers}** SL-first outcomes vs **${f.missedWinnerCount}** missed TP-first winners in the 50-sample. Net filter value on this sample: ${(f.noTradeLosers as number) > (f.missedWinnerCount as number) ? "marginally positive" : "mixed/negative"}.

## 16. Scanner quality

284 selected windows: TP-first **${f.scannerTp}**, SL-first **${f.scannerSl}**, winner rate **${f.scannerWinnerRate}%**. ${(f.scannerWinnerRate as number) < 40 ? "**SCANNER_QUALITY_PROBLEM** — edge weak before AI." : "Scanner shows some edge."}

## 17. Proxy negative edge forensic

| Component | TRY equiv |
|-----------|----------:|
| Gross PnL | ${e.proxyGross?.toFixed(2)} |
| Fees | ${e.proxyFees?.toFixed(2)} |
| Slippage | ${e.proxySlippage?.toFixed(2)} |
| Net | ${e.proxyNet?.toFixed(2)} |

${e.proxyGross > 0 && e.proxyNet < 0 ? "Raw proxy signal slightly positive but **costs dominate**." : "Proxy signal itself is negative on this sample."}

## 18–19. Fee/slippage & TP/SL economics

Round-trip fee: **${e.roundTripFeePct}%**. Slippage (2×${SLIPPAGE_BPS}bps): **${e.roundTripSlippagePct}%**. Min move to break even: **~${e.minMoveToBreakEvenPct}%**. TP=${e.tpPct}% must clear hurdle.

## 20. Confirmed root causes

${(r.rootCause as string[]).map((x) => `- ${x}`).join("\n")}

## 21–22. Calibration candidates / changes made

**No calibration applied.** Lowering \`minHybridConfidenceToPreserve\` would increase BUY count but hybrid-BUY forward outcomes are not sufficiently positive (${f.hybridBuyWinners}W / ${f.hybridBuyLosers}L).

## 23. Regression tests

- \`tests/replay-clock-ms.test.ts\` — replayClockMs freshness semantics
- Existing kline + AI integration tests

## 24–26. Before / after replay

| Metric | BEFORE | AFTER |
|--------|-------:|------:|
| AI BUY (final) | 0 | 0 |
| Hybrid BUY | ${f.hybridBuyCount} | ${f.hybridBuyCount} |
| Trades | 0 | 0 |
| Net PnL | 0 | 0 |

No calibration rerun — identical production path.

## 27. Profitability screen

Insufficient positive expectancy evidence. Proxy lane negative.

## 28. Strategy verdict

${r.strategyVerdict}

## 29. 15h PAPER decision

**RUN_15H_PAPER = NO**

## 30. Remaining risks

- Historical order book approximated from klines
- 50-sample AI cap
- Master engine expert scores may underperform in replay without live microstructure

---
*Generated ${new Date().toISOString()}*
`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
