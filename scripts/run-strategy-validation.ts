import "./load-dotenv.cjs";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { resolveDatasetRoot, loadAssetMapping } from "../src/server/trade-decision-core/try-dataset-loader.service";
import { STRATEGY_VARIANTS, RESEARCH_VARIANTS } from "../src/server/trade-decision-core/entry-signal.service";
import { TRY_REPLAY_VERSION, type runTrySpotReplayUniverse } from "../src/server/alpha-engine-v2/try-spot-replay.service";
import { contribution, equityFolds, weeklyBootstrap, STRATEGY_ACCEPTANCE as A } from "../src/server/trade-decision-core/validation-evidence.service";
import { atomicJson, sha, sourceFingerprint, verifyDataset } from "./strategy-evidence-io";
process.env.LIVE_TRADING_ENABLED = "false";
process.env.LIVE_AUTHORIZATION = "DISABLED";
const DAY = 86400000, started = Date.now();
const args = process.argv.slice(2), research = args.includes("--research"), resume = args.includes("--resume");
const value = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const out = path.resolve("artifacts", research ? "strategy-research-result.json" : "strategy-validation-result.json");
let child: ChildProcess | null = null, aborted = false;
const initial = { generatedAt: new Date().toISOString(), status: "RUNNING", STRATEGY_VALIDATION_STATUS: "BLOCKED", paperEligible: null, LIVE_STATUS: "DISABLED", liveTradingEnabled: false };
atomicJson(out, initial);
for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => { aborted = true; child?.kill("SIGTERM"); atomicJson(out, { ...initial, status: "ABORTED", generatedAt: new Date().toISOString() }); });
async function main() {
    const root = resolveDatasetRoot();
    console.log("Verifying dataset checksums...");
    const dataset = verifyDataset(root), sourceHash = sourceFingerprint(), repositoryHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const start = Date.parse(dataset.manifest.start), end = Date.parse(dataset.manifest.end), fresh = start + 320 * DAY;
    if (dataset.manifest.days !== 365 || !Number.isFinite(start) || end - start + 1 !== 365 * DAY)
        throw new Error("EXPECTED_365_DAY_DATASET");
    const allSymbols = loadAssetMapping(root).map(x => x.externalSymbol).sort();
    const symbols = value("--symbols")?.split(",").sort() ?? allSymbols;
    if (symbols.some(s => !allSymbols.includes(s)))
        throw new Error("UNKNOWN_SYMBOL");
    let variants = research ? RESEARCH_VARIANTS : STRATEGY_VARIANTS;
    if (value("--variant"))
        variants = variants.filter(v => v.id === value("--variant"));
    if (!variants.length)
        throw new Error("UNKNOWN_VARIANT");
    const days = value("--days") == null ? undefined : Number(value("--days"));
    if (days != null && (!Number.isInteger(days) || days < 1 || days > 270))
        throw new Error("INVALID_DAYS_EXPECT_1_TO_270_USE_STRATEGY_WINDOWS_FOR_RECENT_DATA");
    const diagnostic = days != null || symbols.length !== allSymbols.length || variants.length !== (research ? RESEARCH_VARIANTS : STRATEGY_VARIANTS).length;
    const validationStart = start + 45 * DAY, validationEnd = days ? Math.min(end, validationStart + days * DAY - 1) : start + 315 * DAY - 1;
    const options = { periodStart: validationStart, periodEnd: validationEnd, freshPartialStart: fresh };
    const key = sha(JSON.stringify({ sourceHash, dataset: dataset.hash, options, symbols, variants, version: TRY_REPLAY_VERSION }));
    const directory = path.resolve("artifacts", "strategy-runs", key);
    fs.mkdirSync(directory, { recursive: true });
    atomicJson(path.join(directory, "frozen-config.json"), { sourceHash, repositoryHead, datasetHash: dataset.hash, options, symbols, variants, acceptance: A });
    const results = [];
    for (const variant of variants) {
        if (aborted)
            throw new Error("ABORTED");
        const result = path.join(directory, `${variant.id}.json`), job = path.join(directory, `${variant.id}.job.json`);
        const checkpoint = resume && fs.existsSync(result) ? JSON.parse(fs.readFileSync(result, "utf8")) : null;
        if (checkpoint?.key !== key) {
            atomicJson(job, { key, root, symbols, options, variant, result });
            await new Promise<void>((resolve, reject) => {
                child = spawn(process.execPath, ["--max-old-space-size=4096", "--import", "tsx", "scripts/strategy-replay-worker.ts", job], { stdio: "inherit", env: { ...process.env, LIVE_TRADING_ENABLED: "false", LIVE_AUTHORIZATION: "DISABLED" } });
                const timeout = setTimeout(() => { child?.kill("SIGTERM"); reject(new Error("WORKER_TIMEOUT")); }, 30 * 60000);
                child.on("error", err => { clearTimeout(timeout); reject(err); });
                child.on("exit", code => { clearTimeout(timeout); child = null; if (code === 0 && !aborted)
                    resolve();
                else
                    reject(new Error(aborted ? "ABORTED" : `WORKER_EXIT:${code}`)); });
            });
        }
        else
            console.log(`RESUMED ${variant.id}`);
        const completed = JSON.parse(fs.readFileSync(result, "utf8")) as {
            key: string;
            run: ReturnType<typeof runTrySpotReplayUniverse>;
            benchmarks: unknown;
        };
        if (completed.key !== key)
            throw new Error("CHECKPOINT_MISMATCH");
        const run = completed.run, folds = equityFolds(run.equity, validationStart, validationEnd, run.portfolio.initialCashTry), conc = contribution(run.trades), ci = weeklyBootstrap(run.equity, run.portfolio.initialCashTry);
        const ratio = folds.length ? folds.filter(f => f.netPnlTry > 0).length / folds.length : 0;
        const reasons = [];
        if (run.stats.trades < A.minTrades)
            reasons.push("LOW_SAMPLE");
        if (run.stats.expectancy <= 0 || run.portfolio.netPnlTry <= 0)
            reasons.push("EXPECTANCY_OR_PORTFOLIO_PNL");
        if (run.stats.profitFactor <= A.minProfitFactor)
            reasons.push("PROFIT_FACTOR");
        if (run.portfolio.maxDrawdownPct >= A.maxDrawdownPct)
            reasons.push("DRAWDOWN");
        if (ratio < A.minPositiveFoldRatio)
            reasons.push("FOLD_RATIO");
        if (conc.topSymbolContributionPct > A.maxTopSymbolContributionPct)
            reasons.push("CONCENTRATION");
        if (run.openPositions.length)
            reasons.push("OPEN_POSITIONS_AT_DATA_END");
        if (diagnostic)
            reasons.push("DIAGNOSTIC_SUBSET");
        const row = { variantId: variant.id, researchOnly: !!variant.researchOnly, benchmarks: completed.benchmarks, stats: run.stats, portfolio: run.portfolio, entryDiagnostics: run.entryDiagnostics, walkForward: { method: "FROZEN_RULE_TEMPORAL_STABILITY_NOT_MODEL_FITTING", folds, positiveRatio: ratio }, concentration: conc, bootstrap: ci, acceptance: { pass: reasons.length === 0, reasons }, elapsedMs: run.elapsedMs, evidenceFile: path.relative(process.cwd(), result), executionModel: run.config.executionModel };
        results.push(row);
        console.log(JSON.stringify(row));
    }
    if (sourceFingerprint() !== sourceHash)
        throw new Error("SOURCE_CHANGED_DURING_RUN");
    const eligible = results.find(r => r.acceptance.pass && !r.researchOnly);
    // Research results cannot activate the production bridge, even if economically positive.
    atomicJson(out, { ...initial, status: "COMPLETED", generatedAt: new Date().toISOString(), repositoryHead, sourceHash, datasetHash: dataset.hash, replayVersion: TRY_REPLAY_VERSION,
        diagnostic, researchOnly: research, acceptanceCriteria: A, period: { validationStart, validationEnd },
        dataSplit: { development: { start, end: validationStart - 1 }, validation: { start: validationStart, end: validationEnd }, buffer: { start: start + 315 * DAY, end: fresh - 1 }, freshPartial: { start: fresh, end, status: "PARTIAL_SEEN_IN_PRIOR_RESEARCH_NOT_USED_FOR_SELECTION" } },
        variants: results, RESEARCH_VALIDATION_STATUS: research ? (results.some(r => r.acceptance.pass) ? "PASS" : "FAIL") : "NOT_RUN", STRATEGY_VALIDATION_STATUS: eligible ? "PASS" : "FAIL", paperEligible: eligible?.variantId ?? null, elapsedMs: Date.now() - started });
    console.log(`COMPLETED ${out}`);
}
main().catch(error => { atomicJson(out, { ...initial, status: aborted ? "ABORTED" : "ERROR", error: String(error), elapsedMs: Date.now() - started }); console.error(error); process.exitCode = aborted ? 130 : 1; });
