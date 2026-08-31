import fs from "node:fs";
import path from "node:path";
import { ensureMarketDataDaemonStarted } from "@/src/server/market-data/spine/daemon-worker";
import { getMarketDataDaemon } from "@/src/server/market-data/spine/market-data-daemon";
import { getOpportunityEngine } from "@/src/server/opportunity/opportunity-engine";
import { getMicrostructureEngine } from "@/src/server/microstructure/microstructure-engine";
import { buildMarketContext } from "@/src/server/scanner/market-context-builder";
import { resolveExecutionAdapter } from "@/src/server/paper-runtime/execution-port";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  ensureMarketDataDaemonStarted();
  const daemon = getMarketDataDaemon();
  const startedAt = Date.now();
  let telemetry = daemon.telemetry();
  while (Date.now() - startedAt < 45_000) {
    telemetry = daemon.telemetry();
    if (telemetry.eventsPerSec > 0 && telemetry.coveragePct > 0 && telemetry.liveSymbols > 0) break;
    await sleep(2_000);
  }

  const opportunity = getOpportunityEngine().scan();
  const micro = getMicrostructureEngine().evaluate(opportunity.ranked);
  const sampleSymbols = getMarketDataDaemon()
    .getMarketSnapshot()
    .slice(0, 80)
    .map((row) => row.symbol);
  let liveDataHealthyTrue = 0;
  let dataQualityOkTrue = 0;
  let klineMissing = 0;

  for (const symbol of sampleSymbols) {
    const ctx = await buildMarketContext(symbol, { lite: true, allowBackgroundIntelCapture: false }).catch(() => null);
    if (!ctx) continue;
    if (ctx.metadata.liveDataHealthy === true) liveDataHealthyTrue += 1;
    if (ctx.metadata.dataQualityOk === true) dataQualityOkTrue += 1;
    const issues = Array.isArray(ctx.metadata.dataQualityIssues) ? (ctx.metadata.dataQualityIssues as string[]) : [];
    if (issues.includes("KLINE_MISSING")) klineMissing += 1;
  }

  const adapter = resolveExecutionAdapter("paper");
  const submitEcho = adapter.submit({ action: "OPEN", symbol: "BTCTRY", qty: 0.001 });
  const hardLock = (() => {
    try {
      (adapter as { submitLiveBinanceOrder?: () => never }).submitLiveBinanceOrder?.();
      return false;
    } catch {
      return true;
    }
  })();

  const checks = {
    marketDataEvents: telemetry.eventsPerSec > 0,
    marketCoverage: telemetry.coveragePct > 0,
    freshSymbols: telemetry.liveSymbols > 0,
    opportunityEvaluations: opportunity.evaluated > 0,
    liveDataHealthyTrue: liveDataHealthyTrue > 0,
    dataQualityOkTrue: dataQualityOkTrue > 0,
    klineMissingNotGlobal:
      sampleSymbols.length > 0 &&
      !(klineMissing === sampleSymbols.length && liveDataHealthyTrue === 0 && dataQualityOkTrue === 0),
    canonicalOpportunityWiring: opportunity.ranked.length >= 0 && micro.ranked.length >= 0,
    paperAdapterWiring: adapter.kind === "PAPER" && Boolean(submitEcho),
    liveOrderHardLock: hardLock,
  };

  const pass = Object.values(checks).every(Boolean);
  const payload = {
    ok: pass,
    generatedAt: new Date().toISOString(),
    telemetry,
    opportunity: {
      universeSize: opportunity.universeSize,
      evaluated: opportunity.evaluated,
      ranked: opportunity.ranked.length,
      lanes: {
        EARLY: opportunity.laneLeaders.EARLY.length,
        STEADY: opportunity.laneLeaders.STEADY.length,
        MOMENTUM: opportunity.laneLeaders.MOMENTUM.length,
        CONTINUATION: opportunity.laneLeaders.CONTINUATION.length,
      },
    },
    micro: {
      hotCount: micro.hotCount,
      confirmedCount: micro.confirmedCount,
      executionReadyCount: micro.executionReadyCount,
    },
    sample: {
      sampleSize: sampleSymbols.length,
      liveDataHealthyTrue,
      dataQualityOkTrue,
      klineMissing,
    },
    checks,
  };

  const out = path.join(process.cwd(), "artifacts", "forensics", "phase6-preflight.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(payload, null, 2));
  if (!pass) process.exit(2);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: (error as Error).message }, null, 2));
  process.exit(1);
});

