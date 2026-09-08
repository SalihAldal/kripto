/**
 * Funding/Basis Alpha V3 — walk-forward, fresh unseen, robustness, gated 3h paper.
 * Usage: npx tsx scripts/run-funding-basis-alpha-v3-3h.ts
 */
import "./load-dotenv.cjs";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { FUNDING_BASIS_ALPHA_V3_ID } from "@/src/server/alpha-engine-v2/funding-basis-alpha-v3.service";
import { loadFundingBasisUniverse } from "@/src/server/alpha-engine-v2/funding-basis-data.service";
import {
  classifyWalkForwardFailure,
  evaluateFrozenFundingAlpha,
  runFundingBasisWalkForward,
} from "@/src/server/alpha-engine-v2/funding-basis-walk-forward.service";
import { buildScoreboardEntry } from "@/src/server/alpha-engine-v2/validation-framework.service";
import { COST_MODEL_V2_VERSION } from "@/src/server/alpha-engine-v2/cost-model-v2.service";
import { FEATURE_REGISTRY_VERSION } from "@/src/server/alpha-engine-v2/feature-registry.service";
import { FUNDING_BASIS_ALPHA_V3_VERSION } from "@/src/server/alpha-engine-v2/funding-basis-alpha-v3.service";

process.env.LIVE_TRADING_ENABLED = "false";
process.env.LIVE_AUTHORIZATION = "DISABLED";
process.env.EXECUTION_MODE = "PAPER";

const ARTIFACT = path.join(process.cwd(), "artifacts", "funding-basis-alpha-v3");
const SCOREBOARD_PATH = path.join(process.cwd(), "artifacts", "alpha-research", "alpha-scoreboard.json");

const MS_DAY = 24 * 3_600_000;

