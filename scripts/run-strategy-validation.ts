/**
 * KRIPTO strategy validation — single reproducible command.
 * Usage: npx tsx scripts/run-strategy-validation.ts
 */
import "./load-dotenv.cjs";
import fs from "node:fs";
import path from "node:path";
import { runTrySpotReplayUniverse } from "@/src/server/alpha-engine-v2/try-spot-replay.service";
import { aggregateLossAttribution, getVariantById, loadAssetMapping, loadTrySpotPanel, loadTrySpotUniverse, resolveDatasetRoot } from "@/src/server/trade-decision-core";
import { STRATEGY_VARIANTS } from "@/src/server/trade-decision-core/entry-signal.service";
import { computeAlphaStats } from "@/src/server/alpha-engine-v2/validation-framework.service";

process.env.LIVE_TRADING_ENABLED = "false";
process.env.LIVE_AUTHORIZATION = "DISABLED";

const MS_DAY = 24 * 3_600_000;
const PERIOD_START = Date.parse("2025-09-01T00:00:00.000Z");
const PERIOD_END = Date.parse("2026-08-31T23:59:59.999Z");
const FRESH_PARTIAL_START = PERIOD_END - 45 * MS_DAY;
const ARTIFACT = path.join(process.cwd(), "artifacts", "strategy-validation");

const ACCEPTANCE = {
  minTrades: 40,
  minExpectancy: 0,
  minProfitFactor: 1.05,
  maxDrawdownPct: 20,
  minPositiveFoldRatio: 0.55,
  maxTopSymbolContributionPct: 45,
};

function foldStats(trades: ReturnType<typeof runTrySpotReplayUniverse>["trades"], foldStart: number, foldEnd: number) {
  const slice = trades.filter((t) => t.entryAtMs >= foldStart && t.entryAtMs < foldEnd);
  const stats = computeAlphaStats(
    slice.map((t) => ({
      symbol: t.symbol,
      side: t.side,
      entryTime: t.entryAtMs,
      exitTime: t.exitAtMs,
      grossReturnPct: t.grossReturnPct,
      fundingPnlPct: 0,
      feeCostPct: t.costPct,
      netReturnPct: t.netReturnPct,
      split: t.split === "FRESH_PARTIAL" ? "TEST" : t.split === "VAL" ? "VALIDATION" : "TRAIN",
      alphaId: t.variantId,
    })),
  );
  return stats;
}

function buildWalkForwardFolds(start: number, end: number) {
  const train = 45 * MS_DAY;
  const val = 15 * MS_DAY;
  const roll = 15 * MS_DAY;
  const folds: Array<{ start: number; end: number }> = [];
  let cursor = start + train;
  while (cursor + val <= end) {
    folds.push({ start: cursor, end: cursor + val });
    cursor += roll;
  }
  return folds;
}

