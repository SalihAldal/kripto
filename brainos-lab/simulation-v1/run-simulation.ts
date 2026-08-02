/**
 * BrainOS Simulation Lab runner — standalone, self-contained workspace executor.
 * Does not modify application trading logic; imports read-only risk rule evaluation.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  boundMinConfidenceThreshold,
  evaluateRiskRules,
  RISK_GATE_POLICY,
} from "../../src/server/risk/risk-evaluation.service";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const CHECKPOINT_DIR = path.join(ROOT, "checkpoints");
const LOGS_DIR = path.join(ROOT, "logs");
const TARGET_TRADES = 100;

const SYMBOLS = ["BTCTRY", "ETHTRY", "SOLTRY", "AVAXTRY", "XRPTRY", "ADATRY", "LINKTRY", "DOGETRY"];
const STRATEGIES = ["momentum_scalp", "mean_reversion", "breakout_follow", "trend_pullback"];
const REGIMES = ["trending", "ranging", "volatile", "low_liquidity"] as const;
const MARKETS = ["SPOT_TRY", "SPOT_USDT"];

type Regime = (typeof REGIMES)[number];

type TradeRecord = Record<string, unknown>;

type SummaryState = {
  simulationId: string;
  workspace: string;
  targetTrades: number;
  completedTrades: number;
  accepted: number;
  rejected: number;
  wins: number;
  losses: number;
  totalPnlUsdt: number;
  startedAt: string;
  updatedAt: string;
  status: "running" | "completed";
};

type MetricsState = {
  winRate: number;
  profitFactor: number;
  expectancy: number;
  sharpeRatio: number;
  averageConfidence: number;
  averageHoldingTimeSec: number;
  averageRiskScore: number;
  acceptanceRate: number;
  topRejectionReasons: Array<{ reason: string; count: number }>;
  cumulativeMissedProfitUsdt: number;
};

function ensureDirs() {
  for (const dir of [CHECKPOINT_DIR, LOGS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function flush(filePath: string, data: string | object) {
  const payload = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, payload, "utf8");
}

function appendLine(filePath: string, line: string) {
  fs.appendFileSync(filePath, line + "\n", "utf8");
}

function readJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function initWorkspace() {
  const files: Array<[string, string | object]> = [
    [path.join(ROOT, "simulation-lab.md"), "# BrainOS Simulation Lab — simulation-v1\n\n"],
    [path.join(ROOT, "trades.jsonl"), ""],
    [
      path.join(ROOT, "summary.json"),
      {
        simulationId: "simulation-v1",
        workspace: "brainos-lab/simulation-v1",
        targetTrades: TARGET_TRADES,
        completedTrades: 0,
        accepted: 0,
        rejected: 0,
        wins: 0,
        losses: 0,
        totalPnlUsdt: 0,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "running",
      } satisfies SummaryState,
    ],
    [
      path.join(ROOT, "metrics.json"),
      {
        winRate: 0,
        profitFactor: 0,
        expectancy: 0,
        sharpeRatio: 0,
        averageConfidence: 0,
        averageHoldingTimeSec: 0,
        averageRiskScore: 0,
        acceptanceRate: 0,
        topRejectionReasons: [],
        cumulativeMissedProfitUsdt: 0,
      } satisfies MetricsState,
    ],
    [path.join(ROOT, "accepted-trades.json"), []],
    [path.join(ROOT, "rejected-trades.json"), []],
  ];
  for (const [fp, content] of files) {
    if (!fs.existsSync(fp)) flush(fp, content);
  }
}

function loadCheckpoint(): { nextTrade: number; summary: SummaryState; accepted: TradeRecord[]; rejected: TradeRecord[] } {
  const latest = path.join(CHECKPOINT_DIR, "latest.json");
  const summary = readJson<SummaryState>(path.join(ROOT, "summary.json"), {
    simulationId: "simulation-v1",
    workspace: "brainos-lab/simulation-v1",
    targetTrades: TARGET_TRADES,
    completedTrades: 0,
    accepted: 0,
    rejected: 0,
    wins: 0,
    losses: 0,
    totalPnlUsdt: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "running",
  });
  const cp = readJson<{ nextTradeNumber: number } | null>(latest, null);
  const nextTrade = cp?.nextTradeNumber ?? summary.completedTrades + 1;
  return {
    nextTrade: Math.max(1, nextTrade),
    summary,
    accepted: readJson<TradeRecord[]>(path.join(ROOT, "accepted-trades.json"), []),
    rejected: readJson<TradeRecord[]>(path.join(ROOT, "rejected-trades.json"), []),
  };
}

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

function round(n: number, d = 4) {
  return Number(n.toFixed(d));
}

function effectiveConfig() {
  const minConfidenceThreshold = boundMinConfidenceThreshold(72);
  return {
    maxRiskPerTrade: 1,
    maxDailyLossPercent: 5,
    maxWeeklyLossPercent: 7,
    dailyLossReferenceTry: 100000,
    weeklyLossReferenceTry: 100000,
    maxOpenPositions: 3,
    minConfidenceThreshold,
    maxSpreadThreshold: 0.25,
    minLiquidityThreshold: 5_000_000,
    minExpectedProfitThreshold: 0.2,
    maxSlippageThreshold: 0.45,
    cooldownMinutes: 30,
    consecutiveLossBreaker: 3,
    apiFailureBreaker: 4,
    abnormalVolatilityThreshold: 3.2,
    emergencyBrakeEnabled: true,
    stopLossRequired: true,
  };
}

function simulateConsensus(rand: () => number, confidence: number) {
  const votes = [
    rand() > 0.35 ? "BUY" : "HOLD",
    rand() > 0.4 ? "BUY" : "HOLD",
    rand() > 0.45 ? "BUY" : "HOLD",
  ];
  const buyVotes = votes.filter((v) => v === "BUY").length;
  const passed = buyVotes >= 2 && confidence >= 58;
  return {
    result: passed ? "BUY" : "NO_TRADE",
    votes,
    buyVotes,
    minDirectionalVoteHardBlock: false,
  };
}

function buildTrade(tradeNumber: number, rand: () => number, consecutiveLosses: number): TradeRecord {
  const symbol = pick(rand, SYMBOLS);
  const strategy = pick(rand, STRATEGIES);
  const regime = pick(rand, [...REGIMES]) as Regime;
  const market = pick(rand, MARKETS);
  const timestamp = new Date(Date.now() - (TARGET_TRADES - tradeNumber) * 90_000).toISOString();
  const signal = rand() > 0.12 ? "BUY" : "SELL";
  const signalScore = round(45 + rand() * 50, 2);
  const confidence = round(52 + rand() * 42, 2);
  const rankingScore = round(40 + rand() * 55, 2);
  const riskScore = round(18 + rand() * 62, 2);
  const spreadPercent = round(regime === "low_liquidity" ? 0.15 + rand() * 0.5 : 0.04 + rand() * 0.2, 3);
  const liquidity24h = round(
    regime === "low_liquidity" ? 200_000 + rand() * 2_000_000 : 6_000_000 + rand() * 40_000_000,
    0,
  );
  const volatilityPercent = round(regime === "volatile" ? 2.5 + rand() * 3 : 0.8 + rand() * 2.2, 2);
  const expectedProfitPercent = round(0.15 + rand() * 1.2, 3);
  const slippagePercent = round(0.08 + rand() * 0.35, 3);
  const riskPerTradePercent = round(0.4 + rand() * 1.1, 3);
  const entryPrice = round(symbol.startsWith("BTC") ? 2_800_000 + rand() * 200_000 : 80 + rand() * 4000, 2);
  const stopLoss = round(entryPrice * (1 - (0.006 + rand() * 0.012)), 2);
  const takeProfit = round(entryPrice * (1 + (0.008 + rand() * 0.025)), 2);
  const positionSize = round(150 + rand() * 850, 2);
  const rankingThreshold = 55;
  const confidenceThreshold = effectiveConfig().minConfidenceThreshold;
  const liquidityPass = liquidity24h >= effectiveConfig().minLiquidityThreshold;
  const rankingPass = rankingScore >= rankingThreshold;
  const consensus = simulateConsensus(rand, confidence);
  const exchangeRestricted = rand() < 0.02;

  const riskReasons = evaluateRiskRules({
    config: effectiveConfig(),
    metrics: {
      confidencePercent: confidence,
      spreadPercent,
      liquidity24h,
      expectedProfitPercent,
      slippagePercent,
      volatilityPercent,
      riskPerTradePercent,
      stopLossConfigured: true,
    },
    state: {
      paused: false,
      openPositionCount: Math.floor(rand() * 2),
      dailyLossAbs: round(rand() * 8, 2),
      dailyLossPercent: round(rand() * 1.2, 3),
      weeklyLossAbs: round(rand() * 15, 2),
      weeklyLossPercent: round(rand() * 2.5, 3),
      consecutiveLosses,
      apiFailureCount: 0,
    },
  });

  const rejectionParts: string[] = [];
  if (exchangeRestricted) rejectionParts.push("Exchange restriction: symbol temporarily blocked");
  if (!rankingPass) rejectionParts.push(`Ranking below threshold (${rankingScore} < ${rankingThreshold})`);
  if (!liquidityPass) rejectionParts.push(`Liquidity below threshold (${liquidity24h} < ${effectiveConfig().minLiquidityThreshold})`);
  if (consensus.result === "NO_TRADE") rejectionParts.push("AI consensus NO_TRADE");
  rejectionParts.push(...riskReasons);

  const accepted = rejectionParts.length === 0 && signal === "BUY";
  const rejectionReason = accepted ? null : rejectionParts[0] ?? "Signal not actionable";

  let exitPrice = entryPrice;
  let exitReason = accepted ? "SIMULATED_HOLD" : "N/A";
  let pnlPct = 0;
  let pnlUsdt = 0;
  let durationSec = 0;

  if (accepted) {
    durationSec = Math.floor(120 + rand() * 5400);
    const outcomeRand = rand();
    if (outcomeRand > 0.42) {
      exitPrice = round(takeProfit - rand() * (takeProfit - entryPrice) * 0.35, 2);
      exitReason = "TAKE_PROFIT";
      pnlPct = round(((exitPrice - entryPrice) / entryPrice) * 100, 3);
    } else if (outcomeRand > 0.18) {
      exitPrice = round(entryPrice + (rand() - 0.45) * entryPrice * 0.01, 2);
      exitReason = "TIMEOUT";
      pnlPct = round(((exitPrice - entryPrice) / entryPrice) * 100, 3);
    } else {
      exitPrice = round(stopLoss + rand() * (entryPrice - stopLoss) * 0.4, 2);
      exitReason = "STOP_LOSS";
      pnlPct = round(((exitPrice - entryPrice) / entryPrice) * 100, 3);
    }
    pnlUsdt = round((positionSize * pnlPct) / 100, 4);
  }

  const missedProfitUsdt = !accepted ? round(Math.max(0, (expectedProfitPercent / 100) * positionSize * (rand() > 0.35 ? 1 : 0)), 4) : 0;
  const wouldHaveBeenProfitable = !accepted && missedProfitUsdt > 0.5;

  let rootCause = accepted ? (pnlPct >= 0 ? "Signal quality aligned with regime" : "Adverse move after valid entry") : rejectionReason ?? "Gate rejection";
  if (!accepted && rejectionReason?.includes("Confidence")) rootCause = "Confidence threshold gate";
  if (!accepted && rejectionReason?.includes("Ranking")) rootCause = "Ranking score gate";
  if (!accepted && rejectionReason?.includes("consensus")) rootCause = "AI consensus disagreement";
  if (!accepted && rejectionReason?.includes("Liquidity")) rootCause = "Liquidity gate";

  const lessons = accepted
    ? pnlPct >= 0
      ? "Maintain current gate ordering; pattern validated under simulated regime."
      : "Review stop placement for this strategy/regime combination."
    : wouldHaveBeenProfitable
      ? "Potential false negative — validate gate threshold against missed profit estimate."
      : "Rejection prevented low-quality entry; gate behavior consistent with policy.";

  return {
    tradeNumber,
    timestamp,
    market,
    symbol,
    strategy,
    marketRegime: regime,
    signal,
    signalScore,
    confidence,
    rankingScore,
    riskScore,
    positionSize,
    entryPrice,
    stopLoss,
    takeProfit,
    exitPrice,
    exitReason,
    pnlPercent: pnlPct,
    pnlUsdt,
    tradeDurationSec: durationSec,
    accepted,
    rejectionReason,
    confidenceThreshold,
    rankingResult: rankingPass ? "PASS" : "FAIL",
    riskRule: riskReasons[0] ?? "PASS",
    liquidityResult: liquidityPass ? "PASS" : "FAIL",
    aiConsensusResult: consensus.result,
    exchangeRestriction: exchangeRestricted ? "BLOCKED" : "NONE",
    engineeringAnalysis: accepted
      ? `Executed ${strategy} in ${regime} regime with confidence ${confidence}% vs threshold ${confidenceThreshold}%.`
      : `Rejected due to: ${rejectionReason}. Consecutive-loss telemetry (${consecutiveLosses}) did not block (policy: consecutiveLossBlocksEntry=${RISK_GATE_POLICY.consecutiveLossBlocksEntry}).`,
    estimatedMissedProfitUsdt: missedProfitUsdt,
    wouldAcceptanceHaveBeenProfitable: wouldHaveBeenProfitable,
    rootCause,
    lessonsLearned: lessons,
    gatePolicy: RISK_GATE_POLICY,
  };
}

function computeMetrics(accepted: TradeRecord[], rejected: TradeRecord[]): MetricsState {
  const completed = accepted.length + rejected.length;
  const wins = accepted.filter((t) => Number(t.pnlUsdt) > 0).length;
  const losses = accepted.filter((t) => Number(t.pnlUsdt) <= 0 && t.accepted).length;
  const winRate = accepted.length ? round((wins / accepted.length) * 100, 2) : 0;
  const grossProfit = accepted.filter((t) => Number(t.pnlUsdt) > 0).reduce((s, t) => s + Number(t.pnlUsdt), 0);
  const grossLoss = Math.abs(accepted.filter((t) => Number(t.pnlUsdt) < 0).reduce((s, t) => s + Number(t.pnlUsdt), 0));
  const profitFactor = grossLoss > 0 ? round(grossProfit / grossLoss, 3) : grossProfit > 0 ? 999 : 0;
  const pnls = accepted.map((t) => Number(t.pnlUsdt));
  const expectancy = accepted.length ? round(pnls.reduce((a, b) => a + b, 0) / accepted.length, 4) : 0;
  const mean = expectancy;
  const variance = accepted.length
    ? pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / accepted.length
    : 0;
  const sharpeRatio = variance > 0 ? round(mean / Math.sqrt(variance), 3) : 0;
  const avgConf = completed
    ? round(
        [...accepted, ...rejected].reduce((s, t) => s + Number(t.confidence), 0) / completed,
        2,
      )
    : 0;
  const avgHold = accepted.length
    ? round(accepted.reduce((s, t) => s + Number(t.tradeDurationSec), 0) / accepted.length, 0)
    : 0;
  const avgRisk = completed
    ? round(
        [...accepted, ...rejected].reduce((s, t) => s + Number(t.riskScore), 0) / completed,
        2,
      )
    : 0;
  const reasonCounts = new Map<string, number>();
  for (const t of rejected) {
    const r = String(t.rejectionReason ?? "Unknown");
    reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
  }
  const topRejectionReasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const cumulativeMissedProfitUsdt = round(
    rejected.reduce((s, t) => s + Number(t.estimatedMissedProfitUsdt), 0),
    4,
  );
  return {
    winRate,
    profitFactor,
    expectancy,
    sharpeRatio,
    averageConfidence: avgConf,
    averageHoldingTimeSec: avgHold,
    averageRiskScore: avgRisk,
    acceptanceRate: completed ? round((accepted.length / completed) * 100, 2) : 0,
    topRejectionReasons,
    cumulativeMissedProfitUsdt,
  };
}

function formatTradeMarkdown(trade: TradeRecord): string {
  const lines = [
    `## Trade ${trade.tradeNumber}`,
    "",
    `| Field | Value |`,
    `| --- | --- |`,
    `| Timestamp | ${trade.timestamp} |`,
    `| Market | ${trade.market} |`,
    `| Symbol | ${trade.symbol} |`,
    `| Strategy | ${trade.strategy} |`,
    `| Market Regime | ${trade.marketRegime} |`,
    `| Signal | ${trade.signal} |`,
    `| Signal Score | ${trade.signalScore} |`,
    `| Confidence | ${trade.confidence} |`,
    `| Ranking Score | ${trade.rankingScore} |`,
    `| Risk Score | ${trade.riskScore} |`,
    `| Position Size | ${trade.positionSize} |`,
    `| Entry Price | ${trade.entryPrice} |`,
    `| Stop Loss | ${trade.stopLoss} |`,
    `| Take Profit | ${trade.takeProfit} |`,
    `| Exit Price | ${trade.exitPrice} |`,
    `| Exit Reason | ${trade.exitReason} |`,
    `| PnL % | ${trade.pnlPercent} |`,
    `| PnL USDT | ${trade.pnlUsdt} |`,
    `| Trade Duration | ${trade.tradeDurationSec}s |`,
    `| Accepted / Rejected | ${trade.accepted ? "Accepted" : "Rejected"} |`,
  ];
  if (!trade.accepted) {
    lines.push(
      `| Rejection Reason | ${trade.rejectionReason} |`,
      `| Confidence Threshold | ${trade.confidenceThreshold} |`,
      `| Ranking Result | ${trade.rankingResult} |`,
      `| Risk Rule | ${trade.riskRule} |`,
      `| Liquidity Result | ${trade.liquidityResult} |`,
      `| AI Consensus Result | ${trade.aiConsensusResult} |`,
      `| Exchange Restriction | ${trade.exchangeRestriction} |`,
    );
  }
  lines.push(
    "",
    `**Engineering Analysis:** ${trade.engineeringAnalysis}`,
    "",
    `**Estimated Missed Profit:** ${trade.estimatedMissedProfitUsdt} USDT`,
    "",
    `**Would acceptance have been profitable?** ${trade.wouldAcceptanceHaveBeenProfitable ? "Yes" : "No"}`,
    "",
    `**Root Cause:** ${trade.rootCause}`,
    "",
    `**Lessons Learned:** ${trade.lessonsLearned}`,
    "",
    "---",
    "",
  );
  return lines.join("\n");
}

function batchSummary(
  batchNum: number,
  summary: SummaryState,
  metrics: MetricsState,
  accepted: TradeRecord[],
  rejected: TradeRecord[],
): string {
  const batchAccepted = accepted.filter((t) => Number(t.tradeNumber) > (batchNum - 1) * 10 && Number(t.tradeNumber) <= batchNum * 10);
  const batchRejected = rejected.filter((t) => Number(t.tradeNumber) > (batchNum - 1) * 10 && Number(t.tradeNumber) <= batchNum * 10);
  const batchWins = batchAccepted.filter((t) => Number(t.pnlUsdt) > 0).length;
  const batchWinRate = batchAccepted.length ? round((batchWins / batchAccepted.length) * 100, 2) : 0;
  const topReason = metrics.topRejectionReasons[0]?.reason ?? "N/A";
  return [
    `### Batch Summary — Trades ${(batchNum - 1) * 10 + 1}–${batchNum * 10}`,
    "",
    `- Completed Trades: ${summary.completedTrades}`,
    `- Accepted: ${summary.accepted}`,
    `- Rejected: ${summary.rejected}`,
    `- Batch Win Rate: ${batchWinRate}%`,
    `- Profit Factor: ${metrics.profitFactor}`,
    `- Expectancy: ${metrics.expectancy}`,
    `- Sharpe Ratio: ${metrics.sharpeRatio}`,
    `- Average Confidence: ${metrics.averageConfidence}`,
    `- Average Holding Time: ${metrics.averageHoldingTimeSec}s`,
    `- Average Risk Score: ${metrics.averageRiskScore}`,
    `- Top Rejection Reason: ${topReason}`,
    `- Most Successful Pattern: ${batchAccepted.sort((a, b) => Number(b.pnlUsdt) - Number(a.pnlUsdt))[0]?.strategy ?? "N/A"} in ${batchAccepted[0]?.marketRegime ?? "N/A"}`,
    `- Most Common Failure Pattern: ${batchRejected[0]?.rootCause ?? "N/A"}`,
    `- Recommended Engineering Adjustments: ${metrics.acceptanceRate < 45 ? "Review confidence cap and ranking threshold for false negatives." : "Maintain current Risk Engine policy; monitor liquidity gate hit rate."}`,
    "",
    "---",
    "",
  ].join("\n");
}

function finalReport(summary: SummaryState, metrics: MetricsState, accepted: TradeRecord[], rejected: TradeRecord[]): string {
  const byStrategy = new Map<string, { pnl: number; count: number }>();
  for (const t of accepted) {
    const k = String(t.strategy);
    const cur = byStrategy.get(k) ?? { pnl: 0, count: 0 };
    cur.pnl += Number(t.pnlUsdt);
    cur.count += 1;
    byStrategy.set(k, cur);
  }
  const strategies = [...byStrategy.entries()].sort((a, b) => b[1].pnl - a[1].pnl);
  const falseNegatives = rejected.filter((t) => t.wouldAcceptanceHaveBeenProfitable);
  const falsePositives = accepted.filter((t) => Number(t.pnlUsdt) < 0);
  return [
    "## Final Simulation Report — Trade 100 Complete",
    "",
    "### Overall Statistics",
    `- Completed Trades: ${summary.completedTrades}`,
    `- Accepted: ${summary.accepted} | Rejected: ${summary.rejected}`,
    `- Win Rate: ${metrics.winRate}%`,
    `- Profit Factor: ${metrics.profitFactor}`,
    `- Expectancy: ${metrics.expectancy} USDT`,
    `- Sharpe Ratio: ${metrics.sharpeRatio}`,
    `- Total PnL: ${round(summary.totalPnlUsdt, 4)} USDT`,
    `- Acceptance Rate: ${metrics.acceptanceRate}%`,
    `- Cumulative Missed Profit (rejected): ${metrics.cumulativeMissedProfitUsdt} USDT`,
    "",
    "### Best Strategies",
    ...strategies.slice(0, 3).map(([s, v], i) => `${i + 1}. ${s} — ${v.count} trades, ${round(v.pnl, 4)} USDT`),
    "",
    "### Worst Strategies",
    ...strategies.slice(-3).reverse().map(([s, v], i) => `${i + 1}. ${s} — ${v.count} trades, ${round(v.pnl, 4)} USDT`),
    "",
    "### False Positives",
    `- Count: ${falsePositives.length}`,
    `- Primary pattern: accepted trades with negative PnL (${falsePositives[0]?.exitReason ?? "N/A"})`,
    "",
    "### False Negatives",
    `- Count: ${falseNegatives.length}`,
    `- Estimated missed profit: ${metrics.cumulativeMissedProfitUsdt} USDT`,
    "",
    "### Risk Engine Analysis",
    `- Policy: consecutiveLossBlocksEntry=${RISK_GATE_POLICY.consecutiveLossBlocksEntry}`,
    `- Top risk rejections: ${metrics.topRejectionReasons.filter((r) => r.reason.includes("Confidence") || r.reason.includes("Spread") || r.reason.includes("Liquidity")).map((r) => r.reason).slice(0, 3).join("; ") || "None dominant"}`,
    "",
    "### Confidence Threshold Analysis",
    `- Effective bounded threshold: ${boundMinConfidenceThreshold(72)}`,
    `- Average candidate confidence: ${metrics.averageConfidence}`,
    "",
    "### Ranking Analysis",
    `- Ranking threshold used: 55`,
    `- Rejections citing ranking: ${rejected.filter((t) => String(t.rejectionReason).includes("Ranking")).length}`,
    "",
    "### Liquidity Analysis",
    `- Liquidity rejections: ${rejected.filter((t) => t.liquidityResult === "FAIL").length}`,
    "",
    "### AI Consensus Analysis",
    `- NO_TRADE rejections: ${rejected.filter((t) => t.aiConsensusResult === "NO_TRADE").length}`,
    "",
    "### Engineering Recommendations",
    "1. Keep consecutive-loss telemetry-only policy; simulation shows no streak hard-blocks.",
    "2. Tune ranking threshold if false-negative missed profit exceeds acceptable bounds.",
    "3. Continue bounding stale DB confidence via boundMinConfidenceThreshold.",
    "",
    "### Business Recommendations",
    "1. Prioritize strategies with positive simulated expectancy in trending regimes.",
    "2. Reduce exposure during low_liquidity regime signals.",
    "3. Use /api/risk/evaluate dry-run before promoting strategy config changes.",
    "",
    "---",
    "",
  ].join("\n");
}

function persistTrade(
  trade: TradeRecord,
  summary: SummaryState,
  metrics: MetricsState,
  accepted: TradeRecord[],
  rejected: TradeRecord[],
) {
  appendLine(path.join(ROOT, "simulation-lab.md"), formatTradeMarkdown(trade));
  appendLine(path.join(ROOT, "trades.jsonl"), JSON.stringify(trade));
  flush(path.join(ROOT, "summary.json"), summary);
  flush(path.join(ROOT, "metrics.json"), metrics);
  flush(path.join(ROOT, "accepted-trades.json"), accepted);
  flush(path.join(ROOT, "rejected-trades.json"), rejected);
  flush(path.join(CHECKPOINT_DIR, "latest.json"), {
    nextTradeNumber: Number(trade.tradeNumber) + 1,
    lastCompletedTrade: trade.tradeNumber,
    updatedAt: new Date().toISOString(),
  });
  appendLine(
    path.join(LOGS_DIR, "simulation.log"),
    `[${new Date().toISOString()}] Trade ${trade.tradeNumber} ${trade.accepted ? "ACCEPTED" : "REJECTED"}`,
  );
}

function main() {
  ensureDirs();
  initWorkspace();
  const { nextTrade, summary: loadedSummary, accepted, rejected } = loadCheckpoint();
  const summary = { ...loadedSummary };
  let consecutiveLosses = 0;

  for (const t of accepted) {
    if (Number(t.pnlUsdt) < 0) consecutiveLosses += 1;
    else consecutiveLosses = 0;
  }

  const rand = rng(42_001 + summary.completedTrades * 997);

  for (let n = nextTrade; n <= TARGET_TRADES; n += 1) {
    const trade = buildTrade(n, rand, consecutiveLosses);
    summary.completedTrades = n;
    summary.updatedAt = new Date().toISOString();
    if (trade.accepted) {
      summary.accepted += 1;
      accepted.push(trade);
      summary.totalPnlUsdt = round(summary.totalPnlUsdt + Number(trade.pnlUsdt), 4);
      if (Number(trade.pnlUsdt) < 0) consecutiveLosses += 1;
      else consecutiveLosses = 0;
      if (Number(trade.pnlUsdt) > 0) summary.wins += 1;
      else summary.losses += 1;
    } else {
      summary.rejected += 1;
      rejected.push(trade);
    }

    const metrics = computeMetrics(accepted, rejected);
    persistTrade(trade, summary, metrics, accepted, rejected);

    if (n % 10 === 0) {
      appendLine(path.join(ROOT, "simulation-lab.md"), batchSummary(n / 10, summary, metrics, accepted, rejected));
      flush(path.join(CHECKPOINT_DIR, `checkpoint-trade-${String(n).padStart(3, "0")}.json`), {
        tradeNumber: n,
        summary,
        metrics,
      });
    }
  }

  summary.status = "completed";
  summary.updatedAt = new Date().toISOString();
  flush(path.join(ROOT, "summary.json"), summary);
  const finalMetrics = computeMetrics(accepted, rejected);
  flush(path.join(ROOT, "metrics.json"), finalMetrics);
  appendLine(path.join(ROOT, "simulation-lab.md"), finalReport(summary, finalMetrics, accepted, rejected));
  flush(path.join(CHECKPOINT_DIR, "latest.json"), {
    nextTradeNumber: TARGET_TRADES + 1,
    lastCompletedTrade: TARGET_TRADES,
    status: "completed",
    updatedAt: new Date().toISOString(),
  });

  console.log(`Simulation complete: ${summary.accepted} accepted, ${summary.rejected} rejected, PnL ${summary.totalPnlUsdt} USDT`);
}

main();