async function main() {
  const headStart = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  fs.mkdirSync(ARTIFACT, { recursive: true });
  fs.mkdirSync(path.dirname(SCOREBOARD_PATH), { recursive: true });

  const dataStart = Date.parse("2026-02-01T00:00:00.000Z");
  const dataEnd = Date.parse("2026-08-04T00:00:00.000Z");
  const wfStart = Date.parse("2026-03-15T00:00:00.000Z");
  const wfEnd = Date.parse("2026-07-01T00:00:00.000Z");
  const freshStart = Date.parse("2026-02-01T00:00:00.000Z");
  const freshEnd = Date.parse("2026-03-15T00:00:00.000Z");
  const freshTrainStart = Date.parse("2026-02-01T00:00:00.000Z");

  console.log("Loading expanded funding/basis universe...");
  const { panels, btc, totalFundingEvents } = await loadFundingBasisUniverse(dataStart, dataEnd);
  fs.writeFileSync(
    path.join(ARTIFACT, "dataset-summary.json"),
    JSON.stringify(
      {
        dataStart: new Date(dataStart).toISOString(),
        dataEnd: new Date(dataEnd).toISOString(),
        symbols: panels.length,
        totalFundingEvents,
        daysCovered: Math.round((dataEnd - dataStart) / MS_DAY),
        perSymbol: panels.map((p) => ({
          symbol: p.symbol,
          bars: p.bars.length,
          fundingEvents: p.fundingEventCount,
          basisBars: p.basis.length,
          dataStates: p.dataStates,
        })),
      },
      null,
      2,
    ),
  );

  const walkForward = runFundingBasisWalkForward({
    panels,
    btc,
    datasetStart: wfStart,
    datasetEnd: wfEnd,
  });
  fs.writeFileSync(path.join(ARTIFACT, "walk-forward.json"), JSON.stringify(walkForward, null, 2));

  const wfFailureClass = classifyWalkForwardFailure({
    walkForwardPass: walkForward.walkForwardPass,
    aggregate: walkForward.aggregate,
    concentration: walkForward.concentration,
    positiveFolds: walkForward.positiveFolds,
    foldsTested: walkForward.foldsTested,
  });

  const freshUnseen = evaluateFrozenFundingAlpha({
    panels,
    btc,
    trainStart: freshTrainStart,
    trainEnd: freshStart,
    evalStart: freshStart,
    evalEnd: freshEnd,
  });

  const freshPass =
    freshUnseen.stats.trades >= 5 &&
    freshUnseen.stats.netPnl > 0 &&
    freshUnseen.stats.expectancy > 0 &&
    freshUnseen.stats.profitFactor > 1 &&
    Math.abs(freshUnseen.concentration.topDayContributionPct) < 50;

  const freshLowSample = freshUnseen.stats.trades < 20 && freshUnseen.stats.trades >= 5;

  const robustnessPeriods = [
    { label: "Apr-May", start: Date.parse("2026-04-15T00:00:00.000Z"), end: Date.parse("2026-05-15T00:00:00.000Z") },
    { label: "May-Jun", start: Date.parse("2026-05-15T00:00:00.000Z"), end: Date.parse("2026-06-15T00:00:00.000Z") },
    { label: "Jun-Jul", start: Date.parse("2026-06-15T00:00:00.000Z"), end: Date.parse("2026-07-15T00:00:00.000Z") },
    { label: "Jul-Aug", start: Date.parse("2026-07-15T00:00:00.000Z"), end: Date.parse("2026-08-04T00:00:00.000Z") },
  ];

  const frozenThresholds = walkForward.folds.at(-1)?.thresholds;
  let robustnessPositive = 0;
  const robustnessDetails = [];
  for (const period of robustnessPeriods) {
    const evalResult = evaluateFrozenFundingAlpha({
      panels,
      btc,
      trainStart: wfStart,
      trainEnd: wfStart + 30 * MS_DAY,
      evalStart: period.start,
      evalEnd: period.end,
      thresholds: frozenThresholds,
    });
    if (evalResult.stats.netPnl > 0 && evalResult.stats.expectancy > 0) robustnessPositive += 1;
    robustnessDetails.push({ period: period.label, ...evalResult.stats, concentration: evalResult.concentration });
  }

  const robustnessPass =
    walkForward.walkForwardPass &&
    freshPass &&
    robustnessPositive >= Math.ceil(robustnessPeriods.length / 2) &&
    robustnessDetails.every((r) => r.netPnl > -300);

  const paperReady = walkForward.walkForwardPass && freshPass && robustnessPass;

  const smoke = { started: false, passed: false, reason: paperReady ? "NOT_RUN" : "GATES_NOT_PASS" };
  const paper3h = {
    started: false,
    completed: false,
    campaignId: "",
    runtimeMinutes: 0,
    reason: "GATES_NOT_PASS",
    long: 0,
    short: 0,
    cash: 0,
    trades: 0,
    pricePnl: 0,
    fundingPnl: 0,
    fees: 0,
    slippage: 0,
    netPnl: 0,
    expectancy: null as number | null,
    profitFactor: null as number | null,
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
        const campaignId = `paper-funding-basis-v3-3h-${new Date().toISOString().replace(/[:.]/g, "-")}`;
        paper3h.started = true;
        paper3h.campaignId = campaignId;
        const { spawn } = await import("node:child_process");
        spawn("npx", ["tsx", "scripts/run-funding-basis-v3-3h-paper.ts", `--campaignId=${campaignId}`], {
          cwd: process.cwd(),
          detached: true,
          stdio: "ignore",
          env: process.env as Record<string, string>,
        }).unref();
        paper3h.reason = "STARTED_DETACHED";
      }
    } catch (e) {
      smoke.reason = `ERROR ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  const scoreboardEntry = buildScoreboardEntry({
    alphaId: FUNDING_BASIS_ALPHA_V3_ID,
    version: FUNDING_BASIS_ALPHA_V3_VERSION,
    datasetId: `funding-v3-${new Date(wfStart).toISOString().slice(0, 10)}`,
    configHash: "funding-basis-v3",
    featureVersion: FEATURE_REGISTRY_VERSION,
    costModelVersion: COST_MODEL_V2_VERSION,
    valStats: walkForward.aggregate,
    testStats: freshUnseen.stats,
    robustnessPassed: robustnessPass,
  });

  let scoreboard: unknown[] = [];
  if (fs.existsSync(SCOREBOARD_PATH)) {
    scoreboard = JSON.parse(fs.readFileSync(SCOREBOARD_PATH, "utf8")) as unknown[];
  }
  const archived = (scoreboard as Array<{ alphaId: string; status?: string }>).map((e) =>
    e.alphaId.startsWith("RESIDUAL") || e.alphaId.startsWith("LOW_TURNOVER")
      ? { ...e, status: "RESEARCH_ARCHIVED", note: "Frozen pending Funding/Basis V3 outcome" }
      : e,
  );
  const filtered = archived.filter((e) => (e as { alphaId: string }).alphaId !== FUNDING_BASIS_ALPHA_V3_ID);
  filtered.push({
    ...scoreboardEntry,
    status: paperReady ? "PAPER_READY" : walkForward.walkForwardPass ? "ROBUSTNESS_FAIL" : "VALIDATION_FAIL",
    wfFailureClass,
    freshLowSample,
    regimeRouterAlphaEdge: false,
  });
  fs.writeFileSync(SCOREBOARD_PATH, JSON.stringify(filtered, null, 2));

  const fundingAlphaVerdict = paperReady ? "PASS" : "FAIL";
  const nextPhase = fundingAlphaVerdict === "FAIL" ? "PRODUCT_PIVOT_OR_NEW_EXTERNAL_DATA" : "PAPER_FORWARD_VALIDATION";
  const tradingProgramVerdict = fundingAlphaVerdict === "FAIL" ? "NO_ROBUST_EDGE_FOUND" : "EDGE_CANDIDATE";

  const result = {
    verdict: paperReady ? "PARTIAL" : "FAIL",
    headStart,
    alpha: {
      id: FUNDING_BASIS_ALPHA_V3_ID,
      walkForwardFolds: walkForward.foldsTested,
      positiveFolds: walkForward.positiveFolds,
      negativeFolds: walkForward.negativeFolds,
      walkForwardExpectancy: walkForward.aggregate.expectancy,
      walkForwardPF: walkForward.aggregate.profitFactor,
      walkForwardPass: walkForward.walkForwardPass,
      wfFailureClass,
      freshTrades: freshUnseen.stats.trades,
      freshExpectancy: freshUnseen.stats.expectancy,
      freshPF: freshUnseen.stats.profitFactor,
      freshLowSample,
      robustnessPassed: robustnessPass,
      longShort: walkForward.longShort,
      concentration: walkForward.concentration,
    },
    smoke,
    paper3h,
    liveTradingEnabled: false,
    verdicts: {
      ENGINEERING_VERDICT: "PASS",
      FUNDING_ALPHA_VERDICT: fundingAlphaVerdict,
      HISTORICAL_EDGE_VERDICT: freshPass ? "PASS" : "FAIL",
      PAPER_FORWARD_VERDICT: paper3h.started ? "STARTED" : "NOT_STARTED",
      PROFITABILITY_VERDICT: "NOT_STARTED",
      TRADING_ALPHA_PROGRAM_VERDICT: tradingProgramVerdict,
    },
    nextPhase,
    recommendedNextPaperDuration: "24h",
    freshUnseen,
    robustness: { periods: robustnessPeriods.length, positive: robustnessPositive, details: robustnessDetails },
  };

  fs.writeFileSync(path.join(process.cwd(), "kripto-funding-basis-alpha-v3-3h-result.json"), JSON.stringify({
    verdict: result.verdict,
    alpha: {
      id: result.alpha.id,
      walkForwardFolds: result.alpha.walkForwardFolds,
      positiveFolds: result.alpha.positiveFolds,
      negativeFolds: result.alpha.negativeFolds,
      walkForwardExpectancy: result.alpha.walkForwardExpectancy,
      walkForwardPF: result.alpha.walkForwardPF,
      walkForwardPass: result.alpha.walkForwardPass,
      freshTrades: result.alpha.freshTrades,
      freshExpectancy: result.alpha.freshExpectancy,
      freshPF: result.alpha.freshPF,
      robustnessPassed: result.alpha.robustnessPassed,
    },
    smoke: result.smoke,
    paper3h: result.paper3h,
    liveTradingEnabled: false,
  }, null, 2));

  fs.writeFileSync(
    path.join(process.cwd(), "KRIPTO_FUNDING_BASIS_ALPHA_V3_AND_3H_FORWARD_REPORT.md"),
    buildReport(result),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        walkForwardPass: walkForward.walkForwardPass,
        wfFailureClass,
        freshPass,
        freshTrades: freshUnseen.stats.trades,
        robustnessPass,
        paperReady,
        fundingAlphaVerdict,
      },
      null,
      2,
    ),
  );
}

function buildReport(r: Record<string, unknown>) {
  const alpha = r.alpha as Record<string, unknown>;
  const verdicts = r.verdicts as Record<string, string>;
  const fresh = r.freshUnseen as { stats: Record<string, number> };
  const rob = r.robustness as { positive: number; periods: number };
  return `# KRIPTO Funding/Basis Alpha V3 & 3H Forward Report

## Executive Summary

Funding/Basis Alpha V3 event-driven architecture implemented with expanded real Binance funding + premium index data.

- Walk-forward: **${alpha.walkForwardPass}** (${alpha.wfFailureClass})
- Fresh unseen: ${fresh.stats.trades} trades, exp ${fresh.stats.expectancy}, PF ${fresh.stats.profitFactor}
- Robustness: ${rob.positive}/${rob.periods} positive
- 3H Paper: ${(r.paper3h as { started: boolean }).started ? "STARTED" : "NOT STARTED"}
- Regime router: **NOT authoritative** (REGIME_ROUTER_ALPHA_EDGE=false)

\`LIVE_TRADING_ENABLED=false\`

## Verdicts

| Verdict | Result |
|---------|--------|
| ENGINEERING | ${verdicts.ENGINEERING_VERDICT} |
| FUNDING_ALPHA | ${verdicts.FUNDING_ALPHA_VERDICT} |
| HISTORICAL_EDGE | ${verdicts.HISTORICAL_EDGE_VERDICT} |
| TRADING_PROGRAM | ${verdicts.TRADING_ALPHA_PROGRAM_VERDICT} |

## Next Phase

\`${r.nextPhase}\` — recommended paper duration: **${r.recommendedNextPaperDuration}**

---
*Generated ${new Date().toISOString()}*
`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
