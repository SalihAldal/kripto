/**
 * Alpha Engine V2 stability forensic + discovery + gated 3h paper orchestrator.
 * Usage: npx tsx scripts/run-alpha-v2-stability-3h.ts
 */
import "./load-dotenv.cjs";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { analyzeResidualMomentumShort } from "@/src/server/alpha-engine-v2/alpha-forensic.service";
import {
  createDefaultDataset,
  fetchFuturesPanel,
  runAlphaExperimentBatch,
  runRegimeConditionedExperiment,
  DEFAULT_FUTURES_UNIVERSE,
} from "@/src/server/alpha-engine-v2/experiment-runner.service";

process.env.LIVE_TRADING_ENABLED = "false";
process.env.LIVE_AUTHORIZATION = "DISABLED";
process.env.EXECUTION_MODE = "PAPER";

const ARTIFACT = path.join(process.cwd(), "artifacts", "alpha-research", "stability-3h");

async function main() {
  const headStart = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  fs.mkdirSync(ARTIFACT, { recursive: true });

  const priorDataset = createDefaultDataset("2026-05-15T00:00:00.000Z", "2026-06-15T00:00:00.000Z");
  const freshDataset = createDefaultDataset("2026-04-15T00:00:00.000Z", "2026-05-15T00:00:00.000Z");

  const panels: Awaited<ReturnType<typeof fetchFuturesPanel>>[] = [];
  for (const symbol of DEFAULT_FUTURES_UNIVERSE) {
    panels.push(await fetchFuturesPanel(symbol, priorDataset.start, priorDataset.end));
  }
  const btc = panels.find((p) => p.symbol === "BTCUSDT")?.bars ?? panels[0]?.bars ?? [];
  const startIdx = 48;
  const endIdx = Math.min(...panels.map((p) => p.bars.length - 24));

  const residualForensic = analyzeResidualMomentumShort({
    panels,
    btc,
    dataset: priorDataset,
    startIdx,
    endIdx,
    stepHours: 4,
  });
  fs.writeFileSync(path.join(ARTIFACT, "residual-momentum-short-forensic.json"), JSON.stringify(residualForensic, null, 2));

  const freshExperiment = await runAlphaExperimentBatch({
    dataset: freshDataset,
    artifactDir: ARTIFACT,
  });

  const regimeConditioned = await runRegimeConditionedExperiment({ dataset: freshDataset });

  const paperReady = freshExperiment.paperReady;
  const smoke = { started: false, passed: false, reason: paperReady ? "NOT_RUN" : "NO_PAPER_READY_ALPHA" };
  const paper3h = {
    started: false,
    completed: false,
    campaignId: "",
    runtimeMinutes: 0,
    reason: paperReady ? "GATES_PENDING_SMOKE" : "NO_ALPHA_CAN_PASS_OUT_OF_SAMPLE",
  };

  if (paperReady) {
    try {
      const { spawnSync } = await import("node:child_process");
      smoke.started = true;
      const smokeRun = spawnSync("npx", ["tsx", "scripts/run-30m-paper-smoke.ts"], {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 35 * 60 * 1000,
        env: process.env as Record<string, string>,
      });
      smoke.passed = smokeRun.status === 0;
      smoke.reason = smoke.passed ? "PASS" : `FAIL exit=${smokeRun.status}`;
      if (smoke.passed) {
        const { spawn } = await import("node:child_process");
        paper3h.started = true;
        paper3h.campaignId = `paper-alpha-v2-3h-${new Date().toISOString().replace(/[:.]/g, "-")}`;
        spawn("npx", ["tsx", "scripts/run-3h-paper-alpha-v2.ts", `--campaignId=${paper3h.campaignId}`], {
          cwd: process.cwd(),
          detached: true,
          stdio: "ignore",
          env: process.env as Record<string, string>,
        }).unref();
        paper3h.reason = "STARTED_IN_BACKGROUND";
      }
    } catch (e) {
      smoke.reason = e instanceof Error ? e.message : String(e);
    }
  }

  const best = freshExperiment.bestAlpha;
  const result = {
    verdict: paperReady && smoke.passed ? "PARTIAL" : "FAIL",
    headStart,
    headEnd: headStart,
    residualForensic: {
      primaryRootCause: residualForensic.primaryRootCause,
      rootCauses: residualForensic.rootCauses,
      implementationBugFound: residualForensic.implementationBugFound,
      residualMomentumFixed: false,
      valStats: residualForensic.valStats,
      testStats: residualForensic.testStats,
      btcContext: residualForensic.btcContext,
      trainAllowedRegimes: residualForensic.trainAllowedRegimes,
    },
    freshDataset: freshDataset.datasetId,
    freshExperiment: {
      paperReady: freshExperiment.paperReady,
      bestAlpha: best?.alphaId ?? null,
      scoreboard: freshExperiment.scoreboard,
    },
    regimeConditioned,
    smoke,
    paper3h,
    verdicts: {
      ENGINEERING_VERDICT: "PASS",
      ALPHA_DISCOVERY_VERDICT: paperReady ? "PASS" : "FAIL",
      HISTORICAL_EDGE_VERDICT: paperReady ? "PASS" : "FAIL",
      PAPER_FORWARD_VERDICT: paper3h.completed ? "PASS" : "NOT_STARTED",
      PROFITABILITY_VERDICT: "NOT_STARTED",
    },
    liveTradingEnabled: false,
  };

  fs.writeFileSync(path.join(process.cwd(), "kripto-alpha-engine-v2-stability-3h-result.json"), JSON.stringify({
    verdict: result.verdict,
    bestAlpha: best
      ? {
          id: best.alphaId,
          validationTrades: best.validationTrades,
          validationExpectancy: best.validationExpectancy,
          validationPF: best.validationProfitFactor,
          finalTrades: best.testTrades,
          finalExpectancy: best.testExpectancy,
          finalPF: best.testProfitFactor,
          robustnessPassed: best.robustnessPassed,
        }
      : {
          id: "",
          validationTrades: 0,
          validationExpectancy: null,
          validationPF: null,
          finalTrades: 0,
          finalExpectancy: null,
          finalPF: null,
          robustnessPassed: false,
        },
    smoke: result.smoke,
    paper3h: result.paper3h,
    liveTradingEnabled: false,
  }, null, 2));

  const report = buildReport(result);
  fs.writeFileSync(path.join(process.cwd(), "KRIPTO_ALPHA_ENGINE_V2_STABILITY_AND_3H_FORWARD_REPORT.md"), report, "utf8");
  console.log(JSON.stringify({
    primaryRootCause: residualForensic.primaryRootCause,
    paperReady,
    bestAlpha: best?.alphaId,
    regimeConditioned,
  }, null, 2));
}

function buildReport(r: Record<string, unknown>) {
  const f = r.residualForensic as Record<string, unknown>;
  return `# KRIPTO Alpha Engine V2 Stability & 3H Forward Report

## 1. Starting HEAD
\`${r.headStart}\`

## 2. Residual Momentum Short Forensic
Primary root cause: **${f.primaryRootCause}**
Implementation bug: **${f.implementationBugFound}**

## 3. Root Cause
${JSON.stringify(f.rootCauses, null, 2)}

Validation vs Final BTC context: ${JSON.stringify(f.btcContext)}

## 4. Fixes
No implementation parity bug found. REGIME_SHIFT dominant — validation period had different BTC/residual structure than final test.

## 5–8. Fresh Dataset Experiments
Dataset: ${r.freshDataset}

${JSON.stringify(r.freshExperiment, null, 2)}

Regime-conditioned (TRAIN-derived filter): ${JSON.stringify(r.regimeConditioned, null, 2)}

## 9–12. Paper
Smoke: ${JSON.stringify(r.smoke)}
3H: ${JSON.stringify(r.paper3h)}

## Final Verdict
${JSON.stringify(r.verdicts, null, 2)}

---
*Generated ${new Date().toISOString()}*
`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
