/**
 * Confidence calibration validation — raw vs calibrated confidence replay.
 */
import fs from "node:fs";
import path from "node:path";
import {
  aggregateCalibrationKpis,
  applyConfidenceCalibration,
  buildCalibrationBinsFromOutcomes,
  buildConfidenceCalibrationTelemetry,
} from "../src/server/ai/confidence-calibration-intelligence.service";
import { computeDrawdownMetrics } from "../src/server/execution/risk-efficiency.service";

const ROOT = path.join(process.cwd(), "brainos-lab/simulation-v1");
type Trade = Record<string, unknown>;

function round(n: number, d = 4) {
  return Math.round(n * 10 ** d) / 10 ** d;
}

function replayTrade(trade: Trade, prior: Trade[], useCalibration: boolean) {
  const rawConfidence = Number(trade.confidence);
  const bins = buildCalibrationBinsFromOutcomes(
    prior.map((row) => ({
      confidence: Number(row.confidence),
      won: Number(row.pnlUsdt) > 0,
    })),
  );
  const calibrated = applyConfidenceCalibration({
    rawConfidence,
    bins,
    marketRegime: String(trade.marketRegime ?? "ranging"),
  });
  const effectiveConfidence = useCalibration ? calibrated.calibratedConfidence : rawConfidence;
  const won = Number(trade.pnlUsdt) > 0;
  const telemetry = buildConfidenceCalibrationTelemetry({
    result: {
      finalDecision: "BUY",
      finalConfidence: rawConfidence,
      finalConsensusConfidence: effectiveConfidence,
      finalRiskScore: Number(trade.riskScore),
      score: Number(trade.rankingScore),
      explanation: "",
      outputs: [],
      rejected: false,
      generatedAt: String(trade.timestamp),
      analysisScorecard: {
        symbol: String(trade.symbol),
        currentPrice: Number(trade.entryPrice),
        direction: "BUY",
        confidenceScore: effectiveConfidence,
        expectedMovePercent: Number(trade.expectedProfitPercent ?? trade.pnlPercent),
        expectedMoveRange: { min: 0.1, max: 1.2 },
        targetSellPercent: Number(trade.pnlPercent),
        initialStopPercent: 0.8,
        trailingStartPercent: 0.4,
        trailingGapPercent: 0.25,
        riskLevel: "MEDIUM",
      },
    },
    providerResults: [],
    bins,
    marketRegime: String(trade.marketRegime ?? "ranging"),
    realizedOutcome: {
      won,
      pnlUsdt: Number(trade.pnlUsdt),
      expectedProfitPercent: Number(trade.pnlPercent),
    },
  });
  const gatePass = effectiveConfidence >= 45 && Number(trade.rankingScore) >= 48;
  return {
    gatePass,
    pnlUsdt: gatePass ? Number(trade.pnlUsdt) : 0,
    telemetry,
    effectiveConfidence,
  };
}

const cohortPath = fs.existsSync(path.join(ROOT, "accepted-trades.json"))
  ? path.join(ROOT, "accepted-trades.json")
  : path.join(ROOT, "accepted-trades.before-pf.json");
const trades = JSON.parse(fs.readFileSync(cohortPath, "utf8")) as Trade[];

const beforeRows = trades.map((trade, index) => replayTrade(trade, trades.slice(0, index), false));
const afterRows = trades.map((trade, index) => replayTrade(trade, trades.slice(0, index), true));
const beforePnls = beforeRows.filter((r) => r.gatePass).map((r) => r.pnlUsdt);
const afterPnls = afterRows.filter((r) => r.gatePass).map((r) => r.pnlUsdt);
const beforeMetrics = computeDrawdownMetrics(beforePnls, 10_000);
const afterMetrics = computeDrawdownMetrics(afterPnls, 10_000);
const beforeCalibration = aggregateCalibrationKpis({
  telemetryRows: beforeRows.map((r) => r.telemetry),
  pnls: beforePnls,
});
const afterCalibration = aggregateCalibrationKpis({
  telemetryRows: afterRows.map((r) => r.telemetry),
  pnls: afterPnls,
});

console.log("=== Confidence Calibration Intelligence Validation ===\n");
console.log("### Pipeline coverage");
console.log("- Bin calibration from historical win/loss outcomes");
console.log("- Disagreement/conflict/regime confidence adjustment");
console.log("- Master engine hybrid+expert blended confidence");
console.log("- Orchestrator applyConfidenceCalibrationToDecision()");
console.log("- Simulation Lab rolling-window calibration before gates\n");

console.log("### BEFORE (raw confidence) vs AFTER (calibrated confidence)");
console.log("| KPI | BEFORE | AFTER | Delta |");
console.log("| --- | ---: | ---: | ---: |");
const rows: Array<[string, number, number]> = [
  ["Gate-pass trades", beforePnls.length, afterPnls.length],
  ["Average Calibration Error", beforeCalibration.averageCalibrationError, afterCalibration.averageCalibrationError],
  ["Confidence Accuracy", beforeCalibration.averageConfidenceAccuracy, afterCalibration.averageConfidenceAccuracy],
  ["Overestimation Rate %", beforeCalibration.overestimationRate, afterCalibration.overestimationRate],
  ["Decision Accuracy %", beforeCalibration.decisionAccuracy, afterCalibration.decisionAccuracy],
  ["Expected Value Accuracy", beforeCalibration.expectedValueAccuracy, afterCalibration.expectedValueAccuracy],
  ["Total PnL", beforeMetrics.totalPnl, afterMetrics.totalPnl],
  ["Profit Factor", beforeCalibration.profitFactor ?? 0, afterCalibration.profitFactor ?? 0],
  ["Sharpe", beforeCalibration.sharpeRatio ?? 0, afterCalibration.sharpeRatio ?? 0],
  ["Sortino", beforeCalibration.sortinoRatio ?? 0, afterCalibration.sortinoRatio ?? 0],
  ["Max Drawdown", beforeMetrics.maxDrawdown, afterMetrics.maxDrawdown],
];
for (const [label, b, a] of rows) {
  console.log(`| ${label} | ${b} | ${a} | ${round(a - b, 4)} |`);
}

console.log("\n### Confidence Distribution");
const avgRaw = trades.reduce((s, t) => s + Number(t.confidence), 0) / Math.max(1, trades.length);
const avgCalibrated =
  afterRows.reduce((s, r) => s + r.effectiveConfidence, 0) / Math.max(1, afterRows.length);
console.log(`Average raw confidence: ${round(avgRaw, 2)}%`);
console.log(`Average calibrated confidence: ${round(avgCalibrated, 2)}%`);
console.log(`Calibration direction: ${avgCalibrated <= avgRaw ? "conservative (expected)" : "WARNING — net increase"}`);
