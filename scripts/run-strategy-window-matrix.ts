import "./load-dotenv.cjs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { setImmediate } from "node:timers/promises";
import { runTrySpotReplayUniverse, TRY_REPLAY_VERSION } from "../src/server/alpha-engine-v2/try-spot-replay.service";
import { STRATEGY_VARIANTS, RESEARCH_VARIANTS } from "../src/server/trade-decision-core/entry-signal.service";
import { loadAssetMapping, loadTrySpotUniverse, loadUsdtTryBars, resolveDatasetRoot } from "../src/server/trade-decision-core/try-dataset-loader.service";
import { spotHoldBenchmark, currencyAdjustedReturn } from "../src/server/trade-decision-core/research-benchmarks.service";
import { recentDiagnosticWindows, summarizeWindow } from "../src/server/trade-decision-core/window-diagnostics.service";
import { atomicJson, sourceFingerprint, verifyDataset } from "./strategy-evidence-io";
process.env.LIVE_TRADING_ENABLED = "false";
process.env.LIVE_AUTHORIZATION = "DISABLED";
process.env.TRADE_DECISION_CORE_ENABLED = "false";
const output = path.resolve("artifacts/strategy-window-matrix.json"), started = Date.now();
const initial = { status: "RUNNING", diagnostic: true, dataStatus: "SEEN_HISTORICAL_DATA_NOT_UNSEEN", paperEligible: null, LIVE_STATUS: "DISABLED" };
let aborted = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { aborted = true; atomicJson(output, { ...initial, status: "ABORTED" }); });
atomicJson(output, initial);
async function main() {
    if (process.argv.length > 2) throw new Error("NO_ARGUMENTS_EXPECTED_FIXED_WINDOW_MATRIX");
    const root = resolveDatasetRoot(), dataset = verifyDataset(root), sourceHash = sourceFingerprint();
    const windows = recentDiagnosticWindows(Date.parse(dataset.manifest.start), Date.parse(dataset.manifest.end));
    if (windows[0].end > Date.now()) throw new Error("DATASET_END_IN_FUTURE");
    console.log("LOADING: checked archive; loading universe once for all windows");
    const panels = loadTrySpotUniverse(loadAssetMapping(root).map(x => x.externalSymbol).sort(), root);
    const btc = panels.find(p => p.symbol === "BTCUSDT");
    if (!btc) throw new Error("BTC_CONTEXT_REQUIRED");
    const fx = loadUsdtTryBars(root), variants = [...STRATEGY_VARIANTS, ...RESEARCH_VARIANTS];
    const scenarios = [{ id: "base", feePerSidePct: .15, slippageBpsPerSide: 7 }, { id: "stress", feePerSidePct: .20, slippageBpsPerSide: 15 }];
    const rows = [], benchmarkRows = [];
    console.log(`LOADED ${panels.length} symbols in ${Date.now() - started}ms`);
    for (const window of windows) {
        benchmarkRows.push({ windowId: window.id, btcHold: spotHoldBenchmark([btc], window.start, window.end), equalWeightHold: spotHoldBenchmark(panels, window.start, window.end), tryCash: 0 });
        for (const scenario of scenarios) {
            if (scenario.id === "stress" && window.kind !== "OVERLAPPING_TRAILING") continue;
            for (const variant of variants) {
                await setImmediate();
                if (aborted) throw new Error("ABORTED");
                const run = runTrySpotReplayUniverse({ panels, btcPanel: btc, variant, periodStart: window.start, periodEnd: window.end,
                    freshPartialStart: Date.parse(dataset.manifest.start) + 320 * 86400000, ...scenario });
                const summary = summarizeWindow(run, window.start, window.end);
                rows.push({ windowId: window.id, scenario: scenario.id, variantId: variant.id, researchOnly: !!variant.researchOnly, ...summary,
                    currencyAdjusted: currencyAdjustedReturn(fx, window.start, window.end, run.portfolio.initialCashTry, run.portfolio.equityTry), config: run.config });
                atomicJson(output, { ...initial, sourceHash, windows, rows });
                console.log(JSON.stringify({ window: window.id, scenario: scenario.id, variant: variant.id, trades: summary.trades, netTry: summary.netPnlTry, dd: summary.maxDrawdownPct }));
            }
        }
    }
    await setImmediate();
    if (aborted) throw new Error("ABORTED");
    if (sourceFingerprint() !== sourceHash) throw new Error("SOURCE_CHANGED_DURING_RUN");
    atomicJson(output, { ...initial, status: "COMPLETED", generatedAt: new Date().toISOString(), repositoryHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        sourceHash, datasetHash: dataset.hash, datasetChecksumFiles: dataset.files, replayVersion: TRY_REPLAY_VERSION, windows, scenarios, rows, benchmarks: benchmarkRows,
        interpretation: "NESTED_WINDOWS_ARE_DEPENDENT; DISJOINT_BLOCKS_RESET_CASH; ALL_SEEN; NO_AUTOMATIC_PROMOTION", elapsedMs: Date.now() - started });
    console.log(`COMPLETED ${output}`);
}
main().catch(error => { atomicJson(output, { ...initial, status: aborted ? "ABORTED" : "ERROR", error: String(error) }); console.error(error); process.exitCode = aborted ? 130 : 1; });
