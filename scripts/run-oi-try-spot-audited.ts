/**
 * Audited OI TRY spot replay runner.
 * Usage: npx tsx scripts/run-oi-try-spot-audited.ts
 */
import "./load-dotenv.cjs";
import fs from "node:fs";
import path from "node:path";
import { runTrySpotReplayUniverse } from "@/src/server/alpha-engine-v2/try-spot-replay.service";
import { getVariantById, loadAssetMapping, loadTrySpotPanel, loadTrySpotUniverse, resolveDatasetRoot } from "@/src/server/trade-decision-core";

process.env.LIVE_TRADING_ENABLED = "false";

const PERIOD_START = Date.parse("2025-09-01T00:00:00.000Z");
const PERIOD_END = Date.parse("2026-08-31T23:59:59.999Z");
const FRESH_PARTIAL_START = PERIOD_END - 45 * 24 * 3_600_000;

async function main() {
  const root = resolveDatasetRoot();
  const mapping = loadAssetMapping(root);
  const panels = loadTrySpotUniverse(mapping.map((m) => m.externalSymbol), root);
  const btc = loadTrySpotPanel("BTCUSDT", root);

  const variants = ["baseline_fixed_8h_v1", "baseline_fixed_8h_v2", "baseline_v2_pr04_trail", "combined_regime_trail"] as const;
  const out: Record<string, unknown> = { datasetRoot: root, generatedAt: new Date().toISOString() };

  for (const id of variants) {
    const variant = getVariantById(id);
    const run = runTrySpotReplayUniverse({
      panels,
      btcPanel: btc,
      variant,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      freshPartialStart: FRESH_PARTIAL_START,
    });
    out[id] = { stats: run.stats, trades: run.trades.length };
  }

  const file = path.join(process.cwd(), "artifacts", "oi-try-spot-audited-result.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
