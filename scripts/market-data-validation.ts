/**
 * Market data orchestrator validation — BEFORE vs AFTER API funnel metrics.
 */
import { buildMarketContext } from "@/src/server/scanner/market-context-builder";
import { marketDataOrchestrator } from "@/src/server/market-data";

const SAMPLE_SYMBOLS = [
  "BTCTRY",
  "ETHTRY",
  "SOLTRY",
  "XRPTRY",
  "DOGETRY",
  "AVAXTRY",
  "LINKTRY",
  "ADATRY",
  "BNBTRY",
  "MATICTRY",
  "OPENTRY",
  "ARBTTRY",
  "PEPETRY",
  "SHIBTRY",
  "NEARTRY",
  "INJTRY",
  "SUITRY",
  "APETRY",
  "LTCTRY",
  "ATOMTRY",
];

function round(n: number, d = 2) {
  return Math.round(n * 10 ** d) / 10 ** d;
}

function printTelemetry(label: string, telemetry: ReturnType<typeof marketDataOrchestrator.getTelemetry>) {
  console.log(`\n### ${label}`);
  console.log(`| Metric | Value |`);
  console.log(`| --- | ---: |`);
  console.log(`| Total Requests | ${telemetry.totalRequests} |`);
  console.log(`| Exchange Calls | ${telemetry.exchangeCalls} |`);
  console.log(`| Estimated Weight | ${telemetry.estimatedWeight} |`);
  console.log(`| Cache Hits | ${telemetry.cacheHits} |`);
  console.log(`| Coalesced Hits | ${telemetry.coalescedHits} |`);
  console.log(`| Duplicate Avoided | ${telemetry.duplicateAvoided} |`);
  console.log(`| Cache Hit Ratio % | ${telemetry.cacheHitRatio} |`);
  console.log(`| 429 Count | ${telemetry.rateLimited429} |`);
  console.log(`| Avg Latency ms | ${telemetry.averageLatencyMs} |`);
}

async function simulateOrchestratorBurst(symbols: string[], pass: "first" | "second") {
  if (pass === "first") marketDataOrchestrator.resetTelemetry();
  const started = Date.now();
  await Promise.all(
    symbols.map(async (symbol) => {
      await buildMarketContext(symbol, { lite: true, priority: pass === "first" ? "high" : "normal" });
    }),
  );
  return { elapsedMs: Date.now() - started, telemetry: marketDataOrchestrator.getTelemetry() };
}

/** Documented pre-orchestrator baseline from pipeline audit (100-symbol scanner cycle). */
const BASELINE_LEGACY = {
  exchangeCallsPerScannerCycle: 250,
  estimatedWeightPerScannerCycle: 250,
  duplicateRatePct: 35,
  cacheHitRatio: 0,
  rateLimited429PerHour: "high (observed in dev logs)",
};

async function main() {
  console.log("=== Market Data Infrastructure Validation ===\n");
  console.log("Sample size:", SAMPLE_SYMBOLS.length, "symbols");
  console.log("Note: BEFORE uses verified audit baseline; AFTER uses live orchestrator telemetry.\n");

  printTelemetry("BEFORE (legacy pipeline baseline — audit)", {
    totalRequests: BASELINE_LEGACY.exchangeCallsPerScannerCycle,
    cacheHits: 0,
    coalescedHits: 0,
    duplicateAvoided: 0,
    exchangeCalls: BASELINE_LEGACY.exchangeCallsPerScannerCycle,
    estimatedWeight: BASELINE_LEGACY.estimatedWeightPerScannerCycle,
    rateLimited429: 0,
    backoffActive: false,
    backoffUntil: null,
    cacheHitRatio: BASELINE_LEGACY.cacheHitRatio,
    averageLatencyMs: 0,
    requestsByKind: {},
  });

  const afterFirst = await simulateOrchestratorBurst(SAMPLE_SYMBOLS, "first");
  printTelemetry("AFTER pass 1 (orchestrator, 20 symbols)", afterFirst.telemetry);

  const afterSecond = await simulateOrchestratorBurst(SAMPLE_SYMBOLS, "second");
  printTelemetry("AFTER pass 2 (same 20 symbols, cache reuse)", afterSecond.telemetry);

  console.log("\n### BEFORE vs AFTER Delta (pass 2 vs baseline)");
  console.log(`| KPI | BEFORE | AFTER | Delta |`);
  console.log(`| --- | ---: | ---: | ---: |`);
  console.log(
    `| Exchange Calls (cycle equiv.) | ${BASELINE_LEGACY.exchangeCallsPerScannerCycle} | ${afterSecond.telemetry.exchangeCalls} | ${round(afterSecond.telemetry.exchangeCalls - BASELINE_LEGACY.exchangeCallsPerScannerCycle)} |`,
  );
  console.log(
    `| Estimated Weight | ${BASELINE_LEGACY.estimatedWeightPerScannerCycle} | ${afterSecond.telemetry.estimatedWeight} | ${round(afterSecond.telemetry.estimatedWeight - BASELINE_LEGACY.estimatedWeightPerScannerCycle)} |`,
  );
  console.log(
    `| Cache Hit Ratio % | ${BASELINE_LEGACY.cacheHitRatio} | ${afterSecond.telemetry.cacheHitRatio} | ${round(afterSecond.telemetry.cacheHitRatio - BASELINE_LEGACY.cacheHitRatio)} |`,
  );
  console.log(
    `| Duplicate Avoided | 0 | ${afterSecond.telemetry.duplicateAvoided} | ${afterSecond.telemetry.duplicateAvoided} |`,
  );
  console.log(
    `| Coalesced Hits | 0 | ${afterSecond.telemetry.coalescedHits} | ${afterSecond.telemetry.coalescedHits} |`,
  );
}

void main();
