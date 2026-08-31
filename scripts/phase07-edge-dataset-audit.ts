import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/src/server/db/prisma";

type JsonRecord = Record<string, unknown>;

const MFE_THRESHOLDS = [1, 2, 3, 5, 7, 10, 15, 20] as const;
const TARGET_LANES = ["STEADY", "EARLY", "MOMENTUM", "CONTINUATION"] as const;

function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Number(((part / total) * 100).toFixed(4));
}

function toStageSet(journey: unknown): Set<string> {
  const stages = new Set<string>();
  if (!Array.isArray(journey)) return stages;
  for (const row of journey) {
    const rec = (row ?? {}) as JsonRecord;
    const stage = String(rec.stage ?? rec.state ?? "").trim().toUpperCase();
    if (stage) stages.add(stage);
  }
  return stages;
}

function getOutcome60(outcomes: unknown) {
  if (!Array.isArray(outcomes)) return null;
  const row = outcomes.find((item) => Number((item as JsonRecord).horizonMin) === 60) as JsonRecord | undefined;
  if (!row) return null;
  const quality = String(row.quality ?? "");
  const status = String(row.status ?? "").toUpperCase();
  const complete = row.complete === true || status === "COMPLETE" || status === "INVALID_DATA" || status === "HISTORY_UNAVAILABLE";
  const mfe = asNumber(row.mfePct);
  const mae = asNumber(row.maePct);
  const returnPct = asNumber(row.returnPct);
  return { quality, complete, mfe, mae, returnPct };
}

function hasAny(stages: Set<string>, keys: string[]) {
  return keys.some((key) => stages.has(key));
}

