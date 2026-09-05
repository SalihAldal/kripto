import fs from "node:fs";
import path from "node:path";
import { beginForensicPaperSession } from "@/src/server/forensics/forensic-bridge.service";
import { attachForensicRound } from "@/src/server/forensics/forensic-context";
import { getShadowOutcomeEngine, resetShadowOutcomeEngineForTests } from "@/src/server/shadow-outcome/shadow-outcome-engine";
import { persistShadowOutcomes } from "@/src/server/shadow-outcome/persist";
import { buildRuntimeTelemetrySnapshot } from "@/src/server/forensics/runtime-telemetry-snapshot.service";
import { getSettlementStatus } from "@/src/server/shadow-outcome/finalizer.service";
import { prisma } from "@/src/server/db/prisma";

async function main() {
  const startedAt = Date.now();
  const campaignId = `cmp:smoke:${startedAt}`;
  const runId = `smoke-run-${startedAt}`;
  const candidateId = `SMOKEUSDT:${startedAt}`;
  const session = beginForensicPaperSession({
    sessionId: `smoke-session-${startedAt}`,
    jobId: `smoke-job-${startedAt}`,
    runId,
    roundId: "1",
    campaignId,
  });
  attachForensicRound({
    runId,
    roundId: "1",
    jobId: session.jobId,
    campaignId,
  });

  resetShadowOutcomeEngineForTests();
  const shadow = getShadowOutcomeEngine();
  const now = Date.now();
  shadow.observeOpportunity(
    [
      {
        candidateId,
        symbol: "SMOKEUSDT",
        primaryLane: "MOMENTUM",
        secondaryEvidence: [],
        score: 90,
        laneScores: { EARLY: 40, STEADY: 50, MOMENTUM: 90, CONTINUATION: 45 },
        breakdown: {
          priceVelocity: 16,
          priceAcceleration: 20,
          volumeAcceleration: 14,
          relativeVolume: 11,
          relativeStrength: 8,
          breakout: 7,
          compressionExpansion: 4,
          consistency: 5,
          retracementQuality: 3,
          exhaustion: -1,
          chaseControl: -1,
          liquidity: 7,
        },
        features: {
          return1s: 0.1,
          return5s: 0.4,
          return15s: 0.6,
          return30s: 0.8,
          return1m: 1.2,
          return3m: 1.4,
          return5m: 1.6,
          return15m: 2.1,
          change24h: 1.8,
          velocity5s: 1.4,
          velocity15s: 1.1,
          velocity30s: 0.8,
          velocity1m: 0.6,
          priceAccelerationShort: 0.7,
          priceAccelerationMedium: 0.4,
          accelerationConsistency: 0.6,
          volume1m: 120000,
          volume3m: 240000,
          volume5m: 360000,
          rvol1m: 2.3,
          rvol3m: 1.9,
          rvol5m: 1.6,
          volumeAcceleration: 40000,
          relativeStrengthBTC1m: 0.8,
          relativeStrengthBTC5m: 0.9,
          relativeStrengthMarket: 0.7,
          distanceTo3mHigh: 0.1,
          distanceTo5mHigh: 0.12,
          breakout3m: 0.45,
          breakout5m: 0.35,
          compressionScore: 0.4,
          expansionScore: 0.5,
          maxRetracement: 0.2,
          retracementRatio: 0.1,
          recoverySpeed: 0.5,
          momentumConsistency: 0.7,
          exhaustionScore: 7,
          chaseRisk: 2,
          quoteVolume24h: 7500000,
        },
        reasonCodes: ["SMOKE_DISCOVERED"],
        state: "HOT",
        firstDetectedAt: now - 2 * 60_000,
        firstDetectionPrice: 100,
        lastScoreAt: now - 30_000,
        lastEvidenceAt: now - 20_000,
        currentPrice: 101,
        scansWithoutEvidence: 0,
        deepSubscribed: true,
      },
    ],
    { now },
  );

  for (let i = 0; i < 18; i += 1) {
    const t = now - (18 - i) * 60_000;
    shadow.ingestPrice("SMOKEUSDT", { t, price: 100 + i * 0.25, high: 100 + i * 0.25, low: 100 + i * 0.25 }, t);
  }

  const persist = await persistShadowOutcomes();
  const checkpoints = buildRuntimeTelemetrySnapshot({ runId, roundId: "1" });
  const settlement = await getSettlementStatus({ runId, campaignId });
  const settlementWrongRunId = await getSettlementStatus({ runId: "wrong-run-id", campaignId });
  const shadowCount = await prisma.shadowCandidateOutcome.count({ where: { campaignId } });
  const moverCount = await prisma.shadowMoverEvent.count({ where: { campaignId } });

  const out = {
    status: "PASS",
    campaignId,
    runId,
    persist,
    counts: {
      shadowCount,
      moverCount,
    },
    checkpointSchema: (checkpoints as Record<string, unknown>).checkpointSchema ?? null,
    settlement,
    settlementWrongRunId,
  };

  const outPath = path.join(process.cwd(), "artifacts", "forensics", `phase08-smoke-${campaignId.replace(/[:]/g, "-")}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outPath, ...out }, null, 2));

  await prisma.shadowCandidateOutcome.deleteMany({ where: { campaignId } });
  await prisma.shadowMoverEvent.deleteMany({ where: { campaignId } });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
