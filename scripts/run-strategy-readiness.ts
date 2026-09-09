import "./load-dotenv.cjs";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { atomicJson, sourceFingerprint } from "./strategy-evidence-io";
import { classifyPaperCampaign } from "../src/server/trade-decision-core/paper-readiness-status.service";
const root = path.resolve("artifacts/strategy-readiness"), result = path.join(root, "result.json");
const initial = { status: "RUNNING", ENGINEERING_STATUS: "BLOCKED", STRATEGY_STATUS: "BLOCKED", PAPER_STATUS: "BLOCKED", LIVE_STATUS: "DISABLED" };
let active: ChildProcess | null = null, aborted = false;
fs.mkdirSync(root, { recursive: true }); atomicJson(result, initial);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { aborted = true; active?.kill("SIGTERM"); atomicJson(result, { ...initial, status: "ABORTED" }); });
const suites = ["paper-supervision-runner", "paper-db-schema", "forensics/paper-preflight", "learning-research-integrity", "scanner-subscription-lease", "phase02-realtime-market-spine", "leveraged-token-symbol", "minute-expansion", "pump-scan-scheduler", "opportunity-capture", "pr04-fee-risk-accounting", "local-confirmed-entry", "disposable-postgres-target", "try-replay-correctness", "strategy-window-matrix", "strategy-validation-evidence", "trade-decision-core-parity", "trade-decision-core-production-bridge", "oi-try-spot-audited", "oi-impulse-alpha-v2", "pr04-exit-and-position-management"];
async function step(name: string, args: string[], timeoutMs = 30 * 60000) {
    if (aborted) throw new Error("ABORTED");
    console.log(`START ${name}`);
    const log = path.join(root, `${name}.log`), fd = fs.openSync(log, "w"), started = Date.now();
    let timedOut = false;
    const code = await new Promise<number>((resolve, reject) => {
        active = spawn(process.execPath, args, { stdio: ["ignore", fd, fd], env: { ...process.env, EXECUTION_MODE: "paper", LIVE_TRADING_ENABLED: "false", LIVE_AUTHORIZATION: "DISABLED", TRADE_DECISION_CORE_ENABLED: "false" } });
        const child = active;
        let force: ReturnType<typeof setTimeout> | undefined;
        const timeout = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); force = setTimeout(() => child.kill("SIGKILL"), 10000); }, timeoutMs);
        child.on("error", error => { clearTimeout(timeout); if (force) clearTimeout(force); fs.closeSync(fd); reject(error); });
        child.on("close", code => { clearTimeout(timeout); if (force) clearTimeout(force); if (!child.pid) return; fs.closeSync(fd); active = null; resolve(code ?? 1); });
    });
    if (aborted) throw new Error("ABORTED");
    const row = { name, status: code === 0 && !timedOut ? "PASS" : "FAIL", exitCode: code, timedOut, elapsedMs: Date.now() - started, log: path.relative(process.cwd(), log) };
    console.log(`${row.status} ${name}`); return row;
}
async function postgresReachable() {
    let url: URL;
    try { url = new URL(process.env.FIX02_PG_ADMIN_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/postgres"); } catch { return false; }
    if (!["postgres:", "postgresql:"].includes(url.protocol)) return false;
    return new Promise<boolean>(resolve => {
        const socket = net.createConnection({ host: url.hostname, port: Number(url.port || 5432) });
        const finish = (ok: boolean) => { socket.destroy(); resolve(ok); };
        socket.setTimeout(2000, () => finish(false)); socket.once("error", () => finish(false)); socket.once("connect", () => finish(true));
    });
}
async function main() {
    const sourceHash = sourceFingerprint(), started = Date.now(), steps = [];
    for (const [name, args] of [
        ["unit-tests", ["node_modules/vitest/vitest.mjs", "run", ...suites.map(s => `tests/${s}.test.ts`)]],
        ["app-typecheck", ["node_modules/typescript/bin/tsc", "--noEmit", "--incremental", "false", "-p", "tsconfig.json"]],
        ["strategy-typecheck", ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "tsconfig.strategy-tools.json"]],
    ] as Array<[string, string[]]>) {
        const row = await step(name, args); steps.push(row);
        if (row.status !== "PASS") throw new Error(`ENGINEERING_GATE:${name}`);
    }
    for (const [name, script, args] of [
        ["baseline-validation", "scripts/run-strategy-validation.ts", []],
        ["research-validation", "scripts/run-strategy-validation.ts", ["--research"]],
        ["window-matrix", "scripts/run-strategy-window-matrix.ts", []],
    ] as Array<[string, string, string[]]>) {
        const row = await step(name, ["--max-old-space-size=4096", "--import", "tsx", script, ...args]); steps.push(row);
        if (row.status !== "PASS") throw new Error(`VALIDATION_RUN_FAILED:${name}`);
    }
    const load = (file: string) => JSON.parse(fs.readFileSync(path.resolve("artifacts", file), "utf8"));
    const baseline = load("strategy-validation-result.json"), research = load("strategy-research-result.json"), windows = load("strategy-window-matrix.json");
    for (const evidence of [baseline, research, windows]) if (evidence.status !== "COMPLETED" || evidence.sourceHash !== sourceHash) throw new Error("STALE_OR_INCOMPLETE_EVIDENCE");
    let productionChainStatus = "BLOCKED_POSTGRES_UNAVAILABLE";
    if (await postgresReachable()) {
        const row = await step("production-chain", ["--import", "tsx", "scripts/run-production-chain-verify.ts"]); steps.push(row); productionChainStatus = row.status;
    }
    let paperStatus = "BLOCKED_STRATEGY";
    if (baseline.STRATEGY_VALIDATION_STATUS === "PASS" && baseline.paperEligible) {
        paperStatus = "BLOCKED_PRODUCTION_CHAIN";
        if (productionChainStatus === "PASS") {
            const row = await step("paper-smoke", ["--import", "tsx", "scripts/run-strategy-paper-smoke.ts"], 35 * 60000); steps.push(row);
            paperStatus = row.status === "PASS" ? classifyPaperCampaign(load("strategy-paper-smoke-result.json").result) : "FAILED";
        }
    }
    if (sourceFingerprint() !== sourceHash || aborted) throw new Error(aborted ? "ABORTED" : "SOURCE_CHANGED_DURING_RUN");
    atomicJson(result, { ...initial, status: "COMPLETED", generatedAt: new Date().toISOString(), sourceHash, steps, UNIT_AND_TYPECHECK_STATUS: "PASS", ENGINEERING_STATUS: productionChainStatus === "PASS" ? "PASS" : "PARTIAL",
        PRODUCTION_CHAIN_STATUS: productionChainStatus, STRATEGY_STATUS: baseline.STRATEGY_VALIDATION_STATUS, RESEARCH_STATUS: research.RESEARCH_VALIDATION_STATUS,
        PAPER_STATUS: paperStatus, paperEligible: baseline.paperEligible, elapsedMs: Date.now() - started, windowRuns: windows.rows.length,
        automaticLivePromotion: false, researchCanPromote: false, limitations: ["HISTORICAL_DATA_ALREADY_SEEN", "UNVERIFIED_ACCOUNT_COST_ASSUMPTIONS", "BAR_CLOSE_EXECUTION_APPROXIMATION"] });
    console.log(`COMPLETED ${result}; strategy=${baseline.STRATEGY_VALIDATION_STATUS}, paper=${paperStatus}, production=${productionChainStatus}`);
    if (baseline.STRATEGY_VALIDATION_STATUS !== "PASS" || productionChainStatus !== "PASS" || paperStatus !== "COMPLETED_WITH_ACTIVITY_NOT_PROFITABILITY_PROOF") process.exitCode = 2;
}
main().catch(error => { atomicJson(result, { ...initial, status: aborted ? "ABORTED" : "ERROR", error: String(error) }); console.error(error); process.exitCode = aborted ? 130 : 1; });
