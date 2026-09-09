import fs from "node:fs";
import { runTrySpotReplayUniverse } from "../src/server/alpha-engine-v2/try-spot-replay.service";
import { loadTrySpotUniverse, loadTrySpotPanel, loadUsdtTryBars } from "../src/server/trade-decision-core/try-dataset-loader.service";
import { spotHoldBenchmark, currencyAdjustedReturn } from "../src/server/trade-decision-core/research-benchmarks.service";
import { atomicJson } from "./strategy-evidence-io";
process.env.LIVE_TRADING_ENABLED = "false";
process.env.LIVE_AUTHORIZATION = "DISABLED";
const job = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
console.log(JSON.stringify({ stage: "LOADING", variant: job.variant.id, symbols: job.symbols.length }));
const started = Date.now();
const panels = loadTrySpotUniverse(job.symbols, job.root);
console.log(JSON.stringify({ stage: "LOADED", elapsedMs: Date.now() - started, rssMb: Math.round(process.memoryUsage().rss / 1048576) }));
const run = runTrySpotReplayUniverse({ ...job.options, panels, btcPanel: loadTrySpotPanel("BTCUSDT", job.root), variant: job.variant,
    onProgress: p => console.log(JSON.stringify({ stage: "REPLAY", variant: job.variant.id, ...p })) });
const benchmarks = { btcHold: spotHoldBenchmark([loadTrySpotPanel("BTCUSDT", job.root)], job.options.periodStart, job.options.periodEnd),
    equalWeightHold: spotHoldBenchmark(panels, job.options.periodStart, job.options.periodEnd),
    tryCash: { netPnlTry: 0 }, currencyAdjusted: currencyAdjustedReturn(loadUsdtTryBars(job.root), job.options.periodStart, job.options.periodEnd, run.portfolio.initialCashTry, run.portfolio.equityTry) };
atomicJson(job.result, { key: job.key, run, benchmarks });
