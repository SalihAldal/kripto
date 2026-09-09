/**
 * Deep dataset audit (Node port of audit-deep-dataset.py).
 * Usage: npx tsx scripts/dataset/audit-deep-dataset.ts
 */
import fs from "node:fs";
import path from "node:path";
import { loadAssetMapping, loadTrySpotPanel, resolveDatasetRoot } from "@/src/server/trade-decision-core";

function main() {
  const root = resolveDatasetRoot();
  const mapping = loadAssetMapping(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")) as { days: number; datasetGate: string };
  const rows = mapping.map((m) => {
    const panel = loadTrySpotPanel(m.externalSymbol, root);
    return {
      symbol: m.externalSymbol,
      try: m.executionSymbol,
      externalBars: panel.bars.length,
      tryBars: panel.executionBarsTRY.length,
      oi: panel.openInterest.length,
      funding: panel.funding.length,
      basis: panel.basis.length,
    };
  });
  const out = { root, days: manifest.days, gate: manifest.datasetGate, symbols: rows.length, rows };
  const file = path.join(process.cwd(), "artifacts", "dataset-audit.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main();
