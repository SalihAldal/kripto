/**
 * Execution intelligence validation — flat fill assumptions vs telemetry-aware replay.
 */
import fs from "node:fs";
import path from "node:path";
import {
  aggregateExecutionKpis,
  buildExecutionTelemetry,
  evaluatePreSubmitExecution,
  simulateLabExecutionQuality,
} from "../src/server/execution/execution-intelligence.service";
import { computeRiskAdjustedMetrics } from "../src/server/execution/risk-adjusted-performance.service";

const ROOT = path.join(process.cwd(), "brainos-lab/simulation-v1");
type Trade = Record<string, unknown>;

function round(n: number, d = 4) {
  return Math.round(n * 10 ** d) / 10 ** d;
}

function replayFlat(trade: Trade) {
  const entryPrice = Number(trade.entryPrice);
  const positionSize = Number(trade.positionSize);
  const pnlPct = Number(trade.pnlPercent);
  const pnlUsdt = round((positionSize * pnlPct) / 100, 4);
  return {
    pnlUsdt,
    telemetry: buildExecutionTelemetry({
      executionId: `flat_${trade.tradeNumber}`,
      symbol: String(trade.symbol),
      side: "BUY",
      decisionTimestamp: String(trade.timestamp),
      orderTimestamp: String(trade.timestamp),
      fillTimestamp: String(trade.timestamp),
      expectedPrice: entryPrice,
      fillPrice: entryPrice,
      spreadPercent: Number(trade.spreadPercent ?? 0.1),
      requestedQty: positionSize / Math.max(entryPrice, 1),
      filledQty: positionSize / Math.max(entryPrice, 1),
      orderStatus: "FILLED",
    }),
  };
}

function replayExecutionAware(trade: Trade) {
  const entryPrice = Number(trade.entryPrice);
  const positionSize = Number(trade.positionSize);
  const pnlPct = Number(trade.pnlPercent);
  const regime = String(trade.marketRegime ?? "ranging");
  const spreadPercent = Number(trade.spreadPercent ?? 0.1);
  const liquidity24h = Number(trade.liquidity24h ?? 8_000_000);
  const bidDepth = Math.max(positionSize / 0.0025, liquidity24h * (regime === "low_liquidity" ? 0.000008 : 0.00005));
  const askDepth = bidDepth * (regime === "low_liquidity" ? 0.62 : 0.96);
  const preSubmit = evaluatePreSubmitExecution({
    side: "BUY",
    notional: positionSize,
    bidDepth,
    askDepth,
    spreadPercent,
    liquidity24h,
    marketRegime: regime,
  });
  if (!preSubmit.allowed) {
    return { pnlUsdt: 0, telemetry: null, rejected: true, reason: preSubmit.reason };
  }
  const telemetry = simulateLabExecutionQuality({
    side: "BUY",
    entryPrice,
    positionSize,
    spreadPercent,
    bidDepth,
    askDepth,
    liquidity24h,
    marketRegime: regime,
    signalTimestamp: String(trade.timestamp),
    decisionTimestamp: String(trade.timestamp),
  });
  const slippageCost = round((positionSize * telemetry.slippagePct) / 100, 4);
  const pnlUsdt = round((positionSize * pnlPct) / 100 - slippageCost, 4);
  return { pnlUsdt, telemetry, rejected: false };
}

const cohortPath = fs.existsSync(path.join(ROOT, "accepted-trades.json"))
  ? path.join(ROOT, "accepted-trades.json")
  : path.join(ROOT, "accepted-trades.before-pf.json");
const accepted = JSON.parse(fs.readFileSync(cohortPath, "utf8")) as Trade[];
const flatRows = accepted.map(replayFlat);
const awareRows = accepted.map(replayExecutionAware).filter((r) => !r.rejected && r.telemetry);
const flatPnls = flatRows.map((r) => r.pnlUsdt);
const awarePnls = awareRows.map((r) => r.pnlUsdt);
const flatMetrics = computeRiskAdjustedMetrics(flatPnls);
const awareMetrics = computeRiskAdjustedMetrics(awarePnls);
const flatExec = aggregateExecutionKpis(flatRows.map((r) => r.telemetry));
const awareExec = aggregateExecutionKpis(
  awareRows.map((r) => r.telemetry!),
  new Map(awareRows.map((r, i) => [String(r.telemetry!.executionId), awarePnls[i] ?? 0])),
);

console.log("=== Execution Intelligence Validation ===\n");
console.log("### Pipeline coverage");
console.log("- Pre-submit: evaluatePreSubmitExecution (depth, spread, slippage guard)");
console.log("- Telemetry: buildExecutionTelemetry on orchestrator buy path");
console.log("- Retry: resolveAdaptiveRetryPolicy for transient exchange errors");
console.log("- Simulation Lab: simulateLabExecutionQuality + slippage-adjusted PnL\n");

console.log("### Aggregate BEFORE (flat fill @ expected price) vs AFTER (execution-aware)");
console.log("| KPI | BEFORE | AFTER | Delta |");
console.log("| --- | ---: | ---: | ---: |");
const rows: Array<[string, number, number]> = [
  ["Executed trades", flatPnls.length, awarePnls.length],
  ["Execution Success Rate %", flatExec.successRate, awareExec.successRate],
  ["Average Slippage %", flatExec.averageSlippagePct, awareExec.averageSlippagePct],
  ["Average Fill Time ms", flatExec.averageFillTimeMs, awareExec.averageFillTimeMs],
  ["Average Latency ms", flatExec.averageLatencyMs, awareExec.averageLatencyMs],
  ["Partial Fill Rate %", flatExec.partialFillRate, awareExec.partialFillRate],
  ["Profit Factor", flatMetrics.profitFactor, awareMetrics.profitFactor],
  ["Sharpe", flatMetrics.sharpeRatio, awareMetrics.sharpeRatio],
  ["Max Drawdown", flatMetrics.maxDrawdown, awareMetrics.maxDrawdown],
  ["Total PnL", flatMetrics.totalPnl, awareMetrics.totalPnl],
  ["Quality Score", flatExec.averageQualityScore, awareExec.averageQualityScore],
];
for (const [label, b, a] of rows) {
  console.log(`| ${label} | ${b} | ${a} | ${round(a - b, 4)} |`);
}

console.log("\n### Slippage Analysis");
console.log(`Flat assumed slippage: ${flatExec.averageSlippagePct}%`);
console.log(`Execution-aware slippage: ${awareExec.averageSlippagePct}%`);

console.log("\n### Latency Analysis");
console.log(`Flat fill time: ${flatExec.averageFillTimeMs}ms`);
console.log(`Execution-aware fill time: ${awareExec.averageFillTimeMs}ms`);

console.log("\n### Liquidity / Pre-Submit");
const rejectedByExecution = accepted.length - awareRows.length;
console.log(`Trades filtered by execution pre-submit guard: ${rejectedByExecution}`);
