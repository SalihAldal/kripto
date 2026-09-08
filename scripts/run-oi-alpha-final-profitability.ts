/**
 * OI Impulse Alpha final profitability program.
 * Usage: npx tsx scripts/run-oi-alpha-final-profitability.ts
 */
import "./load-dotenv.cjs";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { aggregateQaSummary, runExternalDataQa } from "@/src/server/alpha-engine-v2/external-data-qa.service";
import {
  loadDeepOiPanels,
  measureOiCoverageDays,
  resolveDeepHistoricalProvider,
} from "@/src/server/alpha-engine-v2/deep-historical-providers.service";
import { buildOiStateMatrix } from "@/src/server/alpha-engine-v2/oi-features.service";
import { OI_IMPULSE_V1_CONTRACT } from "@/src/server/alpha-engine-v2/oi-impulse-alpha-v2.service";
import {
  evaluateOiFreshUnseen,
  runCostSensitivity,
  runOiImpulseWalkForward,
} from "@/src/server/alpha-engine-v2/oi-alpha-walk-forward.service";

process.env.LIVE_TRADING_ENABLED = "false";
process.env.LIVE_AUTHORIZATION = "DISABLED";
process.env.EXECUTION_MODE = "PAPER";

const ARTIFACT = path.join(process.cwd(), "artifacts", "oi-alpha-final");
const UNIVERSE = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "SUIUSDT"];
const MS_DAY = 24 * 3_600_000;
const MIN_OI_DAYS = 120;

