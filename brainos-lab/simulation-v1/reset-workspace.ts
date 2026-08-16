import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const files = [
  "summary.json",
  "metrics.json",
  "accepted-trades.json",
  "rejected-trades.json",
  "simulation-lab.md",
  "trades.jsonl",
  "checkpoints/latest.json",
];

for (const rel of files) {
  const fp = path.join(ROOT, rel);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

console.log("Simulation workspace reset. Run: npx tsx brainos-lab/simulation-v1/run-simulation.ts");
