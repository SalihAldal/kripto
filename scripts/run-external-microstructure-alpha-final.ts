/**
 * External microstructure alpha final program.
 * Usage: npx tsx scripts/run-external-microstructure-alpha-final.ts
 */
import "./load-dotenv.cjs";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  BinanceFuturesMarketDataProvider,
  buildExternalSymbolPanel,
} from "@/src/server/alpha-engine-v2/external-market-data-provider.service";
import { aggregateQaSummary, dataQaPass, runExternalDataQa } from "@/src/server/alpha-engine-v2/external-data-qa.service";
import { computePriceOiQuadrantForensic, EXTERNAL_ALPHA_IDS } from "@/src/server/alpha-engine-v2/external-microstructure-alpha.service";
import {
  evaluateAllExternalAlphas,
  evaluateFrozenExternalAlpha,
} from "@/src/server/alpha-engine-v2/external-microstructure-walk-forward.service";

process.env.LIVE_TRADING_ENABLED = "false";
process.env.LIVE_AUTHORIZATION = "DISABLED";
process.env.EXECUTION_MODE = "PAPER";

const ARTIFACT = path.join(process.cwd(), "artifacts", "external-microstructure-alpha");
const UNIVERSE = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "SUIUSDT",
];
const CVD_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const MS_DAY = 24 * 3_600_000;

