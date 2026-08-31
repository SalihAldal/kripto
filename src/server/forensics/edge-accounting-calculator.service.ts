type AnyRecord = Record<string, unknown>;

const MFE_THRESHOLDS = [1, 2, 3, 5, 7, 10, 15, 20] as const;
const RANK_BUCKETS = [
  { id: "1-5", min: 1, max: 5 },
  { id: "6-10", min: 6, max: 10 },
  { id: "11-20", min: 11, max: 20 },
  { id: "21+", min: 21, max: Number.POSITIVE_INFINITY },
] as const;

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function quantile(values: number[], q: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[index] ?? null;
}

function pct(part: number, total: number) {
  if (total <= 0) return 0;
  return Number(((part / total) * 100).toFixed(4));
}

type CandidateStageState = {
  candidateId: string;
  symbol: string;
  lane: string | null;
  events: Set<string>;
  terminalStage: string | null;
  terminalReason: string | null;
};

function buildStageMap(events: AnyRecord[]) {
  const map = new Map<string, CandidateStageState>();
  for (const row of events) {
    const candidateId = String(row.candidateId ?? "").trim();
    if (!candidateId) continue;
    const eventType = String(row.eventType ?? "");
    const payload = (row.payload as AnyRecord | undefined) ?? {};
    const current = map.get(candidateId) ?? {
      candidateId,
      symbol: String(row.symbol ?? "").toUpperCase(),
      lane: typeof payload.lane === "string" ? payload.lane : null,
      events: new Set<string>(),
      terminalStage: null,
      terminalReason: null,
    };
    if (eventType) current.events.add(eventType);
    if (typeof payload.lane === "string") current.lane = payload.lane;
    if (typeof payload.terminalStage === "string") current.terminalStage = payload.terminalStage;
    if (typeof payload.terminalReason === "string") current.terminalReason = payload.terminalReason;
    map.set(candidateId, current);
  }
  return map;
}

function getOutcome60(candidate: AnyRecord) {
  const outcomes = Array.isArray(candidate.outcomes) ? (candidate.outcomes as AnyRecord[]) : [];
  const row = outcomes.find((item) => Number(item.horizonMin) === 60);
  if (!row) return null;
  const status = String(row.status ?? "").toUpperCase();
  const complete = row.complete === true || status === "COMPLETE" || status === "INVALID_DATA" || status === "HISTORY_UNAVAILABLE";
  const quality = String(row.quality ?? "");
  const mfe = asNumber(row.mfePct);
  const mae = asNumber(row.maePct);
  if (!complete || quality !== "OK" || mfe == null || status === "INVALID_DATA" || status === "HISTORY_UNAVAILABLE") {
    return null;
  }
  return { mfe, mae, returnPct: asNumber(row.returnPct) };
}

function hasEvent(state: CandidateStageState | undefined, event: string) {
  return Boolean(state?.events.has(event));
}

function classifyRejection(state: CandidateStageState | undefined) {
  if (!state || !hasEvent(state, "CANDIDATE_HOT")) return "DETECTED_NOT_HOT";
  if (hasEvent(state, "MICRO_REJECTED")) return "HOT_MICRO_REJECT";
  if (hasEvent(state, "NOT_EXECUTION_READY")) return "MICRO_CONFIRMED_NOT_READY";
  if (hasEvent(state, "RISK_REJECTED")) return "READY_RISK_REJECT";
  if (hasEvent(state, "PAPER_REJECTED")) return "RISK_ALLOWED_PAPER_REJECT";
  if (hasEvent(state, "CANDIDATE_EXPIRED")) return "EXPIRED";
  return "DATA_INVALID";
}

function median(values: number[]) {
  return quantile(values, 0.5);
}

function firstTimestamp(events: AnyRecord[], eventType: string) {
  for (const row of events) {
    if (String(row.eventType ?? "") !== eventType) continue;
    const ts = Date.parse(String(row.timestamp ?? ""));
    if (Number.isFinite(ts)) return ts;
  }
  return null;
}

function distribution(values: number[]) {
  return {
    n: values.length,
    p50: quantile(values, 0.5),
    p75: quantile(values, 0.75),
    p95: quantile(values, 0.95),
    max: values.length > 0 ? Math.max(...values) : null,
  };
}

