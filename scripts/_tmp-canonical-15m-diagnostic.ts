import fs from "node:fs";
import path from "node:path";
import { ensureMarketDataDaemonStarted } from "@/src/server/market-data/spine/daemon-worker";
import { getMarketDataDaemon } from "@/src/server/market-data/spine/market-data-daemon";
import { getOpportunityEngine } from "@/src/server/opportunity/opportunity-engine";
import { getMicrostructureEngine } from "@/src/server/microstructure/microstructure-engine";
import { buildMarketContext } from "@/src/server/scanner/market-context-builder";
import { getLegacyScannerTelemetry, resetLegacyScannerTelemetry } from "@/src/server/scanner/legacy-scanner-telemetry.service";
import { getCanonicalCandidateStore } from "@/src/server/candidate/candidate-store.service";
import { getCanonicalInstanceOwnership } from "@/src/server/candidate/instance-ownership.service";
import { getShadowOutcomeEngine, observeCanonicalShadowTick } from "@/src/server/shadow-outcome/shadow-outcome-engine";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  process.env.CANONICAL_RUNTIME_ENFORCE_NO_LEGACY_PERSIST = "true";
  process.env.SCANNER_WORKER_USE_LEGACY_PIPELINE = "false";
  ensureMarketDataDaemonStarted();
  resetLegacyScannerTelemetry();

  const startedAt = Date.now();
  const durationMs = 15 * 60_000;
  const tickMs = 5_000;

  const counters = {
    marketEvents: 0,
    symbolsEvaluated: 0,
    discovered: 0,
    hot: 0,
    deepSubscribeRequested: 0,
    deepSubscribeActive: 0,
    microAnalyzed: 0,
    microConfirmed: 0,
    microRejected: 0,
    finalRanked: 0,
    executionReady: 0,
    warmup: 0,
    aggTradeEventsObservedSymbols: 0,
    bookTickerEventsObservedSymbols: 0,
    lanes: {
      EARLY: 0,
      STEADY: 0,
      MOMENTUM: 0,
      CONTINUATION: 0,
    } as Record<string, number>,
  };

  const klineSourceCounts: Record<string, number> = {};
  const microRejectReasons: Record<string, number> = {};
  const opportunityRejectSamples: Record<string, number> = {};
  const candidateOutcome: Record<string, number> = {};
  let shadowTracked = 0;
  let moverEvents = 0;

  while (Date.now() - startedAt < durationMs) {
    const daemon = getMarketDataDaemon();
    const telemetry = daemon.telemetry();
    counters.marketEvents += Number(telemetry.eventsPerSec ?? 0);
    counters.deepSubscribeActive = Math.max(counters.deepSubscribeActive, Number(telemetry.deepSubscriptions ?? 0));

    const opportunity = getOpportunityEngine().scan();
    counters.symbolsEvaluated += Number(opportunity.evaluated ?? 0);
    counters.discovered += Number(opportunity.ranked.length ?? 0);
    counters.hot += opportunity.ranked.filter((row) => row.state === "HOT" || row.state === "PROMOTED").length;
    counters.deepSubscribeRequested += Number(opportunity.deepSubscriptions ?? 0);
    counters.lanes.EARLY += opportunity.laneLeaders.EARLY.length;
    counters.lanes.STEADY += opportunity.laneLeaders.STEADY.length;
    counters.lanes.MOMENTUM += opportunity.laneLeaders.MOMENTUM.length;
    counters.lanes.CONTINUATION += opportunity.laneLeaders.CONTINUATION.length;

    const micro = getMicrostructureEngine().evaluate(opportunity.ranked);
    observeCanonicalShadowTick({
      opportunity: opportunity.ranked,
      micro: micro.ranked,
      snapshots: daemon.getMarketSnapshot(),
    });
    counters.microAnalyzed += Number(micro.hotCount ?? 0);
    counters.microConfirmed += Number(micro.confirmedCount ?? 0);
    counters.executionReady += Number(micro.executionReadyCount ?? 0);
    counters.finalRanked += Number(micro.ranked.length ?? 0);
    counters.warmup += Number(micro.warmingCount ?? 0);
    counters.microRejected += micro.ranked.filter((row) => row.state === "HARD_REJECT" || row.state === "COOLING").length;
    for (const row of micro.ranked) {
      for (const code of row.reasonCodes ?? []) {
        if (!code.startsWith("MICRO_")) continue;
        microRejectReasons[code] = (microRejectReasons[code] ?? 0) + 1;
      }
    }
    const store = getCanonicalCandidateStore();
    const storeTelemetry = store.getTelemetry();
    for (const [state, count] of Object.entries(storeTelemetry.byState)) {
      candidateOutcome[state] = Math.max(candidateOutcome[state] ?? 0, Number(count ?? 0));
    }
    const shadow = getShadowOutcomeEngine();
    shadowTracked = Math.max(shadowTracked, shadow.getTracked().length);
    moverEvents = Math.max(moverEvents, shadow.getMoverEvents().length);

    const snapshot = daemon.getMarketSnapshot();
    let aggSeen = 0;
    let bookSeen = 0;
    for (const row of snapshot.slice(0, 80)) {
      const deep = daemon.getDeepState(row.symbol);
      if ((deep?.recentTrades?.length ?? 0) > 0) aggSeen += 1;
      if (deep?.bookTicker) bookSeen += 1;
    }
    counters.aggTradeEventsObservedSymbols += aggSeen;
    counters.bookTickerEventsObservedSymbols += bookSeen;

    for (const row of snapshot.slice(0, 32)) {
      const ctx = await buildMarketContext(row.symbol, {
        lite: true,
        allowBackgroundIntelCapture: false,
      }).catch(() => null);
      if (!ctx) continue;
      const source = String(ctx.metadata.klineSource ?? "UNKNOWN");
      klineSourceCounts[source] = (klineSourceCounts[source] ?? 0) + 1;
      for (const reason of ctx.rejectReasons ?? []) {
        opportunityRejectSamples[reason] = (opportunityRejectSamples[reason] ?? 0) + 1;
      }
    }
    await sleep(tickMs);
  }

  const daemon = getMarketDataDaemon();
  const finalTelemetry = daemon.telemetry();
  const legacy = getLegacyScannerTelemetry();
  const klineSampleTotal = Object.values(klineSourceCounts).reduce((a, b) => a + b, 0);
  const klineMissingCount = Number(klineSourceCounts.MISSING ?? 0);
  const pass = {
    marketEvents: counters.marketEvents > 0,
    symbolsEvaluated: counters.symbolsEvaluated > 0,
    coverage: Number(finalTelemetry.coveragePct ?? 0) > 0,
    freshSymbols: Number(finalTelemetry.liveSymbols ?? 0) > 0,
    legacyInvocationZero: legacy.invocationTotal === 0,
    legacyPersistZero: legacy.persistenceTotal === 0,
    klineMissingNotDominant: klineSampleTotal === 0 ? false : klineMissingCount / klineSampleTotal < 0.9,
    laneClassifierWorked:
      counters.lanes.EARLY + counters.lanes.STEADY + counters.lanes.MOMENTUM + counters.lanes.CONTINUATION > 0,
    microInputIfCandidate: counters.hot === 0 ? true : counters.microAnalyzed > 0,
    candidateStoreDiscovered: Number(getCanonicalCandidateStore().getTelemetry().byState.DISCOVERED ?? 0) > 0,
    shadowTracked: shadowTracked > 0,
    groundTruthMoverActive: moverEvents > 0,
  };
  const ok = Object.values(pass).every(Boolean);

  const payload = {
    ok,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date().toISOString(),
    durationSec: Math.round((Date.now() - startedAt) / 1000),
    pass,
    finalTelemetry,
    counters,
    klineSourceCounts,
    klineMissingRate: klineSampleTotal > 0 ? Number((klineMissingCount / klineSampleTotal).toFixed(4)) : null,
    microRejectReasons,
    opportunityRejectSamples,
    legacy,
    instanceOwnership: getCanonicalInstanceOwnership(),
    candidateStore: getCanonicalCandidateStore().getTelemetry(),
    candidateOutcome,
    shadowTracked,
    groundTruthMoverEvents: moverEvents,
    invariants: {
      microConfirmedAccounting:
        Number(candidateOutcome.MICRO_CONFIRMED ?? 0) <=
        Number(candidateOutcome.FINAL_RANKED ?? 0) + Number(candidateOutcome.EXPIRED ?? 0),
      finalRankAccounting:
        Number(candidateOutcome.FINAL_RANKED ?? 0) <=
        Number(candidateOutcome.EXECUTION_READY ?? 0) + Number(candidateOutcome.NOT_EXECUTION_READY ?? 0),
    },
  };

  const out = path.join(process.cwd(), "artifacts", "forensics", "canonical-15m-diagnostic.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok, out }, null, 2));
  process.exit(ok ? 0 : 2);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: (error as Error).message }, null, 2));
  process.exit(1);
});