async function main() {
  const headStart = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  fs.mkdirSync(ARTIFACT, { recursive: true });

  const resolution = resolveDeepHistoricalProvider();
  const dataEnd = Date.now();
  const dataStart = dataEnd - 365 * MS_DAY;
  const dataDir = process.env.DEEP_OI_DATA_DIR ?? path.join(process.cwd(), "artifacts", "deep-oi-data");

  console.log(`Provider: ${resolution.providerName} (credential=${resolution.credentialPresent})`);

  const probePanels = await loadDeepOiPanels({
    provider: resolution.provider,
    symbols: ["BTCUSDT"],
    start: dataStart,
    end: dataEnd,
    dataDir,
  });
  const oiCoverage = measureOiCoverageDays(probePanels);
  const deepDataGatePass = oiCoverage.minDays >= MIN_OI_DAYS;
  const blocker = deepDataGatePass ? null : resolution.blocker ?? "DEEP_HISTORICAL_OI_DATA_REQUIRED";

  let panels = probePanels;
  if (deepDataGatePass) {
    console.log("Loading full universe...");
    panels = await loadDeepOiPanels({ provider: resolution.provider, symbols: UNIVERSE, start: dataStart, end: dataEnd, dataDir });
  } else {
    console.log(`DEEP_DATA_GATE=FAIL (OI min ${oiCoverage.minDays}d < ${MIN_OI_DAYS}d)`);
    panels = await loadDeepOiPanels({
      provider: resolution.provider,
      symbols: UNIVERSE,
      start: dataEnd - 30 * MS_DAY,
      end: dataEnd,
      dataDir,
    });
  }

  const qaReports = panels.flatMap((p) => runExternalDataQa(p, panels[0]?.bars[0]?.openTime ?? dataStart, dataEnd));
  const qaSummary = aggregateQaSummary(qaReports);
  const stateMatrix = panels.slice(0, 3).map((p) => ({ symbol: p.symbol, matrix: buildOiStateMatrix(p) }));

  const freshDays = 45;
  const freshStart = dataEnd - freshDays * MS_DAY;
  const wfEnd = freshStart;
  const wfStart = deepDataGatePass ? dataStart : dataEnd - 30 * MS_DAY;

  const candidates = [
    { alphaId: "OI_IMPULSE_LONG" as const, variant: undefined },
    { alphaId: "OI_IMPULSE_LONG_V2" as const, variant: "OI_ONLY" as const },
    { alphaId: "OI_IMPULSE_LONG_V2_FUNDING" as const, variant: "OI_FUNDING" as const },
    { alphaId: "OI_IMPULSE_SHORT_V2" as const, variant: "OI_ONLY" as const },
  ];

  const wfResults = candidates.map((c) =>
    runOiImpulseWalkForward({
      alphaId: c.alphaId,
      panels,
      wfStart,
      wfEnd,
      freshCutoff: freshStart,
      variant: c.variant,
      trainDays: deepDataGatePass ? 45 : 7,
      valDays: deepDataGatePass ? 15 : 7,
      rollDays: deepDataGatePass ? 15 : 7,
    }),
  );
  fs.writeFileSync(path.join(ARTIFACT, "walk-forward.json"), JSON.stringify(wfResults, null, 2));

  const bestWf = [...wfResults].sort((a, b) => b.aggregate.expectancy - a.aggregate.expectancy)[0];
  const paperReady = deepDataGatePass && Boolean(bestWf?.walkForwardPass);

  let fresh = null;
  let freshPass = false;
  let robustness = { periods: 0, positive: 0, details: [] as Array<Record<string, unknown>> };
  let costSensitivity: Array<Record<string, unknown>> = [];

  if (paperReady && bestWf) {
    fresh = evaluateOiFreshUnseen({
      alphaId: bestWf.alphaId,
      panels,
      freshStart,
      freshEnd: dataEnd,
      variant: bestWf.variant,
    });
    freshPass = fresh.pass;
    costSensitivity = runCostSensitivity({
      alphaId: bestWf.alphaId,
      panels,
      start: wfStart,
      end: wfEnd,
      variant: bestWf.variant,
    });
    const periods = [
      { label: "p1", start: dataEnd - 90 * MS_DAY, end: dataEnd - 60 * MS_DAY },
      { label: "p2", start: dataEnd - 60 * MS_DAY, end: dataEnd - 30 * MS_DAY },
    ];
    let pos = 0;
    for (const p of periods) {
      const r = evaluateOiFreshUnseen({ alphaId: bestWf.alphaId, panels, freshStart: p.start, freshEnd: p.end, variant: bestWf.variant });
      if (r.stats.netPnl > 0 && r.stats.expectancy > 0) pos += 1;
      robustness.details.push({ period: p.label, ...r.stats });
    }
    robustness = { periods: periods.length, positive: pos, details: robustness.details };
  }

  const smoke = { started: false, passed: false, reason: paperReady && freshPass ? "NOT_RUN" : "GATES_NOT_PASS" };
  const paper3h = { started: false, completed: false, campaignId: "", runtimeMinutes: 0, reason: "GATES_NOT_PASS" };

  const result = {
    verdict: paperReady && freshPass ? "PARTIAL" : "FAIL",
    headStart,
    blocker,
    deepDataGatePass,
    provider: resolution.providerName,
    credentialPresent: resolution.credentialPresent,
    dataset: { start: new Date(dataStart).toISOString(), end: new Date(dataEnd).toISOString(), symbols: panels.length, oiCoverageDays: oiCoverage },
    coverage: {
      oi: oiCoverage.avgDays,
      funding: qaSummary.find((s) => s.kind === "FUNDING")?.avgCoveragePct ?? 0,
      basis: qaSummary.find((s) => s.kind === "BASIS")?.avgCoveragePct ?? 0,
      aggTrades: qaSummary.find((s) => s.kind === "AGG_TRADES")?.avgCoveragePct ?? 0,
    },
    v1Contract: OI_IMPULSE_V1_CONTRACT,
    stateMatrix,
    wfResults: wfResults.map((r) => ({
      alphaId: r.alphaId,
      variant: r.variant,
      walkForwardPass: r.walkForwardPass,
      failReasons: r.failReasons,
      folds: r.foldsTested,
      positive: r.positiveFolds,
      trades: r.aggregate.trades,
      expectancy: r.aggregate.expectancy,
      profitFactor: r.aggregate.profitFactor,
      concentration: r.concentration,
    })),
    bestAlpha: bestWf
      ? { id: bestWf.alphaId, variant: bestWf.variant, walkForwardPass: bestWf.walkForwardPass, ...bestWf.aggregate, concentration: bestWf.concentration }
      : null,
    freshUnseen: fresh,
    freshPass,
    robustness,
    costSensitivity,
    smoke,
    paper3h,
    liveTradingEnabled: false,
    oiImpulseAlphaProgram: deepDataGatePass && bestWf?.walkForwardPass && freshPass ? "PROMISING" : deepDataGatePass ? "REJECTED" : "BLOCKED_NO_DEEP_DATA",
    tradingAlphaProgram: deepDataGatePass && bestWf?.walkForwardPass && freshPass ? "FORWARD_VALIDATION" : "CLOSED",
    doNotContinueStrategyTuning: true,
    nextPhase: deepDataGatePass ? "OI_ALPHA_REJECTED_OR_FORWARD" : "PROVIDE_DEEP_OI_DATA",
    requiredDataSchema: {
      directory: "artifacts/deep-oi-data/",
      format: "JSON per symbol",
      fields: ["symbol", "bars[]", "funding[]", "basis[]", "openInterest[{timestamp,openInterest}]", "aggTrades?(optional)"],
      minOiDays: MIN_OI_DAYS,
      providers: ["TARDIS_API_KEY", "COINALYZE_API_KEY", "COINAPI_KEY", "DEEP_OI_DATA_DIR file import"],
    },
    verdicts: {
      ENGINEERING_VERDICT: "PASS",
      HISTORICAL_EDGE_VERDICT: freshPass ? "PASS" : "FAIL",
      PAPER_FORWARD_VERDICT: "NOT_STARTED",
      PROFITABILITY_VERDICT: "NOT_STARTED",
      DEEP_DATA_GATE: deepDataGatePass ? "PASS" : "FAIL",
    },
  };

  fs.writeFileSync(path.join(process.cwd(), "kripto-oi-alpha-final-profitability-result.json"), JSON.stringify({
    verdict: result.verdict,
    blocker: result.blocker,
    deepDataGatePass: result.deepDataGatePass,
    provider: result.provider,
    oiCoverageDays: result.dataset.oiCoverageDays,
    bestAlpha: result.bestAlpha,
    smoke: result.smoke,
    paper3h: result.paper3h,
    liveTradingEnabled: false,
  }, null, 2));

  fs.writeFileSync(path.join(process.cwd(), "KRIPTO_OI_ALPHA_FINAL_PROFITABILITY_REPORT.md"), buildReport(result), "utf8");
  console.log(JSON.stringify({ deepDataGatePass, blocker, oiMinDays: oiCoverage.minDays, bestAlpha: bestWf?.alphaId, wfPass: bestWf?.walkForwardPass }, null, 2));
}