export function buildEdgeAccountingReport(input: {
  tracked: AnyRecord[];
  canonicalEvents: AnyRecord[];
  orders: AnyRecord[];
  pnlEntries: AnyRecord[];
}) {
  const stages = buildStageMap(input.canonicalEvents);
  const rows = input.tracked.filter((row) => getOutcome60(row) != null);

  const profitableConversion = MFE_THRESHOLDS.map((threshold) => {
    const eligible = rows.filter((row) => (getOutcome60(row)?.mfe ?? 0) >= threshold);
    const paperOpened = eligible.filter((row) => {
      const id = String((row.snapshot as AnyRecord)?.candidateId ?? "");
      return hasEvent(stages.get(id), "PAPER_OPENED");
    }).length;
    const total = eligible.length;
    const base = {
      threshold,
      totalCandidates: total,
      paperTraded: paperOpened,
      notTraded: Math.max(0, total - paperOpened),
      conversionPercent: pct(paperOpened, total),
    };
    const stageCount = (eventType: string) =>
      eligible.filter((row) => hasEvent(stages.get(String((row.snapshot as AnyRecord)?.candidateId ?? "")), eventType)).length;
    return {
      ...base,
      funnel: {
        HOT: { count: stageCount("CANDIDATE_HOT"), percent: pct(stageCount("CANDIDATE_HOT"), total) },
        MicroAnalyzed: { count: stageCount("MICRO_ANALYZED"), percent: pct(stageCount("MICRO_ANALYZED"), total) },
        MicroConfirmed: { count: stageCount("MICRO_CONFIRMED"), percent: pct(stageCount("MICRO_CONFIRMED"), total) },
        FinalRanked: { count: stageCount("FINAL_RANKED"), percent: pct(stageCount("FINAL_RANKED"), total) },
        ExecutionReady: { count: stageCount("EXECUTION_READY"), percent: pct(stageCount("EXECUTION_READY"), total) },
        RiskAllowed: { count: stageCount("RISK_ALLOWED"), percent: pct(stageCount("RISK_ALLOWED"), total) },
        PaperOpened: { count: stageCount("PAPER_OPENED"), percent: pct(stageCount("PAPER_OPENED"), total) },
        PaperClosed: { count: stageCount("PAPER_CLOSED"), percent: pct(stageCount("PAPER_CLOSED"), total) },
      },
    };
  });

  const missedProfitable = rows
    .filter((row) => (getOutcome60(row)?.mfe ?? 0) >= 2)
    .filter((row) => {
      const id = String((row.snapshot as AnyRecord)?.candidateId ?? "");
      return !hasEvent(stages.get(id), "PAPER_OPENED");
    })
    .map((row) => {
      const snapshot = (row.snapshot as AnyRecord) ?? {};
      const outcome = getOutcome60(row);
      const candidateId = String(snapshot.candidateId ?? "");
      const state = stages.get(candidateId);
      return {
        candidateId,
        symbol: String(snapshot.symbol ?? ""),
        lane: state?.lane ?? String(snapshot.primaryLane ?? ""),
        detectedAt: snapshot.firstDetectedAt ?? null,
        detectedPrice: snapshot.firstDetectionPrice ?? null,
        MFE: outcome?.mfe ?? null,
        MAE: outcome?.mae ?? null,
        opportunityScore: snapshot.opportunityScore ?? null,
        microScore: snapshot.microScore ?? null,
        finalScore: snapshot.finalScore ?? null,
        rank: snapshot.initialRank ?? (row.latestRank as number | null) ?? null,
        terminalStage: state?.terminalStage ?? null,
        terminalReason: state?.terminalReason ?? null,
      };
    });

  const profitableRejectionHistogram = [2, 3, 5].map((threshold) => {
    const eligible = rows.filter((row) => (getOutcome60(row)?.mfe ?? 0) >= threshold);
    const histogram: Record<string, number> = {};
    for (const row of eligible) {
      const id = String((row.snapshot as AnyRecord)?.candidateId ?? "");
      const cls = classifyRejection(stages.get(id));
      histogram[cls] = (histogram[cls] ?? 0) + 1;
    }
    return { threshold, total: eligible.length, histogram };
  });

  const tradeByCandidate = new Map<string, { entry: number; exit: number | null; captured: number | null }>();
  for (const order of input.orders) {
    const candidateId = String(order.candidateId ?? "");
    if (!candidateId) continue;
    const side = String(order.side ?? "").toUpperCase();
    const price = asNumber(order.entryPrice) ?? asNumber(order.price);
    if (price == null || price <= 0) continue;
    const current = tradeByCandidate.get(candidateId) ?? { entry: 0, exit: null, captured: null };
    if (side === "BUY" && current.entry === 0) current.entry = price;
    if (side === "SELL") current.exit = price;
    if (current.entry > 0 && current.exit && current.exit > 0) {
      current.captured = Number((((current.exit - current.entry) / current.entry) * 100).toFixed(6));
    }
    tradeByCandidate.set(candidateId, current);
  }

  const captureRows = rows
    .map((row) => {
      const snapshot = (row.snapshot as AnyRecord) ?? {};
      const candidateId = String(snapshot.candidateId ?? "");
      const trade = tradeByCandidate.get(candidateId);
      const outcome = getOutcome60(row);
      const potential = outcome?.mfe ?? null;
      const captured = trade?.captured ?? null;
      const ratio = potential && potential > 0 && captured != null ? Number((captured / potential).toFixed(6)) : null;
      return {
        candidateId,
        symbol: String(snapshot.symbol ?? ""),
        detectionToPeakPotentialPct: potential,
        tradeCapturedReturnPct: captured,
        tradeCaptureRatio: ratio,
      };
    })
    .filter((row) => row.tradeCapturedReturnPct != null || row.detectionToPeakPotentialPct != null);

  const rankCalibration = RANK_BUCKETS.map((bucket) => {
    const members = rows.filter((row) => {
      const snapshot = (row.snapshot as AnyRecord) ?? {};
      const rank = asNumber(snapshot.initialRank ?? row.latestRank);
      if (rank == null) return false;
      return rank >= bucket.min && rank <= bucket.max;
    });
    const mfes = members.map((row) => getOutcome60(row)?.mfe).filter((v): v is number => v != null);
    const maes = members.map((row) => getOutcome60(row)?.mae).filter((v): v is number => v != null);
    const executionReady = members.filter((row) => hasEvent(stages.get(String((row.snapshot as AnyRecord)?.candidateId ?? "")), "EXECUTION_READY")).length;
    const traded = members.filter((row) => hasEvent(stages.get(String((row.snapshot as AnyRecord)?.candidateId ?? "")), "PAPER_OPENED")).length;
    return {
      bucket: bucket.id,
      N: members.length,
      medianMFE: median(mfes),
      medianMAE: median(maes),
      hit2Rate: pct(members.filter((row) => (getOutcome60(row)?.mfe ?? 0) >= 2).length, members.length),
      hit3Rate: pct(members.filter((row) => (getOutcome60(row)?.mfe ?? 0) >= 3).length, members.length),
      hit5Rate: pct(members.filter((row) => (getOutcome60(row)?.mfe ?? 0) >= 5).length, members.length),
      executionReadyRate: pct(executionReady, members.length),
      tradeRate: pct(traded, members.length),
      netPnl: null,
    };
  });

  const hot = rows.filter((row) => hasEvent(stages.get(String((row.snapshot as AnyRecord)?.candidateId ?? "")), "CANDIDATE_HOT"));
  const notHot = rows.filter((row) => !hasEvent(stages.get(String((row.snapshot as AnyRecord)?.candidateId ?? "")), "CANDIDATE_HOT"));
  const microConfirmed = rows.filter((row) => hasEvent(stages.get(String((row.snapshot as AnyRecord)?.candidateId ?? "")), "MICRO_CONFIRMED"));
  const microRejected = rows.filter((row) => hasEvent(stages.get(String((row.snapshot as AnyRecord)?.candidateId ?? "")), "MICRO_REJECTED"));
  const riskRejected = rows.filter((row) => hasEvent(stages.get(String((row.snapshot as AnyRecord)?.candidateId ?? "")), "RISK_REJECTED"));

  const summarizeValue = (members: AnyRecord[]) => {
    const mfes = members.map((row) => getOutcome60(row)?.mfe).filter((v): v is number => v != null);
    const maes = members.map((row) => getOutcome60(row)?.mae).filter((v): v is number => v != null);
    return {
      N: members.length,
      medianMFE: median(mfes),
      medianMAE: median(maes),
      hit2: pct(members.filter((row) => (getOutcome60(row)?.mfe ?? 0) >= 2).length, members.length),
      hit3: pct(members.filter((row) => (getOutcome60(row)?.mfe ?? 0) >= 3).length, members.length),
      hit5: pct(members.filter((row) => (getOutcome60(row)?.mfe ?? 0) >= 5).length, members.length),
    };
  };

  const riskValue = riskRejected.map((row) => {
    const outcome = getOutcome60(row);
    return {
      candidateId: String((row.snapshot as AnyRecord)?.candidateId ?? ""),
      symbol: String((row.snapshot as AnyRecord)?.symbol ?? ""),
      classification: (outcome?.mfe ?? 0) >= 2 ? "MISSED_PROFIT" : (outcome?.mae ?? 0) <= -2 ? "AVOIDED_LOSS" : "NEUTRAL",
      MFE: outcome?.mfe ?? null,
      MAE: outcome?.mae ?? null,
    };
  });

  const eventGroups = new Map<string, AnyRecord[]>();
  for (const row of input.canonicalEvents) {
    const id = String(row.candidateId ?? "");
    if (!id) continue;
    const arr = eventGroups.get(id) ?? [];
    arr.push(row);
    eventGroups.set(id, arr);
  }
  for (const arr of eventGroups.values()) {
    arr.sort((a, b) => Date.parse(String(a.timestamp ?? "")) - Date.parse(String(b.timestamp ?? "")));
  }

  const pipelinePairs = [
    ["CANDIDATE_DISCOVERED", "CANDIDATE_HOT", "DiscoveryToHotMs"],
    ["CANDIDATE_HOT", "MICRO_ANALYZED", "HotToMicroAnalyzedMs"],
    ["MICRO_CONFIRMED", "FINAL_RANKED", "MicroConfirmedToFinalRankMs"],
    ["FINAL_RANKED", "EXECUTION_READY", "FinalRankToExecutionReadyMs"],
    ["EXECUTION_READY", "RISK_ALLOWED", "ExecutionReadyToRiskAllowedMs"],
    ["RISK_ALLOWED", "PAPER_ATTEMPT", "RiskAllowedToPaperAttemptMs"],
    ["PAPER_ATTEMPT", "PAPER_OPENED", "PaperAttemptToPaperOpenedMs"],
    ["CANDIDATE_DISCOVERED", "PAPER_OPENED", "DetectionToPaperOpenedTotalMs"],
  ] as const;

  const pipelineLatency: Record<string, ReturnType<typeof distribution>> = {};
  for (const [fromType, toType, key] of pipelinePairs) {
    const values: number[] = [];
    for (const events of eventGroups.values()) {
      const fromTs = firstTimestamp(events, fromType);
      const toTs = firstTimestamp(events, toType);
      if (fromTs == null || toTs == null || toTs < fromTs) continue;
      values.push(toTs - fromTs);
    }
    pipelineLatency[key] = distribution(values);
  }

  const deepLatencyValues = {
    subscribeRequestedToActive: [] as number[],
    activeToFirstAggTrade: [] as number[],
    activeToFirstBookTicker: [] as number[],
    activeToMicroReady: [] as number[],
  };
  for (const row of rows) {
    const timing = ((row.snapshot as AnyRecord)?.microTiming as AnyRecord | undefined) ?? {};
    const deepRequestedAt = asNumber(timing.deepSubscribeRequestedAt);
    const deepActiveAt = asNumber(timing.deepActiveAt);
    const firstAggTradeAt = asNumber(timing.firstAggTradeAt);
    const firstBookTickerAt = asNumber(timing.firstBookTickerAt);
    const microReadyAt = asNumber(row.microReadyAt ?? timing.microDataReadyAt);
    if (deepRequestedAt != null && deepActiveAt != null && deepActiveAt >= deepRequestedAt) {
      deepLatencyValues.subscribeRequestedToActive.push(deepActiveAt - deepRequestedAt);
    }
    if (deepActiveAt != null && firstAggTradeAt != null && firstAggTradeAt >= deepActiveAt) {
      deepLatencyValues.activeToFirstAggTrade.push(firstAggTradeAt - deepActiveAt);
    }
    if (deepActiveAt != null && firstBookTickerAt != null && firstBookTickerAt >= deepActiveAt) {
      deepLatencyValues.activeToFirstBookTicker.push(firstBookTickerAt - deepActiveAt);
    }
    if (deepActiveAt != null && microReadyAt != null && microReadyAt >= deepActiveAt) {
      deepLatencyValues.activeToMicroReady.push(microReadyAt - deepActiveAt);
    }
  }

  const deepLatency = {
    subscribeRequestedToActive: distribution(deepLatencyValues.subscribeRequestedToActive),
    activeToFirstAggTrade: distribution(deepLatencyValues.activeToFirstAggTrade),
    activeToFirstBookTicker: distribution(deepLatencyValues.activeToFirstBookTicker),
    activeToMicroReady: distribution(deepLatencyValues.activeToMicroReady),
  };

  return {
    mfeConversion: profitableConversion,
    profitableTradeConversion: {
      mfe2: profitableConversion.find((row) => row.threshold === 2) ?? null,
      mfe3: profitableConversion.find((row) => row.threshold === 3) ?? null,
      mfe5: profitableConversion.find((row) => row.threshold === 5) ?? null,
    },
    missedProfitableOpportunities: missedProfitable,
    profitableRejectionHistogram,
    captureRatio: {
      formula: "tradeCapturedReturnPct / detectionToPeakPotentialPct",
      rows: captureRows,
      summary: {
        N: captureRows.length,
        medianRatio: median(captureRows.map((row) => asNumber(row.tradeCaptureRatio) ?? 0)),
        p95Ratio: quantile(captureRows.map((row) => asNumber(row.tradeCaptureRatio) ?? 0), 0.95),
      },
    },
    rankCalibration,
    hotGateValue: {
      hot: summarizeValue(hot),
      notHot: summarizeValue(notHot),
    },
    microValue: {
      microConfirmed: summarizeValue(microConfirmed),
      microRejected: summarizeValue(microRejected),
    },
    riskValue: {
      totalRejected: riskRejected.length,
      avoidedLoss: riskValue.filter((row) => row.classification === "AVOIDED_LOSS").length,
      missedProfit: riskValue.filter((row) => row.classification === "MISSED_PROFIT").length,
      rows: riskValue,
    },
    pipelineLatency,
    deepLatency,
    metadata: {
      candidateCountEvaluated: rows.length,
      excludedCandidates: Math.max(0, input.tracked.length - rows.length),
      pnlEntries: input.pnlEntries.length,
    },
  };
}

export function calculateProfitableOpportunityConversion(input: {
  tracked: AnyRecord[];
  canonicalEvents: AnyRecord[];
}) {
  const report = buildEdgeAccountingReport({
    tracked: input.tracked,
    canonicalEvents: input.canonicalEvents,
    orders: [],
    pnlEntries: [],
  });
  return report.mfeConversion;
}

export function calculateCaptureRatio(input: {
  tracked: AnyRecord[];
  canonicalEvents: AnyRecord[];
  orders: AnyRecord[];
}) {
  const report = buildEdgeAccountingReport({
    tracked: input.tracked,
    canonicalEvents: input.canonicalEvents,
    orders: input.orders,
    pnlEntries: [],
  });
  return report.captureRatio;
}

export function calculatePipelineLatency(input: {
  tracked: AnyRecord[];
  canonicalEvents: AnyRecord[];
}) {
  const report = buildEdgeAccountingReport({
    tracked: input.tracked,
    canonicalEvents: input.canonicalEvents,
    orders: [],
    pnlEntries: [],
  });
  return {
    pipelineLatency: report.pipelineLatency,
    deepLatency: report.deepLatency,
  };
}
