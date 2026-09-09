import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ARTIFACT = path.join(ROOT, "artifacts", "production-chain-result.json");

const SUITES = [
  "tests/trade-decision-core-production-bridge.test.ts",
  "tests/settlement-reconciliation.integration.test.ts",
  "tests/fix02-durable-exit-and-settlement.integration.test.ts",
  "tests/final-engineering-production-chain.integration.test.ts",
];

function main() {
  let passed = false;
  let output = "";
  try {
    output = execSync(`npm run test:run -- ${SUITES.join(" ")}`, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        LIVE_TRADING_ENABLED: "false",
        LIVE_AUTHORIZATION: "DISABLED",
        TRADE_DECISION_CORE_ENABLED: "false",
      },
    });
    passed = true;
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    output = `${err.stdout ?? ""}\n${err.stderr ?? ""}`.trim();
  }

  const payload = {
    task: "DEVAM_GOREVI_1_3_PRODUCTION_CHAIN",
    verifiedAt: new Date().toISOString(),
    liveTradingEnabled: false,
    liveAuthorization: "DISABLED",
    tradeDecisionCoreEnabled: false,
    verifiedChain:
      "scanner/selection → fix01 evaluator+router → execution-orchestrator → paper/live order → bootstrapExitPersistenceAtEntry → position monitor → fix02 exit routing → canonical-settlement-fill → post-trade-settlement",
    wirePoints: [
      "execution-orchestrator.service.ts:applyTradeDecisionCoreProductionBridge",
      "execution-orchestrator.service.ts:signalIdempotencyKey claim before order-submit",
      "fix01-selected-signal → bootstrapExitPersistenceAtEntry → fix02-exit-reconciliation",
    ],
    testResults: SUITES.map((file) => ({
      file,
      status: passed ? "PASS" : output.includes(file) && /FAIL|failed/i.test(output) ? "FAIL" : passed ? "PASS" : "UNKNOWN",
    })),
    overallStatus: passed ? "PASS" : "FAIL",
    blockers: passed ? [] : ["production chain vitest batch failed — see test output"],
    testOutputTail: output.split("\n").slice(-40).join("\n"),
  };

  if (passed) {
    payload.testResults = SUITES.map((file) => ({ file, status: "PASS" }));
  }

  mkdirSync(path.dirname(ARTIFACT), { recursive: true });
  writeFileSync(ARTIFACT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(payload, null, 2));
  if (!passed) process.exitCode = 1;
}

main();
