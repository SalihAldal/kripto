import { createHash } from "node:crypto";
import type { AlphaExperimentStats, AlphaScoreboardEntry, AlphaStatus, AlphaTradeRecord } from "./types";

export const VALIDATION_FRAMEWORK_VERSION = "v2.0.0";

export function computeAlphaStats(trades: AlphaTradeRecord[], notionalPerTrade = 1000): AlphaExperimentStats {
  const active = trades.filter((t) => t.side !== "CASH");
  const nets = active.map((t) => (t.netReturnPct / 100) * notionalPerTrade);
  const wins = nets.filter((n) => n > 0).length;
  const grossPnl = active.reduce((s, t) => s + (t.grossReturnPct / 100) * notionalPerTrade, 0);
  const netPnl = nets.reduce((s, n) => s + n, 0);
  const grossW = nets.filter((n) => n > 0).reduce((s, n) => s + n, 0);
  const grossL = Math.abs(nets.filter((n) => n <= 0).reduce((s, n) => s + n, 0));
  let peak = 10_000;
  let eq = 10_000;
  let maxDd = 0;
  for (const n of nets) {
    eq += n;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, ((peak - eq) / peak) * 100);
  }
  return {
    trades: active.length,
    wins,
    losses: active.length - wins,
    grossPnl: Number(grossPnl.toFixed(2)),
    netPnl: Number(netPnl.toFixed(2)),
    expectancy: active.length ? Number((netPnl / active.length).toFixed(4)) : 0,
    profitFactor: grossL > 0 ? Number((grossW / grossL).toFixed(4)) : grossW > 0 ? 999 : 0,
    maxDrawdown: Number(maxDd.toFixed(4)),
    longTrades: active.filter((t) => t.side === "LONG").length,
    shortTrades: active.filter((t) => t.side === "SHORT").length,
    cashSkips: trades.filter((t) => t.side === "CASH").length,
  };
}

export function passesValidationGate(stats: AlphaExperimentStats, minTrades = 8): boolean {
  return stats.trades >= minTrades && stats.netPnl > 0 && stats.expectancy > 0 && stats.profitFactor > 1;
}

export function passesFinalGate(stats: AlphaExperimentStats, minTrades = 6): boolean {
  return stats.trades >= minTrades && stats.netPnl > 0 && stats.expectancy > 0 && stats.profitFactor > 1;
}

export function edgeConfidence(stats: AlphaExperimentStats): "HIGH" | "LOW" | "NONE" {
  if (stats.trades >= 20) return "HIGH";
  if (stats.trades >= 5) return "LOW";
  return "NONE";
}

export function resolveAlphaStatus(input: {
  validationPass: boolean;
  finalPass: boolean;
  robustnessPass: boolean;
}): AlphaStatus {
  if (!input.validationPass) return "VALIDATION_FAIL";
  if (!input.finalPass) return "FINAL_FAIL";
  if (!input.robustnessPass) return "ROBUSTNESS_FAIL";
  return "ROBUSTNESS_PASS";
}

export function freezeDatasetConfig(input: {
  datasetId: string;
  start: string;
  end: string;
  trainEnd: string;
  valEnd: string;
  symbols: string[];
  costModelVersion: string;
  featureVersion: string;
  alphaVersion: string;
}) {
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return { ...input, configHash: hash };
}

export function buildScoreboardEntry(input: {
  alphaId: string;
  version: string;
  datasetId: string;
  configHash: string;
  featureVersion: string;
  costModelVersion: string;
  valStats: AlphaExperimentStats;
  testStats: AlphaExperimentStats;
  robustnessPassed: boolean;
}): AlphaScoreboardEntry {
  const validationPass = passesValidationGate(input.valStats);
  const finalPass = validationPass && passesFinalGate(input.testStats);
  const status = resolveAlphaStatus({
    validationPass,
    finalPass,
    robustnessPass: input.robustnessPassed,
  });
  return {
    alphaId: input.alphaId,
    version: input.version,
    datasetId: input.datasetId,
    configHash: input.configHash,
    featureVersion: input.featureVersion,
    costModelVersion: input.costModelVersion,
    validationTrades: input.valStats.trades,
    validationExpectancy: input.valStats.trades ? input.valStats.expectancy : null,
    validationProfitFactor: input.valStats.trades ? input.valStats.profitFactor : null,
    validationNetPnl: input.valStats.trades ? input.valStats.netPnl : null,
    testTrades: input.testStats.trades,
    testExpectancy: input.testStats.trades ? input.testStats.expectancy : null,
    testProfitFactor: input.testStats.trades ? input.testStats.profitFactor : null,
    testNetPnl: input.testStats.trades ? input.testStats.netPnl : null,
    maxDrawdown: input.testStats.trades ? input.testStats.maxDrawdown : input.valStats.maxDrawdown,
    status,
    edgeConfidence: edgeConfidence(input.testStats.trades ? input.testStats : input.valStats),
    robustnessPassed: input.robustnessPassed,
  };
}