function concentration(trades: ReturnType<typeof runTrySpotReplayUniverse>["trades"]) {
  const bySymbol = new Map<string, number>();
  let total = 0;
  for (const t of trades) {
    const pnl = (t.netReturnPct / 100) * 1000;
    bySymbol.set(t.symbol, (bySymbol.get(t.symbol) ?? 0) + pnl);
    total += pnl;
  }
  const top = [...bySymbol.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  return {
    topSymbol: top?.[0] ?? "",
    topSymbolContributionPct: total !== 0 ? Math.abs((top?.[1] ?? 0) / total) * 100 : 0,
  };
}

function passesAcceptance(stats: ReturnType<typeof computeAlphaStats>, folds: ReturnType<typeof foldStats>[], conc: ReturnType<typeof concentration>) {
  const positiveFolds = folds.filter((f) => f.netPnl > 0 && f.expectancy > 0).length;
  const foldRatio = folds.length ? positiveFolds / folds.length : 0;
  const reasons: string[] = [];
  if (stats.trades < ACCEPTANCE.minTrades) reasons.push("LOW_SAMPLE");
  if (stats.expectancy <= ACCEPTANCE.minExpectancy) reasons.push("EXPECTANCY");
  if (stats.profitFactor < ACCEPTANCE.minProfitFactor) reasons.push("PROFIT_FACTOR");
  if (stats.maxDrawdown > ACCEPTANCE.maxDrawdownPct) reasons.push("DRAWDOWN");
  if (foldRatio < ACCEPTANCE.minPositiveFoldRatio) reasons.push("FOLD_RATIO");
  if (conc.topSymbolContributionPct > ACCEPTANCE.maxTopSymbolContributionPct) reasons.push("CONCENTRATION");
  return { pass: reasons.length === 0, reasons, positiveFolds, folds: folds.length, foldRatio };
}

async function main() {
  fs.mkdirSync(ARTIFACT, { recursive: true });
  console.log("Resolving dataset...");
  const root = resolveDatasetRoot();
  const mapping = loadAssetMapping(root);
  const symbols = mapping.map((m) => m.externalSymbol);
  console.log(`Loading ${symbols.length} panels...`);
  const panels = loadTrySpotUniverse(symbols, root);
  console.log("Loading BTC context...");
  const btcPanel = loadTrySpotPanel("BTCUSDT", root);

  const variants = STRATEGY_VARIANTS;
  const folds = buildWalkForwardFolds(PERIOD_START, PERIOD_END - 45 * MS_DAY);

  const results = variants.map((variant) => {
    console.log(`Running variant ${variant.id}...`);
    const run = runTrySpotReplayUniverse({
      panels,
      btcPanel,
      variant,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      freshPartialStart: FRESH_PARTIAL_START,
    });
    const wf = folds.map((f) => foldStats(run.trades, f.start, f.end));
    const conc = concentration(run.trades);
    const gate = passesAcceptance(run.stats, wf, conc);
    const fresh = foldStats(run.trades, FRESH_PARTIAL_START, PERIOD_END + 1);
    return {
      variantId: variant.id,
      label: variant.label,
      targetsLossMechanism: variant.targetsLossMechanism,
      stats: run.stats,
      lossAttribution: aggregateLossAttribution(run.trades),
      walkForward: { folds: wf.length, positiveFolds: gate.positiveFolds, foldRatio: gate.foldRatio },
      concentration: conc,
      freshPartial: fresh,
      acceptance: gate,
      tradeCount: run.trades.length,
    };
  });

  const best = [...results].sort((a, b) => b.stats.expectancy - a.stats.expectancy)[0];
  const paperEligible = results.find((r) => r.acceptance.pass) ?? null;

  const output = {
    generatedAt: new Date().toISOString(),
    datasetRoot: root,
    period: { start: new Date(PERIOD_START).toISOString(), end: new Date(PERIOD_END).toISOString(), days: 365 },
    dataSplit: {
      trainValEnd: new Date(PERIOD_END - 45 * MS_DAY).toISOString(),
      freshPartialStart: new Date(FRESH_PARTIAL_START).toISOString(),
      freshUnseenStatus: "PARTIAL_SEEN_IN_PRIOR_RESEARCH",
    },
    acceptanceCriteria: ACCEPTANCE,
    variants: results,
    bestVariant: best?.variantId ?? null,
    paperEligible: paperEligible?.variantId ?? null,
    ENGINEERING_STATUS: "PASS",
    STRATEGY_VALIDATION_STATUS: paperEligible ? "PASS" : "FAIL",
    PAPER_INTEGRATION_STATUS: paperEligible ? "READY" : "BLOCKED",
    LIVE_STATUS: "DISABLED",
    liveTradingEnabled: false,
  };

  const outFile = path.join(process.cwd(), "artifacts", "strategy-validation-result.json");
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  fs.writeFileSync(path.join(ARTIFACT, "variants.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ outFile, best: best?.variantId, paperEligible: output.paperEligible, baselineV2: results.find((r) => r.variantId === "baseline_fixed_8h_v2")?.stats }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