function buildReport(r: Record<string, unknown>) {
  const wf = r.wfResults as Array<Record<string, unknown>>;
  return `# KRIPTO OI Impulse Alpha — Final Profitability Report

## Executive Summary

OI_IMPULSE_LONG treated as **PROMISING_BUT_UNPROVEN**. Deep historical OI gate: **${r.deepDataGatePass ? "PASS" : "FAIL"}**.

- Provider: \`${r.provider}\` (credential present: ${r.credentialPresent})
- OI coverage: ${JSON.stringify(r.dataset)}
- Blocker: **${r.blocker ?? "none"}**
- 3H Paper: NOT STARTED
- \`LIVE_TRADING_ENABLED=false\`

## V1 Contract

\`\`\`json
${JSON.stringify(r.v1Contract, null, 2)}
\`\`\`

## Walk-Forward Results

| Alpha | WF Pass | Folds+ | Trades | Exp | PF | Fail reasons |
|-------|---------|--------|--------|-----|-----|--------------|
${wf.map((a) => `| ${a.alphaId} | ${a.walkForwardPass} | ${a.positive}/${a.folds} | ${a.trades} | ${a.expectancy} | ${a.profitFactor} | ${(a.failReasons as string[]).join(",")} |`).join("\n")}

## OI State Matrix (sample)

${JSON.stringify(r.stateMatrix, null, 2)}

## Required Deep Data (if blocked)

${JSON.stringify(r.requiredDataSchema, null, 2)}

## Verdict

- DEEP_DATA_GATE: ${(r.verdicts as Record<string, string>).DEEP_DATA_GATE}
- OI Program: ${r.oiImpulseAlphaProgram}
- TRADING_PROGRAM: ${r.tradingAlphaProgram}

---
*Generated ${new Date().toISOString()}*
`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
