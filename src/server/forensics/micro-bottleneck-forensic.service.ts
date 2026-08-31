import { prisma } from "@/src/server/db/prisma";

type HorizonOutcome = {
  horizonMin: number;
  mfePct: number | null;
  maePct: number | null;
  returnPct: number | null;
  timeToMfeMs: number | null;
  complete: boolean;
  quality: "OK" | "OUTCOME_DATA_INCOMPLETE";
};

type JourneyEvent = {
  at: number;
  stage: string;
  lane: string;
  score: number;
  state: string;
};

type CandidateView = {
  candidateId: string;
  symbol: string;
  lane: string;
  detectedAt: number;
  detectedPrice: number;
  opportunityScore: number;
  latestStage: string;
  stages: Set<string>;
  reasons: string[];
  warnings: string[];
  invalidReason: string | null;
  mfeMax: number;
  maeMin: number;
  peakAt: number | null;
  timing: Record<string, number | null>;
};

function num(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function hasStage(c: CandidateView, ...ids: string[]) {
  return ids.some((id) => c.stages.has(id));
}

function candidateFromRow(row: {
  candidateId: string;
  symbol: string;
  lane: string;
  detectedAt: Date;
  firstDetectionPrice: number;
  latestStage: string | null;
  snapshot: unknown;
  outcomes: unknown;
  journey: unknown;
  invalidReason: string | null;
}): CandidateView {
  const snapshot = ((row.snapshot as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const journey = ((row.journey as JourneyEvent[] | null) ?? []) as JourneyEvent[];
  const outcomes = ((row.outcomes as HorizonOutcome[] | null) ?? []) as HorizonOutcome[];
  const complete = outcomes.filter((x) => x.complete && x.quality === "OK");
  let mfeMax = Number.NEGATIVE_INFINITY;
  let maeMin = Number.POSITIVE_INFINITY;
  let peakAt: number | null = null;
  for (const o of complete) {
    if (o.mfePct != null && o.mfePct > mfeMax) {
      mfeMax = o.mfePct;
      peakAt = o.timeToMfeMs != null ? new Date(row.detectedAt).getTime() + o.timeToMfeMs : peakAt;
    }
    if (o.maePct != null && o.maePct < maeMin) maeMin = o.maePct;
  }
  if (!Number.isFinite(mfeMax)) mfeMax = 0;
  if (!Number.isFinite(maeMin)) maeMin = 0;
  const reasons = Array.isArray(snapshot.reasonCodes) ? snapshot.reasonCodes.map((x) => String(x)) : [];
  const warnings = Array.isArray(snapshot.warnings) ? snapshot.warnings.map((x) => String(x)) : [];
  const stages = new Set<string>(journey.map((j) => String(j.stage || j.state || "")));
  if (row.latestStage) stages.add(String(row.latestStage));
  return {
    candidateId: row.candidateId,
    symbol: row.symbol,
    lane: row.lane,
    detectedAt: new Date(row.detectedAt).getTime(),
    detectedPrice: num(row.firstDetectionPrice),
    opportunityScore: num(snapshot.opportunityScore),
    latestStage: String(row.latestStage ?? "UNKNOWN"),
    stages,
    reasons,
    warnings,
    invalidReason: row.invalidReason,
    mfeMax,
    maeMin,
    peakAt,
    timing: ((snapshot.microTiming as Record<string, number | null> | null) ?? {}) as Record<string, number | null>,
  };
}

export async function buildMicroBottleneckForensic(input: {
  startedAt: Date;
  completedAt: Date;
  moverTarget?: number;
}) {
  const rows = await prisma.shadowCandidateOutcome.findMany({
    where: {
      source: "live",
      OR: [
        { detectedAt: { gte: input.startedAt, lte: input.completedAt } },
        { updatedAt: { gte: input.startedAt, lte: input.completedAt } },
      ],
    },
    select: {
      candidateId: true,
      symbol: true,
      lane: true,
      detectedAt: true,
      firstDetectionPrice: true,
      latestStage: true,
      snapshot: true,
      outcomes: true,
      journey: true,
      invalidReason: true,
    },
    take: 10000,
  });

  const candidates = rows.map(candidateFromRow);
  const bySymbol = new Map<string, CandidateView[]>();
  for (const row of candidates) {
    const list = bySymbol.get(row.symbol) ?? [];
    list.push(row);
    bySymbol.set(row.symbol, list);
  }

  const symbolPeaks = [...bySymbol.entries()]
    .map(([symbol, list]) => {
      const best = [...list].sort((a, b) => b.mfeMax - a.mfeMax)[0];
      const first = [...list].sort((a, b) => a.detectedAt - b.detectedAt)[0];
      return { symbol, best, first, peakMovePercent: best?.mfeMax ?? 0 };
    })
    .sort((a, b) => b.peakMovePercent - a.peakMovePercent)
    .filter((x) => x.peakMovePercent > 0);

  const moverTarget = Math.max(1, Number(input.moverTarget ?? 6));
  const movers = symbolPeaks.slice(0, moverTarget);
  const moverJourneys = movers.map((m) => {
    const list = bySymbol.get(m.symbol) ?? [];
    const matched = list.find((x) => x.candidateId === m.best.candidateId) ?? list[0];
    const terminalReason = [...matched.warnings, ...matched.reasons][0] ?? matched.invalidReason ?? "UNKNOWN";
    return {
      symbol: m.symbol,
      moveStartAt: new Date(m.first.detectedAt).toISOString(),
      moveStartPrice: m.first.detectedPrice,
      peakAt: matched.peakAt ? new Date(matched.peakAt).toISOString() : null,
      peakPrice: Number((matched.detectedPrice * (1 + matched.mfeMax / 100)).toFixed(8)),
      peakMovePercent: Number(matched.mfeMax.toFixed(4)),
      systemDetected: true,
      candidateId: matched.candidateId,
      firstDetectedAt: new Date(matched.detectedAt).toISOString(),
      firstDetectedPrice: matched.detectedPrice,
      lane: matched.lane,
      opportunityScore: matched.opportunityScore,
      hot: hasStage(matched, "HOT", "PROMOTED"),
      deepSubscribed: Boolean(matched.timing.deepSubscribeRequestedAt || matched.timing.deepActiveAt),
      microAnalyzed: hasStage(matched, "WARMING", "COOLING", "MICRO_CONFIRMED", "EXECUTION_READY", "HARD_REJECT"),
      microConfirmed: hasStage(matched, "MICRO_CONFIRMED"),
      executionReady: hasStage(matched, "EXECUTION_READY"),
      paperOpened: hasStage(matched, "PAPER_OPENED"),
      terminalState: matched.latestStage,
      terminalReason,
      reasons: [...new Set([...matched.warnings, ...matched.reasons])],
    };
  });

  const moverCounts = {
    total: movers.length,
    detected: moverJourneys.filter((m) => m.systemDetected).length,
    hot: moverJourneys.filter((m) => m.hot).length,
    microAnalyzed: moverJourneys.filter((m) => m.microAnalyzed).length,
    microConfirmed: moverJourneys.filter((m) => m.microConfirmed).length,
    executionReady: moverJourneys.filter((m) => m.executionReady).length,
    paperOpened: moverJourneys.filter((m) => m.paperOpened).length,
  };

  const profitableBuckets = [1, 2, 3, 5].map((threshold) => {
    const rowsForThreshold = candidates.filter((c) => c.mfeMax >= threshold);
    const reasonDist: Record<string, number> = {};
    for (const row of rowsForThreshold) {
      const reason = [...row.warnings, ...row.reasons][0] ?? row.invalidReason ?? "UNKNOWN";
      reasonDist[reason] = (reasonDist[reason] ?? 0) + 1;
    }
    return {
      thresholdPct: threshold,
      total: rowsForThreshold.length,
      hot: rowsForThreshold.filter((c) => hasStage(c, "HOT", "PROMOTED")).length,
      microAnalyzed: rowsForThreshold.filter((c) => hasStage(c, "WARMING", "COOLING", "MICRO_CONFIRMED", "EXECUTION_READY", "HARD_REJECT")).length,
      microConfirmed: rowsForThreshold.filter((c) => hasStage(c, "MICRO_CONFIRMED")).length,
      executionReady: rowsForThreshold.filter((c) => hasStage(c, "EXECUTION_READY")).length,
      paperOpened: rowsForThreshold.filter((c) => hasStage(c, "PAPER_OPENED")).length,
      terminalReasonDistribution: reasonDist,
    };
  });

  const reasonGroups = [
    "MICRO_LOW_ACTIVITY",
    "MICRO_DATA_STALE",
    "MICRO_INSUFFICIENT_BID_SUPPORT",
    "MICRO_NO_ASK_DEPLETION",
    "MICRO_WARMUP_INCOMPLETE",
  ].map((reason) => {
    const group = candidates.filter((c) => c.reasons.includes(reason) || c.warnings.includes(reason));
    const mfes = group.map((c) => c.mfeMax);
    const maes = group.map((c) => c.maeMin);
    const hit2 = group.filter((c) => c.mfeMax >= 2).length;
    const hit5 = group.filter((c) => c.mfeMax >= 5).length;
    return {
      reason,
      total: group.length,
      laterMfeMedian: median(mfes),
      laterMaeMedian: median(maes),
      hit2Rate: group.length ? hit2 / group.length : 0,
      hit5Rate: group.length ? hit5 / group.length : 0,
    };
  });

  return {
    candidateCount: candidates.length,
    moverJoin: {
      moverTarget,
      movers: moverJourneys,
      counts: moverCounts,
      conversion: {
        moverDetectionRecall: moverCounts.total ? moverCounts.detected / moverCounts.total : 0,
        moverHotConversion: moverCounts.detected ? moverCounts.hot / moverCounts.detected : 0,
        moverMicroConfirmationRate: moverCounts.microAnalyzed ? moverCounts.microConfirmed / moverCounts.microAnalyzed : 0,
        moverExecutionReadyRate: moverCounts.microAnalyzed ? moverCounts.executionReady / moverCounts.microAnalyzed : 0,
        moverTradeConversion: moverCounts.total ? moverCounts.paperOpened / moverCounts.total : 0,
      },
    },
    profitableBuckets,
    microTrueNegativeByReason: reasonGroups,
  };
}
