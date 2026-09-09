/**
 * Frozen economic hypothesis portfolio test — separate from running paper.
 * Usage:
 *   DEEP_OI_DATA_DIR=c:/.../KRIPTO_DEEP_DATASET/deep-oi-data npx tsx scripts/run-econ-strategy-experiments.ts
 *   ECON_DATA_DIR=c:/.../KRIPTO_ECON_TRY_DATASET npx tsx scripts/run-econ-strategy-experiments.ts --universe=econ
 */
import "./load-dotenv.cjs";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runTrySpotReplayUniverse, TRY_REPLAY_VERSION } from "../src/server/alpha-engine-v2/try-spot-replay.service";
import { STRATEGY_VARIANTS } from "../src/server/trade-decision-core/entry-signal.service";
import { ECON_HYPOTHESIS_VARIANTS } from "../src/server/trade-decision-core/econ-research-variants";
import { ECON_ENTRY_RULES } from "../src/server/trade-decision-core/econ-breakout-entry.service";
import { PRODUCTION_REPLAY_BOUNDARY, replayEquivalenceForVariant } from "../src/server/trade-decision-core/production-replay-boundary";
import { loadAssetMapping, loadTrySpotUniverse, loadUsdtTryBars, resolveDatasetRoot } from "../src/server/trade-decision-core/try-dataset-loader.service";
import { summarizeWindow } from "../src/server/trade-decision-core/window-diagnostics.service";
import { STRATEGY_ACCEPTANCE } from "../src/server/trade-decision-core/validation-evidence.service";
import { atomicJson, sourceFingerprint, verifyDataset } from "./strategy-evidence-io";

process.env.LIVE_TRADING_ENABLED = "false";
process.env.LIVE_AUTHORIZATION = "DISABLED";
process.env.TRADE_DECISION_CORE_ENABLED = "false";

const universe = process.argv.find((a) => a.startsWith("--universe="))?.split("=")[1] ?? "deep";
const out = path.resolve("artifacts/econ-strategy-experiments.json");

function datasetRoot() {
  if (universe === "econ") {
    const dir = process.env.ECON_DATA_DIR ?? path.join(process.cwd(), "KRIPTO_ECON_TRY_DATASET");
    if (!fs.existsSync(path.join(dir, "manifest.json"))) throw new Error("KRIPTO_ECON_TRY_DATASET missing — run build-econ-try-universe-dataset.ts");
    process.env.DEEP_OI_DATA_DIR = path.join(dir, "deep-oi-data");
    return dir;
  }
  return resolveDatasetRoot();
}

async function main() {
  const started = Date.now();
  const root = datasetRoot();
  const dataset = universe === "econ"
    ? { hash: "econ-manifest", manifest: JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")), files: [] }
    : verifyDataset(root);
  const sourceHash = sourceFingerprint();
  const datasetEnd = Date.parse(dataset.manifest.end);
  const windows = [30, 60, 90].map((days) => ({
    id: `trailing_${days}d`,
    days,
    start: datasetEnd + 1 - days * 86400000,
    end: datasetEnd,
    kind: "OVERLAPPING_TRAILING",
  }));

  const symbols = loadAssetMapping(root).map((x) => x.externalSymbol).sort();
  if (symbols.length < ECON_ENTRY_RULES.rsUniverseMin) {
    console.warn(`WARN: universe size ${symbols.length} < rsUniverseMin ${ECON_ENTRY_RULES.rsUniverseMin}`);
  }
  const panels = loadTrySpotUniverse(symbols, root);
  const btc = panels.find((p) => p.symbol === "BTCUSDT") ?? panels[0];
  if (!btc) throw new Error("BTC_CONTEXT_REQUIRED");
  const fx = loadUsdtTryBars(root);

  const scenarios = [
    { id: "base", feePerSidePct: 0.15, slippageBpsPerSide: 7, participationRate: 0.01 },
    { id: "stress", feePerSidePct: 0.2, slippageBpsPerSide: 15, participationRate: 0.005 },
  ];

  const hypotheses = ECON_HYPOTHESIS_VARIANTS;
  const oiBaseline = STRATEGY_VARIANTS.filter((v) => v.id === "baseline_v2_pr04_trail");
  const variants = [...hypotheses, ...oiBaseline.map((v) => ({ ...v, id: `compare_${v.id}`, label: `[OI COMPARISON ONLY] ${v.label}` }))];

  const rows = [];
  for (const window of windows) {
    for (const scenario of scenarios) {
      if (scenario.id === "stress" && window.days !== 90) continue;
      for (const variant of variants) {
        const run = runTrySpotReplayUniverse({
          panels,
          btcPanel: btc,
          variant,
          periodStart: window.start,
          periodEnd: window.end,
          freshPartialStart: window.start,
          initialCashTry: 100_000,
          notionalTry: 1_000,
          maxPositions: 3,
          feePerSidePct: scenario.feePerSidePct,
          slippageBpsPerSide: scenario.slippageBpsPerSide,
          participationRate: scenario.participationRate,
        });
        const summary = summarizeWindow(run, window.start, window.end);
        rows.push({
          windowId: window.id,
          scenario: scenario.id,
          variantId: variant.id,
          family: variant.id.startsWith("compare_") ? "OI_COMPARISON" : "ECON_HYPOTHESIS",
          researchOnly: true,
          replayEquivalence: replayEquivalenceForVariant(variant.entryCandidate),
          ...summary,
          concentrationBySymbol: summary.bySymbol,
          config: run.config,
        });
        console.log(JSON.stringify({ window: window.id, scenario: scenario.id, variant: variant.id, trades: summary.trades, net: summary.netPnlTry, screen: summary.economicScreen }));
      }
    }
  }

  const passing = rows.filter((r) => r.family === "ECON_HYPOTHESIS" && r.economicScreen?.pass);
  const result = {
    status: "COMPLETED",
    generatedAt: new Date().toISOString(),
    repositoryHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    sourceHash,
    replayVersion: TRY_REPLAY_VERSION,
    universe,
    datasetRoot: root,
    symbolCount: symbols.length,
    hypotheses: hypotheses.map((h) => ({ id: h.id, entryCandidate: h.entryCandidate, rules: ECON_ENTRY_RULES.version })),
    acceptanceCriteria: STRATEGY_ACCEPTANCE,
    productionBoundary: PRODUCTION_REPLAY_BOUNDARY,
    windows,
    scenarios,
    rows,
    verdict: {
      anyHypothesisPassed: passing.length > 0,
      passedVariants: [...new Set(passing.map((r) => r.variantId))],
      oiComparisonNote: "OI rows are NOT production scanner results",
      forwardValidationRequired: true,
      dataLimitations: universe === "deep"
        ? ["TEN_MAJOR_COINS_ONLY", "DOES_NOT_VALIDATE_ALTCOIN_SCANNER", "ALL_DATES_ALREADY_SEEN"]
        : ["SURVIVORSHIP_AND_LISTING_BIAS_DOCUMENTED_IN_MANIFEST", "NO_UM_OI_FOR_ECON_VARIANTS"],
      promotion: passing.length ? "BRANCH_ONLY_NO_RUNNING_PAPER_MUTATION" : "NONE_REJECTED",
    },
    elapsedMs: Date.now() - started,
  };

  atomicJson(out, result);
  console.log(`WROTE ${out}`);
  if (!passing.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