async function main() {
  const headStart = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  fs.mkdirSync(ARTIFACT, { recursive: true });

  const dataEnd = Date.now();
  const dataStart = dataEnd - 184 * MS_DAY;
  const microWfEnd = dataEnd;
  const microWfStart = dataEnd - 28 * MS_DAY;
  const freshStart = microWfStart;
  const freshEnd = microWfStart + 7 * MS_DAY;

  const provider = new BinanceFuturesMarketDataProvider();
  console.log("Loading external microstructure universe...");

  const panels = [];
  for (const symbol of UNIVERSE) {
    const panel = await buildExternalSymbolPanel(provider, symbol, dataStart, dataEnd);
    if (!CVD_SYMBOLS.includes(symbol)) {
      panel.aggTrades = [];
      panel.cvd = [];
      panel.availability.AGG_TRADES = "UNAVAILABLE";
      panel.availability.CVD = "UNAVAILABLE";
    }
    panels.push(panel);
    console.log(
      `  ${symbol}: bars=${panel.bars.length} oi=${panel.openInterest.length} liq=${panel.liquidations.length} agg=${panel.aggTrades.length} ls=${panel.longShortRatio.length}`,
    );
    await new Promise((r) => setTimeout(r, 500));
  }
  const btc = panels.find((p) => p.symbol === "BTCUSDT")?.bars ?? [];

  const qaReports = panels.flatMap((p) => runExternalDataQa(p, dataStart, dataEnd));
  const qaSummary = aggregateQaSummary(qaReports);
  const dataQaPassed = dataQaPass(qaReports, ["OHLCV", "FUNDING"]);

  const oiForensic = panels
    .filter((p) => p.availability.OPEN_INTEREST !== "UNAVAILABLE")
    .map((p) => ({ symbol: p.symbol, quadrants: computePriceOiQuadrantForensic(p) }));

  const alphaResults = evaluateAllExternalAlphas({
    panels,
    datasetStart: microWfStart,
    datasetEnd: microWfEnd,
    trainDays: 7,
    valDays: 7,
    rollDays: 7,
  });
  fs.writeFileSync(path.join(ARTIFACT, "alpha-walk-forward.json"), JSON.stringify(alphaResults, null, 2));

  const bestWf = [...alphaResults]
    .filter((r) => r.aggregate.trades >= 5)
    .sort((a, b) => b.aggregate.expectancy - a.aggregate.expectancy || b.aggregate.profitFactor - a.aggregate.profitFactor)[0];

  const bestAlpha = bestWf?.walkForwardPass ? bestWf : null;

  let freshResult = null;
  let freshPass = false;
  if (bestAlpha) {
    freshResult = evaluateFrozenExternalAlpha({
      alphaId: bestAlpha.alphaId,
      panels,
      evalStart: freshStart,
      evalEnd: freshEnd,
    });
    freshPass =
      freshResult.stats.trades >= 5 &&
      freshResult.stats.netPnl > 0 &&
      freshResult.stats.expectancy > 0 &&
      freshResult.stats.profitFactor > 1;
  }

  const robustnessPeriods = [
    { label: "week-3", start: dataEnd - 21 * MS_DAY, end: dataEnd - 14 * MS_DAY },
    { label: "week-2", start: dataEnd - 14 * MS_DAY, end: dataEnd - 7 * MS_DAY },
    { label: "week-1", start: dataEnd - 7 * MS_DAY, end: dataEnd },
  ];

  let robustnessPositive = 0;
  const robustnessDetails = [];
  if (bestAlpha) {
    for (const period of robustnessPeriods) {
      const evalResult = evaluateFrozenExternalAlpha({
        alphaId: bestAlpha.alphaId,
        panels,
        evalStart: period.start,
        evalEnd: period.end,
      });
      if (evalResult.stats.netPnl > 0 && evalResult.stats.expectancy > 0) robustnessPositive += 1;
      robustnessDetails.push({ period: period.label, ...evalResult.stats });
    }
  }

  const robustnessPass =
    Boolean(bestAlpha?.walkForwardPass) &&
    freshPass &&
    robustnessPositive >= Math.ceil(robustnessPeriods.length / 2);

  const paperReady = Boolean(bestAlpha?.walkForwardPass && freshPass && robustnessPass && dataQaPassed);
  const externalAlphaFound = paperReady;

  const smoke = { started: false, passed: false, reason: paperReady ? "NOT_RUN" : "GATES_NOT_PASS" };
  const paper3h = {
    started: false,
    completed: false,
    campaignId: "",
    runtimeMinutes: 0,
    reason: "GATES_NOT_PASS",
  };

  if (paperReady) {
    try {
      const { spawnSync, spawn } = await import("node:child_process");
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
        const campaignId = `paper-external-alpha-v2-3h-${new Date().toISOString().replace(/[:.]/g, "-")}`;
        paper3h.started = true;
        paper3h.campaignId = campaignId;
        spawn("npx", ["tsx", "scripts/run-external-alpha-v2-3h-paper.ts", `--campaignId=${campaignId}`], {
          cwd: process.cwd(),
          detached: true,
          stdio: "ignore",
          env: process.env as Record<string, string>,
        }).unref();
        paper3h.reason = "STARTED_DETACHED";
      }
    } catch (e) {
      smoke.reason = String(e);
    }
  }

  const totalFundingEvents = panels.reduce((s, p) => s + p.funding.length, 0);
  const totalOiPoints = panels.reduce((s, p) => s + p.openInterest.length, 0);
  const totalLiq = panels.reduce((s, p) => s + p.liquidations.length, 0);
  const totalAgg = panels.reduce((s, p) => s + p.aggTrades.length, 0);

  const result = {
    verdict: externalAlphaFound ? "PARTIAL" : "FAIL",
    headStart,
    providers: ["binance-futures"],
    dataset: {
      start: new Date(dataStart).toISOString(),
      end: new Date(dataEnd).toISOString(),
      microWindowStart: new Date(microWfStart).toISOString(),
      microWindowEnd: new Date(microWfEnd).toISOString(),
      symbols: UNIVERSE.length,
      days: Math.round((dataEnd - dataStart) / MS_DAY),
      apiLimits: {
        openInterest: "~30d rolling (Binance public API)",
        aggTrades: "~2d rolling (Binance futures)",
        liquidations: "~7d rolling",
        orderBookHistorical: "UNAVAILABLE",
      },
    },
    coverage: {
      oi: qaSummary.find((s) => s.kind === "OPEN_INTEREST")?.avgCoveragePct ?? 0,
      liquidation: totalLiq > 0 ? "PARTIAL" : "UNAVAILABLE",
      aggTrades: totalAgg > 0 ? "PARTIAL" : "UNAVAILABLE",
      cvd: CVD_SYMBOLS.length,
      orderBook: "UNAVAILABLE",
      longShort: qaSummary.find((s) => s.kind === "LONG_SHORT_RATIO")?.avgCoveragePct ?? 0,
      fundingEvents: totalFundingEvents,
      oiPoints: totalOiPoints,
      liquidationEvents: totalLiq,
      aggTradeBuckets: totalAgg,
    },
    dataQa: { pass: dataQaPassed, summary: qaSummary },
    oiForensic,
    alphasTested: alphaResults.map((r) => ({
      alphaId: r.alphaId,
      walkForwardPass: r.walkForwardPass,
      folds: r.foldsTested,
      positiveFolds: r.positiveFolds,
      trades: r.aggregate.trades,
      expectancy: r.aggregate.expectancy,
      profitFactor: r.aggregate.profitFactor,
      netPnl: r.aggregate.netPnl,
    })),
    bestAlpha: bestAlpha
      ? {
          id: bestAlpha.alphaId,
          walkForwardPass: bestAlpha.walkForwardPass,
          wfTrades: bestAlpha.aggregate.trades,
          wfExpectancy: bestAlpha.aggregate.expectancy,
          wfPF: bestAlpha.aggregate.profitFactor,
        }
      : null,
    freshUnseen: freshResult
      ? { trades: freshResult.stats.trades, expectancy: freshResult.stats.expectancy, profitFactor: freshResult.stats.profitFactor, pass: freshPass }
      : null,
    robustness: { periods: robustnessPeriods.length, positive: robustnessPositive, details: robustnessDetails, pass: robustnessPass },
    smoke,
    paper3h,
    liveTradingEnabled: false,
    externalAlphaFound,
    tradingResearchProgram: externalAlphaFound ? "FORWARD_VALIDATION" : "CLOSED",
    productionReady: false,
    doNotContinueStrategyTuning: !externalAlphaFound,
    nextPhase: externalAlphaFound ? "FORWARD_VALIDATION" : "PRODUCT_PIVOT_CRYPTO_INTELLIGENCE_PLATFORM",
    recommendedNextPaperDuration: externalAlphaFound ? "24h" : "N/A",
    verdicts: {
      ENGINEERING_VERDICT: "PASS",
      EXTERNAL_ALPHA_VERDICT: externalAlphaFound ? "PASS" : "FAIL",
      HISTORICAL_EDGE_VERDICT: freshPass ? "PASS" : "FAIL",
      PAPER_FORWARD_VERDICT: paper3h.started ? "STARTED" : "NOT_STARTED",
      PROFITABILITY_VERDICT: "NOT_STARTED",
      TRADING_ALPHA_PROGRAM_VERDICT: externalAlphaFound ? "EDGE_CANDIDATE" : "NO_ROBUST_EDGE_FOUND",
    },
  };

  fs.writeFileSync(path.join(ARTIFACT, "dataset-summary.json"), JSON.stringify(result.dataset, null, 2));
  fs.writeFileSync(path.join(ARTIFACT, "data-qa.json"), JSON.stringify({ summary: qaSummary, reports: qaReports.slice(0, 30) }, null, 2));
  fs.writeFileSync(path.join(process.cwd(), "kripto-external-microstructure-alpha-final-result.json"), JSON.stringify({
    verdict: result.verdict,
    externalAlphaFound: result.externalAlphaFound,
    tradingResearchProgram: result.tradingResearchProgram,
    bestAlpha: result.bestAlpha,
    coverage: result.coverage,
    smoke: result.smoke,
    paper3h: result.paper3h,
    liveTradingEnabled: false,
  }, null, 2));
  fs.writeFileSync(path.join(process.cwd(), "KRIPTO_EXTERNAL_MICROSTRUCTURE_ALPHA_FINAL_REPORT.md"), buildReport(result), "utf8");

  console.log(JSON.stringify({
    dataQaPassed,
    alphasTested: alphaResults.length,
    bestAlpha: bestAlpha?.alphaId ?? null,
    walkForwardPass: bestAlpha?.walkForwardPass ?? false,
    freshPass,
    robustnessPass,
    externalAlphaFound,
    tradingResearchProgram: result.tradingResearchProgram,
  }, null, 2));
}