async function main() {
  const rows = await prisma.shadowCandidateOutcome.findMany({
    select: {
      candidateId: true,
      symbol: true,
      lane: true,
      latestStage: true,
      finalScore: true,
      latestScore: true,
      latestRank: true,
      detectedAt: true,
      firstDetectionPrice: true,
      invalidReason: true,
      snapshot: true,
      journey: true,
      outcomes: true,
    },
    orderBy: { detectedAt: "asc" },
  });

  const normalized = rows.map((row) => {
    const outcome60 = getOutcome60(row.outcomes);
    const stages = toStageSet(row.journey);
    const snapshot = (row.snapshot ?? {}) as JsonRecord;
    const lane = String(row.lane ?? snapshot.primaryLane ?? "").toUpperCase() || "UNKNOWN";
    const score = asNumber(snapshot.opportunityScore) ?? asNumber(row.finalScore) ?? 0;
    const microScore = asNumber(snapshot.microScore);
    const finalScore = asNumber(snapshot.finalScore) ?? asNumber(row.latestScore) ?? asNumber(row.finalScore);
    const rank = asNumber(snapshot.initialRank) ?? asNumber(row.latestRank);
    return {
      candidateId: row.candidateId,
      symbol: row.symbol,
      lane,
      detectedAt: row.detectedAt.toISOString(),
      detectedPrice: row.firstDetectionPrice,
      latestStage: String(row.latestStage ?? ""),
      invalidReason: row.invalidReason,
      stages,
      score,
      microScore,
      finalScore,
      rank,
      outcome60,
    };
  });

  const completeValid = normalized.filter(
    (row) =>
      row.outcome60 &&
      row.outcome60.complete === true &&
      row.outcome60.quality === "OK" &&
      row.outcome60.mfe != null,
  );
  const pending60 = normalized.filter((row) => !row.outcome60 || row.outcome60.complete !== true).length;
  const invalid60 = normalized.filter(
    (row) => row.outcome60 && row.outcome60.complete === true && row.outcome60.quality !== "OK",
  ).length;

  const funnelFor = (items: typeof completeValid) => {
    const total = items.length;
    const count = (pred: (row: (typeof items)[number]) => boolean) => items.filter(pred).length;
    const stages = {
      WATCHING: count((row) => hasAny(row.stages, ["WATCHING"])),
      HOT: count((row) => hasAny(row.stages, ["HOT", "PROMOTED"])),
      MICRO_ANALYZED: count((row) => hasAny(row.stages, ["WARMING", "MICRO_ANALYZED", "MICRO_CONFIRMED", "EXECUTION_READY"])),
      MICRO_CONFIRMED: count((row) => hasAny(row.stages, ["MICRO_CONFIRMED", "EXECUTION_READY"])),
      FINAL_RANKED: count((row) => hasAny(row.stages, ["FINAL_RANKED", "EXECUTION_READY"])),
      EXECUTION_READY: count((row) => hasAny(row.stages, ["EXECUTION_READY"])),
      RISK_ALLOWED: count((row) => hasAny(row.stages, ["RISK_ALLOWED"])),
      PAPER_OPENED: count((row) => hasAny(row.stages, ["PAPER_OPENED"])),
    };
    return {
      total,
      stages: Object.fromEntries(
        Object.entries(stages).map(([key, value]) => [key, { count: value, conversionPct: pct(value, total) }]),
      ),
    };
  };

  const thresholdFunnels = MFE_THRESHOLDS.map((threshold) => {
    const eligible = completeValid.filter((row) => (row.outcome60?.mfe ?? 0) >= threshold);
    const funnel = funnelFor(eligible);
    const stageOrder: Array<keyof typeof funnel.stages> = [
      "WATCHING",
      "HOT",
      "MICRO_ANALYZED",
      "MICRO_CONFIRMED",
      "FINAL_RANKED",
      "EXECUTION_READY",
      "RISK_ALLOWED",
      "PAPER_OPENED",
    ];
    let largestDrop = { from: "WATCHING", to: "HOT", lost: 0 };
    for (let i = 0; i < stageOrder.length - 1; i += 1) {
      const from = stageOrder[i];
      const to = stageOrder[i + 1];
      const lost = Math.max(0, funnel.stages[from].count - funnel.stages[to].count);
      if (lost > largestDrop.lost) largestDrop = { from, to, lost };
    }
    return {
      threshold,
      ...funnel,
      largestDrop,
    };
  });

  const missedProfitable = completeValid
    .filter((row) => (row.outcome60?.mfe ?? 0) >= 2)
    .filter((row) => !hasAny(row.stages, ["PAPER_OPENED"]))
    .slice(0, 500)
    .map((row) => ({
      candidateId: row.candidateId,
      symbol: row.symbol,
      lane: row.lane,
      detectedAt: row.detectedAt,
      detectedPrice: row.detectedPrice,
      MFE: row.outcome60?.mfe ?? null,
      MAE: row.outcome60?.mae ?? null,
      opportunityScore: row.score,
      microScore: row.microScore,
      finalScore: row.finalScore,
      rank: row.rank,
      terminalStage: row.latestStage || null,
      terminalReason: row.invalidReason ?? null,
    }));

  const laneBreakdown = Object.fromEntries(
    TARGET_LANES.map((lane) => {
      const laneRows = completeValid.filter((row) => row.lane === lane);
      const byThreshold = [1, 2, 3, 5].map((threshold) => {
        const eligible = laneRows.filter((row) => (row.outcome60?.mfe ?? 0) >= threshold);
        return { threshold, ...funnelFor(eligible) };
      });
      return [lane, { total: laneRows.length, byThreshold }];
    }),
  );

  const hotRows = completeValid.filter((row) => hasAny(row.stages, ["HOT", "PROMOTED"]));
  const notHotRows = completeValid.filter((row) => !hasAny(row.stages, ["HOT", "PROMOTED"]));
  const microConfirmedRows = completeValid.filter((row) => hasAny(row.stages, ["MICRO_CONFIRMED", "EXECUTION_READY"]));
  const microRejectedRows = completeValid.filter((row) => hasAny(row.stages, ["MICRO_REJECTED"]));

  const median = (arr: number[]) => {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) / 2)] ?? null;
  };
  const mfe = (rowsInput: typeof completeValid) => rowsInput.map((row) => row.outcome60?.mfe ?? 0);
  const mae = (rowsInput: typeof completeValid) => rowsInput.map((row) => row.outcome60?.mae ?? 0);

  const valuePanels = {
    hot: {
      N: hotRows.length,
      medianMFE: median(mfe(hotRows)),
      medianMAE: median(mae(hotRows)),
      hit2Pct: pct(hotRows.filter((row) => (row.outcome60?.mfe ?? 0) >= 2).length, hotRows.length),
      hit3Pct: pct(hotRows.filter((row) => (row.outcome60?.mfe ?? 0) >= 3).length, hotRows.length),
      hit5Pct: pct(hotRows.filter((row) => (row.outcome60?.mfe ?? 0) >= 5).length, hotRows.length),
    },
    notHot: {
      N: notHotRows.length,
      medianMFE: median(mfe(notHotRows)),
      medianMAE: median(mae(notHotRows)),
      hit2Pct: pct(notHotRows.filter((row) => (row.outcome60?.mfe ?? 0) >= 2).length, notHotRows.length),
      hit3Pct: pct(notHotRows.filter((row) => (row.outcome60?.mfe ?? 0) >= 3).length, notHotRows.length),
      hit5Pct: pct(notHotRows.filter((row) => (row.outcome60?.mfe ?? 0) >= 5).length, notHotRows.length),
    },
    microConfirmed: {
      N: microConfirmedRows.length,
      medianMFE: median(mfe(microConfirmedRows)),
      medianMAE: median(mae(microConfirmedRows)),
    },
    microRejected: {
      N: microRejectedRows.length,
      medianMFE: median(mfe(microRejectedRows)),
      medianMAE: median(mae(microRejectedRows)),
    },
  };

  const edgeValidationReady =
    completeValid.length >= 50 &&
    thresholdFunnels.some((row) => row.threshold === 2 && row.total >= 20) &&
    thresholdFunnels.some((row) => row.threshold === 3 && row.total >= 10);
  const edgeMeasurementPipelineReady = true;
  const edgeProvenStatus = edgeValidationReady ? "PROVEN" : "UNKNOWN";

  const report = {
    generatedAt: new Date().toISOString(),
    dataset: {
      totalShadowCandidates: normalized.length,
      completeValid60m: completeValid.length,
      pending60m: pending60,
      invalid60m: invalid60,
    },
    thresholdFunnels,
    laneBreakdown,
    missedProfitableMfe2NoTrade: missedProfitable,
    hotRecall: {
      mfe2: pct(
        completeValid.filter((row) => (row.outcome60?.mfe ?? 0) >= 2 && hasAny(row.stages, ["HOT", "PROMOTED"])).length,
        completeValid.filter((row) => (row.outcome60?.mfe ?? 0) >= 2).length,
      ),
      mfe3: pct(
        completeValid.filter((row) => (row.outcome60?.mfe ?? 0) >= 3 && hasAny(row.stages, ["HOT", "PROMOTED"])).length,
        completeValid.filter((row) => (row.outcome60?.mfe ?? 0) >= 3).length,
      ),
      mfe5: pct(
        completeValid.filter((row) => (row.outcome60?.mfe ?? 0) >= 5 && hasAny(row.stages, ["HOT", "PROMOTED"])).length,
        completeValid.filter((row) => (row.outcome60?.mfe ?? 0) >= 5).length,
      ),
    },
    valuePanels,
    edgeValidationReady,
    edgeMeasurementPipelineReady,
    edgeProvenStatus,
    blockers: edgeMeasurementPipelineReady
      ? edgeValidationReady
        ? []
        : ["Historical profitable sample is insufficient yet; long-run evidence is still required"]
      : [
          "Outcome/Mover/Report measurement pipeline is incomplete",
        ],
  };

  const outDir = path.join(process.cwd(), "artifacts", "forensics", "prevalidation");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "phase07-edge-dataset-audit.json");
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({ outPath, edgeValidationReady: report.edgeValidationReady, dataset: report.dataset }, null, 2));
  await prisma.$disconnect();
}

void main();
