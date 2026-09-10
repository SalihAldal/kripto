import "./load-dotenv.cjs";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { atomicJson, sourceFingerprint, verifyDataset } from "./strategy-evidence-io";
import { loadTrySpotUniverse, loadAssetMapping, resolveDatasetRoot } from "../src/server/trade-decision-core/try-dataset-loader.service";
import { opportunityDays, dailyAccountTargets } from "../src/server/trade-decision-core/opportunity-capture.service";
import { RESEARCH_VARIANTS, OPPORTUNITY_VARIANTS } from "../src/server/trade-decision-core/entry-signal.service";
import { runTrySpotReplayUniverse } from "../src/server/alpha-engine-v2/try-spot-replay.service";
import { summarizeWindow } from "../src/server/trade-decision-core/window-diagnostics.service";
import { MINUTE_EXPANSION_RULES } from "../src/server/trade-decision-core/minute-expansion-entry.service";
const output = path.resolve("artifacts/opportunity-capture-result.json");
const initial = { status: "RUNNING", diagnostic: true, dataStatus: "SEEN_FIXED_TEN_ASSET_ARCHIVE", paperEligible: null, LIVE_STATUS: "DISABLED" };
let aborted = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { aborted = true; atomicJson(output, { ...initial, status: "ABORTED" }); });
atomicJson(output, initial);
async function main() {
  if (process.argv.length > 2) throw new Error("FIXED_EXPERIMENT_NO_ARGUMENTS");
  const started = Date.now(), sourceHash = sourceFingerprint(), root = resolveDatasetRoot(), dataset = verifyDataset(root);
  const end = Date.parse(dataset.manifest.end);
  if (end > Date.now()) throw new Error("DATASET_END_IN_FUTURE");
  const panels = loadTrySpotUniverse(loadAssetMapping(root).map(x => x.externalSymbol).sort(), root), btc = panels.find(p => p.symbol === "BTCUSDT");
  if (!btc) throw new Error("BTC_CONTEXT_REQUIRED");
  const days = panels.flatMap(p => opportunityDays(p.executionSymbol, p.executionBarsTRY));
  const coverage = [30,60,90,270,365].map(length => {
    const selected = days.filter(d => d.dayStart >= end + 1 - length * 86400000);
    return { days: length, coinDays: selected.length, thresholds: [5,10,20,30].map(pct => ({ pct,
      closeCount: selected.filter(d => d.closeReturnPct >= pct).length,
      peakClosedMinuteCount: selected.filter(d => d.peakCloseReturnPct >= pct).length,
      intrabarHighCount: selected.filter(d => d.intrabarHighReturnPct >= pct).length })) };
  });
  const runs = [];
  const variants = [...OPPORTUNITY_VARIANTS, ...RESEARCH_VARIANTS].filter(v => ["research_minute_pr04", "research_minute_risk_trail", "research_local_breakout"].includes(v.id));
  for (const length of [30,60,90,270]) for (const scenario of [{ id: "base", feePerSidePct: .15, slippageBpsPerSide: 7 }, { id: "stress", feePerSidePct: .20, slippageBpsPerSide: 15 }]) for (const variant of variants) {
    await setImmediate(); if (aborted) throw new Error("ABORTED");
    const start = end + 1 - length * 86400000;
    const run = runTrySpotReplayUniverse({ panels, btcPanel: btc, variant, periodStart: start, periodEnd: end, freshPartialStart: start, ...scenario });
    const summary = summarizeWindow(run, start, end);
    runs.push({ days: length, scenario: scenario.id, variant: variant.id, ...summary, entryDiagnostics: run.entryDiagnostics,
      dailyAccountTargets: dailyAccountTargets(run.equity, run.portfolio.initialCashTry, start, end),
      equity: run.equity, tradesDetail: run.trades, openPositions: run.openPositions, config: run.config });
    atomicJson(output, { ...initial, sourceHash, coverage, runs });
    console.log(JSON.stringify({ days: length, scenario: scenario.id, variant: variant.id, trades: summary.trades, netTry: summary.netPnlTry, dd: summary.maxDrawdownPct }));
  }
  if (sourceHash !== sourceFingerprint()) throw new Error("SOURCE_CHANGED_DURING_RUN");
  atomicJson(output, { ...initial, status: "COMPLETED", sourceHash, datasetHash: dataset.hash, generatedAt: new Date().toISOString(),
    rules: MINUTE_EXPANSION_RULES, coverage, days, runs, elapsedMs: Date.now() - started,
    interpretation: "HINDSIGHT_COVERAGE_NOT_TRADE_RETURNS; SAME_RULES_ALL_WINDOWS; EXIT_COMPARISON_IS_PORTFOLIO_NOT_MATCHED_ENTRIES; NO_PRODUCTION_PROMOTION" });
}
main().catch(error => { atomicJson(output, { ...initial, status: aborted ? "ABORTED" : "ERROR", error: String(error) }); console.error(error); process.exitCode = aborted ? 130 : 1; });
