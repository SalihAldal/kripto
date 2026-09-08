/**
 * Validate KRIPTO deep dataset package.
 * Usage: npx tsx scripts/dataset/validate-dataset.ts [datasetRoot]
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.resolve(process.argv[2] ?? path.join(process.cwd(), "KRIPTO_DEEP_DATASET"));

function fail(msg: string) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
}

function readGzCsv(filePath: string) {
  const raw = zlib.gunzipSync(fs.readFileSync(filePath)).toString("utf8");
  const lines = raw.trim().split(/\r?\n/);
  return { header: lines[0], rows: lines.length - 1 };
}

function main() {
  const required = ["manifest.json", "asset-mapping.json", "DATASET_REPORT.md", "data-quality.json", "sources.json", "checksums.sha256"];
  for (const f of required) {
    if (!fs.existsSync(path.join(ROOT, f))) fail(`missing ${f}`);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")) as {
    days: number;
    symbols: string[];
    datasetGate: string;
  };
  const mapping = JSON.parse(fs.readFileSync(path.join(ROOT, "asset-mapping.json"), "utf8")) as Array<{
    externalSymbol: string;
    executionSymbol: string;
  }>;

  if (manifest.days < 120) fail(`days ${manifest.days} < 120`);
  if (mapping.length < 8) fail(`mapping count ${mapping.length} < 8`);

  for (const m of mapping) {
    const jsonPath = path.join(ROOT, "deep-oi-data", `${m.externalSymbol}.json`);
    if (!fs.existsSync(jsonPath)) fail(`missing ${jsonPath}`);
    const panel = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as {
      symbol: string;
      bars: unknown[];
      openInterest: unknown[];
      funding: unknown[];
      files: Record<string, string>;
    };
    if (panel.symbol !== m.externalSymbol) fail(`symbol mismatch ${panel.symbol}`);
    if (!Array.isArray(panel.bars) || panel.bars.length < 100) fail(`${m.externalSymbol} bars too small`);
    if (!Array.isArray(panel.openInterest) || panel.openInterest.length < 1000) fail(`${m.externalSymbol} OI too small`);
    if (!Array.isArray(panel.funding) || panel.funding.length < 50) fail(`${m.externalSymbol} funding too small`);

    const tryGz = path.join(ROOT, panel.files.executionBarsTRY);
    if (!fs.existsSync(tryGz)) fail(`missing TRY gzip ${tryGz}`);
    const tryRows = readGzCsv(tryGz);
    if (tryRows.rows < 100_000) fail(`${m.executionSymbol} TRY rows ${tryRows.rows} too low`);
  }

  const usdt = path.join(ROOT, "market-context", "USDTTRY-bars-1m.csv.gz");
  if (!fs.existsSync(usdt)) fail("missing USDTTRY context");

  console.log(JSON.stringify({ root: ROOT, datasetGate: manifest.datasetGate, days: manifest.days, symbols: mapping.length, status: process.exitCode === 1 ? "FAIL" : "PASS" }, null, 2));
}

main();
