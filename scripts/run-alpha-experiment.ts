/**
 * Alpha Engine V2 experiment runner.
 * Usage: npx tsx scripts/run-alpha-experiment.ts [--alpha=RESIDUAL_MOMENTUM]
 */
import "./load-dotenv.cjs";
import fs from "node:fs";
import path from "node:path";
import {
  ALPHA_SIMULATOR_IDS,
  createDefaultDataset,
  runAlphaExperimentBatch,
  type AlphaSimulatorId,
} from "@/src/server/alpha-engine-v2/experiment-runner.service";

process.env.LIVE_TRADING_ENABLED = "false";
process.env.LIVE_AUTHORIZATION = "DISABLED";
process.env.EXECUTION_MODE = "PAPER";

const alphaArg = process.argv.find((a) => a.startsWith("--alpha="))?.split("=")[1];
const alphaIds = alphaArg ? [alphaArg as AlphaSimulatorId] : ALPHA_SIMULATOR_IDS;

async function main() {
  const result = await runAlphaExperimentBatch({
    alphaIds,
    artifactDir: path.join(process.cwd(), "artifacts", "alpha-research"),
  });
  const out = path.join(process.cwd(), "artifacts", "alpha-research", "latest-experiment.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({
    paperReady: result.paperReady,
    bestAlpha: result.bestAlpha?.alphaId ?? null,
    scoreboard: result.scoreboard.map((s) => ({ id: s.alphaId, status: s.status, valExp: s.validationExpectancy, testExp: s.testExpectancy })),
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