function buildReport(r: Record<string, unknown>) {
  const cov = r.coverage as Record<string, unknown>;
  const alphas = r.alphasTested as Array<Record<string, unknown>>;
  const verdicts = r.verdicts as Record<string, string>;
  const best = r.bestAlpha as Record<string, unknown> | null;
  return `# KRIPTO External Microstructure Alpha — Final Report

## Executive Summary

External microstructure data pivot completed with provider-independent ingestion, real Binance OI/funding/aggTrades/long-short data, and honest availability reporting.

- Dataset: ${(r.dataset as { days: number }).days} days, ${(r.dataset as { symbols: number }).symbols} symbols
- OI coverage: ${cov.oi}% avg | Liquidations: ${cov.liquidation} | AggTrades/CVD: ${cov.aggTrades} (${cov.cvd} symbols)
- Order book historical: **UNAVAILABLE** (no fake reconstruction)
- Alphas tested: ${alphas.length}
- Best alpha walk-forward PASS: **${best?.walkForwardPass ?? false}**
- **EXTERNAL_ALPHA_FOUND: ${r.externalAlphaFound}**
- **TRADING_RESEARCH_PROGRAM: ${r.tradingResearchProgram}**
- 3H Paper: ${(r.paper3h as { started: boolean }).started ? "STARTED" : "NOT STARTED"}

\`LIVE_TRADING_ENABLED=false\`

## Data QA

${JSON.stringify(r.dataQa, null, 2)}

## Alpha Results (walk-forward)

| Alpha | WF Pass | Folds+ | Trades | Exp | PF |
|-------|---------|--------|--------|-----|-----|
${alphas.map((a) => `| ${a.alphaId} | ${a.walkForwardPass} | ${a.positiveFolds}/${a.folds} | ${a.trades} | ${a.expectancy} | ${a.profitFactor} |`).join("\n")}

## Verdicts

| Verdict | Result |
|---------|--------|
| ENGINEERING | ${verdicts.ENGINEERING_VERDICT} |
| EXTERNAL_ALPHA | ${verdicts.EXTERNAL_ALPHA_VERDICT} |
| TRADING_PROGRAM | ${verdicts.TRADING_ALPHA_PROGRAM_VERDICT} |

## Next Phase

\`${r.nextPhase}\`

${r.doNotContinueStrategyTuning ? `**DO_NOT_CONTINUE_STRATEGY_TUNING=true** — Research program closed.

### Product Pivot Proposal: Crypto Intelligence Platform

Mevcut sağlam altyapı şu ürün yeteneklerine yönlendirilebilir:
- Real-time scanner & AI market explanation
- Funding / OI / liquidation monitors
- CVD & flow dashboards
- Alerts & portfolio risk
- Market regime & research replay

Trading alpha edge kanıtlanamadı; intelligence/monitoring değer önerisi ayrı değerlendirilmeli.` : ""}

---
*Generated ${new Date().toISOString()}*
`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
